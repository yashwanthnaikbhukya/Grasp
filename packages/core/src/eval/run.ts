import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CardSolveExpectSchema,
  EvalCaseSchema,
  type EvalCase,
  type EvalJudgement,
  QueryUnderstandExpectSchema,
  SlipExpectSchema,
  TutorExpectSchema,
  type CardSolve,
  type QueryUnderstanding,
  type SlipClassification,
} from '@grasp/schema';
import { GatewayExhaustedError } from '../errors';
import { generate } from '../llm/gateway';
import { taskConfig, type TaskId } from '../llm/registry';
import type { TaskResult } from './baseline';
import {
  alignScores,
  type Score,
  scoreCardSolve,
  scoreQueryUnderstand,
  scoreRubric,
  scoreSlip,
  scoreTutorChecks,
} from './scorers';

/**
 * The eval runner. Each case runs through the real gateway — the same chain,
 * prompts and validation the app uses — so a score describes production.
 *
 * Deterministic scorers decide everything they can; prose is graded by
 * `eval.judge` on a provider that is *not* the one that wrote it, and that is
 * asserted per case rather than assumed.
 */

export const EVAL_TASKS = [
  'query.understand',
  'slip.classify',
  'card.solve',
  'tutor.answer',
  'tutor.teach',
  'tutor.coach',
] as const satisfies readonly TaskId[];
export type EvalTask = (typeof EVAL_TASKS)[number];

export interface CaseResult {
  id: string;
  pass: boolean;
  failures: string[];
  provider?: string;
  model?: string;
  judgeProvider?: string;
  latencyMs?: number;
  /** First 1,500 characters of what the model produced — enough to see why. */
  output?: string;
  /**
   * The case could not be scored — every provider was rate-limited or down, for
   * the task or for the judge. That says nothing about prompt quality, so it is
   * left out of pass/fail and out of the regression gate, and reported apart.
   */
  inconclusive?: boolean;
}

/**
 * Exhausted only by infrastructure (429s, timeouts, 5xx) — not by the model
 * producing output that failed its schema, which *is* a quality failure.
 */
function isInfraFailure(e: unknown): boolean {
  if (!(e instanceof GatewayExhaustedError)) return false;
  const attempts = (e.meta.attempts as { error?: string }[] | undefined) ?? [];
  return attempts.length > 0 && attempts.every((a) => !/schema/i.test(String(a.error ?? '')));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Back-off before re-asking the judge: free tiers reset per minute. */
const JUDGE_RETRY_MS = [8_000, 20_000];

export interface EvalRun {
  results: TaskResult[];
  details: Record<string, CaseResult[]>;
}

const ALL_CAUSES =
  'careless-arithmetic, misread-question, misconception, knowledge-gap, time-pressure';

function fixtures(goldenDir: string) {
  const read = (f: string) => readFileSync(join(goldenDir, 'fixtures', f), 'utf8');
  return {
    catalog: read('catalog.txt').trim(),
    learnerCard: read('learner-card.txt').trim(),
    retrieved: JSON.parse(read('retrieved.json')) as unknown[],
  };
}

export function loadGoldenSet(goldenDir: string, task: EvalTask): EvalCase[] {
  const file = join(goldenDir, `${task}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l, i) => {
      const parsed = EvalCaseSchema.safeParse(JSON.parse(l));
      if (!parsed.success) throw new Error(`${task}.jsonl line ${i + 1}: ${parsed.error.message}`);
      return parsed.data;
    });
}

function withDefaults(task: EvalTask, c: EvalCase, fx: ReturnType<typeof fixtures>) {
  const input = { ...c.input };
  if (task === 'query.understand') {
    input.conceptCatalog ??= fx.catalog;
    input.history ??= c.messages.map((m) => ({ role: m.role, text: m.content }));
  } else if (task === 'slip.classify') {
    input.availableCauses ??= ALL_CAUSES;
    input.hintsUsed ??= 0;
    input.positionInSession ??= '3 of 12';
    input.prereqMastery ??= '(no prerequisites recorded)';
  } else if (task.startsWith('tutor.')) {
    input.learnerCard ??= fx.learnerCard;
    input.retrieved ??= fx.retrieved;
    input.rewritten ??= input.query;
  }
  return input;
}

function conversationText(c: EvalCase): string {
  const turns = c.messages.map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`);
  turns.push(`Student: ${String(c.input.query ?? '')}`);
  return turns.join('\n\n');
}

async function runCase(task: EvalTask, c: EvalCase, fx: ReturnType<typeof fixtures>): Promise<CaseResult> {
  let res: Awaited<ReturnType<typeof generate>>;
  try {
    res = await generate({
      task,
      input: withDefaults(task, c, fx),
      messages: c.messages,
      // Ollama is the offline floor (a 3B local model), not a quality target:
      // a case that falls through to it measures the outage, not the prompt.
      // With every real provider down, the case is inconclusive instead.
      excludeProviders: ['ollama'],
    });
  } catch (e) {
    const reason = `model call failed: ${e instanceof Error ? e.message : String(e)}`;
    return { id: c.id, pass: false, failures: [reason], inconclusive: isInfraFailure(e) };
  }

  const base = {
    id: c.id,
    provider: res.provider,
    model: res.model,
    latencyMs: res.latencyMs,
    output: (res.data !== undefined ? JSON.stringify(res.data) : res.text).slice(0, 1500),
  };

  let score: Score;
  let judgeProvider: string | undefined;

  if (task === 'query.understand') {
    score = scoreQueryUnderstand(res.data as QueryUnderstanding, QueryUnderstandExpectSchema.parse(c.expect));
  } else if (task === 'slip.classify') {
    score = scoreSlip(res.data as SlipClassification, SlipExpectSchema.parse(c.expect));
  } else if (task === 'card.solve') {
    score = scoreCardSolve(res.data as CardSolve, CardSolveExpectSchema.parse(c.expect));
  } else {
    const expect = TutorExpectSchema.parse(c.expect);
    const checks = scoreTutorChecks(res.text, expect);
    const failures = [...checks.failures];

    let inconclusive = false;
    if (expect.rubric.length > 0) {
      for (let attempt = 0; ; attempt++) {
        try {
          const judged = await generate<EvalJudgement>({
            task: 'eval.judge',
            input: {
              mode: task.replace('tutor.', '').toUpperCase(),
              conversation: conversationText(c),
              output: res.text,
              rubric: expect.rubric,
            },
            // Never let a model grade its own family's output.
            excludeProviders: [res.provider],
          });
          judgeProvider = judged.provider;
          if (judged.provider === res.provider) {
            failures.push(`judge ran on the producer's provider (${res.provider}) — result invalid`);
          } else if (judged.data) {
            const raw = Object.fromEntries(judged.data.scores.map((s) => [s.id, s.score]));
            const aligned = alignScores(expect.rubric, raw);
            const unscored = expect.rubric.filter((r) => !(r.id in aligned));
            failures.push(...scoreRubric(expect.rubric, aligned).failures);
            if (unscored.length > 0) {
              // Make a keying problem visible instead of guessing at it.
              failures.push(`judge returned ids [${Object.keys(raw).join(', ')}]`);
            }
          }
          break;
        } catch (e) {
          const wait = JUDGE_RETRY_MS[attempt];
          if (wait !== undefined && isInfraFailure(e)) {
            await sleep(wait);
            continue;
          }
          // A judge that never ran tells us nothing about the tutor.
          inconclusive = isInfraFailure(e);
          failures.push(`judge failed: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
    }
    return { ...base, pass: failures.length === 0, failures, judgeProvider, inconclusive };
  }

  return { ...base, ...score, judgeProvider };
}

/** Run cases with bounded concurrency — free tiers rate-limit bursts. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
    }),
  );
  return out;
}

export async function runEval(opts: {
  goldenDir: string;
  tasks?: readonly EvalTask[];
  concurrency?: number;
  onCase?: (task: EvalTask, r: CaseResult) => void;
}): Promise<EvalRun> {
  const fx = fixtures(opts.goldenDir);
  const results: TaskResult[] = [];
  const details: Record<string, CaseResult[]> = {};

  for (const task of opts.tasks ?? EVAL_TASKS) {
    const cases = loadGoldenSet(opts.goldenDir, task);
    if (cases.length === 0) continue;
    // Tutor cases make two calls each (answer + judge) and the judge has one
    // provider left after excluding the producer — run them one at a time.
    const concurrency = opts.concurrency ?? (task.startsWith('tutor.') ? 1 : 2);
    const caseResults = await pool(cases, concurrency, async (c) => {
      const r = await runCase(task, c, fx);
      opts.onCase?.(task, r);
      return r;
    });
    details[task] = caseResults;
    const scored = caseResults.filter((r) => !r.inconclusive);
    results.push({
      task,
      prompt: taskConfig(task).prompt,
      passed: scored.filter((r) => r.pass).length,
      total: scored.length,
      inconclusive: caseResults.length - scored.length,
      cases: Object.fromEntries(scored.map((r) => [r.id, r.pass])),
    });
  }
  return { results, details };
}
