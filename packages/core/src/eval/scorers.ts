import {
  normalizeCitations,
  type CardSolve,
  type CardSolveExpect,
  type QueryUnderstanding,
  type QueryUnderstandExpect,
  type SlipClassification,
  type SlipExpect,
  type TutorExpect,
} from '@grasp/schema';
import { answersAgree } from '../questions/verify';

/**
 * Deterministic scorers — pure, unit-tested (scorers.test.ts).
 *
 * Every check that can be decided without a model is decided here. The rubric
 * judge only ever sees what genuinely needs judgement (is this an explanation,
 * did it build on the student's answer), which keeps scores reproducible.
 */

export interface Score {
  pass: boolean;
  /** Human-readable reasons for each failed check; empty when it passes. */
  failures: string[];
}

const lower = (s: string) => s.toLowerCase();

function mentions(text: string, groups: readonly (readonly string[])[]): string[] {
  const t = lower(text);
  return groups
    .filter((alts) => !alts.some((a) => t.includes(lower(a))))
    .map((alts) => `does not mention ${alts.map((a) => `"${a}"`).join(' or ')}`);
}

export function scoreQueryUnderstand(out: QueryUnderstanding, expect: QueryUnderstandExpect): Score {
  const failures: string[] = [];
  const tags = new Set(out.conceptIds);

  if (expect.intent && !expect.intent.includes(out.intent)) {
    failures.push(`intent ${out.intent}, expected ${expect.intent.join(' or ')}`);
  }
  for (const c of expect.conceptsInclude) if (!tags.has(c)) failures.push(`missing concept ${c}`);
  if (expect.conceptsAnyOf.length > 0 && !expect.conceptsAnyOf.some((c) => tags.has(c))) {
    failures.push(`none of ${expect.conceptsAnyOf.join(', ')} tagged (got ${[...tags].join(', ') || 'none'})`);
  }
  for (const c of expect.conceptsExclude) if (tags.has(c)) failures.push(`should not tag ${c}`);
  if (expect.conceptsEmpty && tags.size > 0) failures.push(`expected no concepts, got ${[...tags].join(', ')}`);
  failures.push(...mentions(out.rewritten, expect.rewriteMentions).map((f) => `rewrite ${f}`));
  if (expect.needsClarification !== undefined && out.needsClarification !== expect.needsClarification) {
    failures.push(`needsClarification ${out.needsClarification}, expected ${expect.needsClarification}`);
  }
  return { pass: failures.length === 0, failures };
}

export function scoreSlip(out: SlipClassification, expect: SlipExpect): Score {
  const pass = expect.rootCause.includes(out.rootCause);
  return {
    pass,
    failures: pass ? [] : [`rootCause ${out.rootCause}, expected ${expect.rootCause.join(' or ')}`],
  };
}

export function scoreCardSolve(out: CardSolve, expect: CardSolveExpect): Score {
  const failures: string[] = [];
  if (!expect.flaw.includes(out.flaw)) {
    failures.push(`flaw ${out.flaw}, expected ${expect.flaw.join(' or ')}`);
  }
  // A flawed item has no right answer to compare — the flaw *is* the answer.
  if (expect.answer !== undefined && !answersAgree(expect.type, out.answer, expect.answer)) {
    failures.push(`answer ${JSON.stringify(out.answer)}, expected ${JSON.stringify(expect.answer)}`);
  }
  return { pass: failures.length === 0, failures };
}

/** `?` characters outside maths — "$f(x)?$" is not a question to the student. */
export function countQuestions(text: string): number {
  const prose = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|```[\s\S]*?```/g, ' ');
  return (prose.match(/\?/g) ?? []).length;
}

/** Does the message end on a question (ignoring trailing citation markers and whitespace)? */
export function endsWithQuestion(text: string): boolean {
  const t = normalizeCitations(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/(\s*\[c\d+(?:\s*,\s*c\d+)*\])+\s*$/g, '')
    .trimEnd()
    .replace(/[*_)\]]+$/g, '');
  return t.endsWith('?');
}

/** The deterministic half of a tutor case; the rubric half goes to the judge. */
export function scoreTutorChecks(text: string, expect: TutorExpect): Score {
  const failures: string[] = [];
  const q = countQuestions(text);
  if (expect.maxQuestions !== undefined && q > expect.maxQuestions) {
    failures.push(`${q} questions, at most ${expect.maxQuestions} allowed`);
  }
  if (expect.minQuestions !== undefined && q < expect.minQuestions) {
    failures.push(`${q} questions, at least ${expect.minQuestions} expected`);
  }
  if (expect.endsWithQuestion !== undefined && endsWithQuestion(text) !== expect.endsWithQuestion) {
    failures.push(expect.endsWithQuestion ? 'does not end with a question' : 'ends with a question');
  }
  for (const s of expect.mustNotContain) {
    if (lower(text).includes(lower(s))) failures.push(`contains "${s}"`);
  }
  failures.push(...mentions(text, expect.mustMention));
  return { pass: failures.length === 0, failures };
}

/**
 * Map the judge's score keys onto rubric ids.
 *
 * The judge is asked to key by id, and usually does — but sometimes echoes the
 * display form ("brief (MUST)") or numbers the criteria. A missed key scored the
 * criterion as 0 and failed a correct answer, which is noise, not signal.
 * Exact id → a key that starts with the id → position, when the counts match.
 */
export function alignScores(
  rubric: readonly { id: string }[],
  scores: Readonly<Record<string, number>>,
): Record<string, number> {
  const keys = Object.keys(scores);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim();
  const out: Record<string, number> = {};
  rubric.forEach((r, i) => {
    const exact = keys.find((k) => k === r.id);
    const prefixed = keys.find((k) => norm(k).startsWith(norm(r.id)));
    const key = exact ?? prefixed ?? (keys.length === rubric.length ? keys[i] : undefined);
    if (key !== undefined && typeof scores[key] === 'number') out[r.id] = scores[key] as number;
  });
  return out;
}

/**
 * Score a rubric from per-item judge scores. A MUST item needs ≥ 0.75; the
 * judge's own `passed` is ignored — the rule lives here, not in a prompt.
 */
export function scoreRubric(
  rubric: readonly { id: string; must: boolean }[],
  scores: Readonly<Record<string, number>>,
): Score {
  const failures = rubric
    .filter((r) => r.must && !((scores[r.id] ?? 0) >= 0.75))
    .map((r) => `rubric "${r.id}" scored ${scores[r.id] ?? 'nothing'}`);
  return { pass: failures.length === 0, failures };
}
