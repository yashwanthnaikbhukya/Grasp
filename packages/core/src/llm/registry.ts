import type { z } from 'zod';
import type { ProviderName } from '@grasp/schema';
import {
  ConceptProposalSchema,
  ConceptTaggingSchema,
  DoubtDecompositionSchema,
  EvalJudgementSchema,
  GeneratedCardSchema,
  CardSolveSchema,
  MindmapSchema,
  QueryUnderstandingSchema,
  SessionDigestSchema,
  SessionTitleSchema,
  SlipClassificationSchema,
  type ModelTier,
} from '@grasp/schema';

/**
 * The task registry: the single place that decides how each model call runs.
 *
 * Feature code names a **task**. The registry names a **tier**. Provider config
 * maps tier → concrete model. Three levels of indirection, each earning its
 * place:
 *
 *   task ('slip.classify') → tier ('best') → provider+model (gemini-2.0-flash)
 *        what you want          how good          what actually runs
 *
 * See docs/04-llm-gateway.md.
 */

export interface TaskConfig {
  tier: ModelTier;
  /** `taskId@version` in @grasp/prompts. Bump, never edit. */
  prompt: string;
  /** Absent ⇒ the task streams prose and is not schema-validated. */
  schema?: z.ZodTypeAny;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Deterministic, idempotent tasks only. Never a per-learner task. */
  cache: boolean;
  /**
   * Reasoning budget, for providers that expose one.
   *
   * Reasoning tokens come out of the *same* budget as the response. On a
   * schema-constrained task that is pure overhead — and worse, it silently
   * truncates the JSON, which the provider then rejects as invalid rather than
   * reporting as a length problem. `low` is right for extraction and generation
   * against a schema; leave it unset where the reasoning is the point.
   */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /**
   * Providers this task must never fall back to.
   *
   * For tasks that write durable structure, a weak model producing plausible
   * garbage is worse than an outright failure — the garbage persists and corrupts
   * every learner who touches it, while a failure just retries.
   */
  excludeProviders?: readonly ProviderName[];
}

export const TASKS = {
  // ---- Broker -------------------------------------------------------------
  'query.understand': {
    tier: 'fast',
    prompt: 'query.understand@1',
    schema: QueryUnderstandingSchema,
    maxOutputTokens: 1_500,
    reasoningEffort: 'low',
    timeoutMs: 8_000,
    // Per-conversation by nature — caching would serve a stale rewrite.
    cache: false,
  },
  'session.digest': {
    tier: 'fast',
    prompt: 'session.digest@1',
    schema: SessionDigestSchema,
    maxOutputTokens: 800,
    timeoutMs: 15_000,
    cache: false,
  },
  'session.title': {
    tier: 'fast',
    prompt: 'session.title@1',
    schema: SessionTitleSchema,
    maxOutputTokens: 60,
    timeoutMs: 8_000,
    cache: true,
  },

  // ---- Ask ----------------------------------------------------------------
  'tutor.reply': {
    tier: 'mid',
    prompt: 'tutor.reply@1',
    // No schema — streams prose to the learner.
    maxOutputTokens: 2_000,
    timeoutMs: 60_000,
    cache: false,
  },
  'tutor.explainAnswer': {
    tier: 'mid',
    prompt: 'tutor.reply@1',
    maxOutputTokens: 700,
    timeoutMs: 30_000,
    cache: false,
  },

  // ---- Content ------------------------------------------------------------
  'concept.tag': {
    tier: 'fast',
    prompt: 'concept.tag@1',
    schema: ConceptTaggingSchema,
    maxOutputTokens: 1_500,
    reasoningEffort: 'low',
    timeoutMs: 15_000,
    // Same chunk always tags the same way — cache aggressively during ingest.
    cache: true,
  },
  /**
   * The model authoring graph nodes. `mid` rather than `fast`: a duplicate or a
   * bad prerequisite edge persists in the graph and corrupts every learner who
   * touches that concept afterwards. Runs in a background job, so latency is
   * not a constraint — quality is.
   * See docs/adr/0007-llm-authored-concept-graph.md.
   */
  'concept.propose': {
    tier: 'mid',
    prompt: 'concept.propose@2',
    schema: ConceptProposalSchema,
    maxOutputTokens: 4_000,
    reasoningEffort: 'low',
    timeoutMs: 45_000,
    // Same passage → same proposal. Cheap win during a long ingest.
    cache: true,
    /**
     * No local leg. Observed: both hosted providers rate-limited, the call fell
     * through to llama3.2, and it echoed the supplied catalogue back as new
     * proposals — creating four duplicate nodes. Those persist. This is a
     * background job, so failing and retrying costs nothing.
     */
    excludeProviders: ['ollama'],
  },
  'card.generate': {
    tier: 'fast',
    prompt: 'card.generate@1',
    schema: GeneratedCardSchema,
    maxOutputTokens: 3_500,
    reasoningEffort: 'low',
    timeoutMs: 30_000,
    cache: false,
  },
  'card.solve': {
    // The verification leg. Must be at least as capable as the generator, or
    // verification is theatre.
    tier: 'mid',
    prompt: 'card.solve@1',
    schema: CardSolveSchema,
    // No reasoning cap here — working the problem out *is* the task, and a
    // solver that skips the reasoning is not independent verification.
    maxOutputTokens: 3_000,
    timeoutMs: 30_000,
    // Two solves of the same question must be independent, so a cache hit on
    // the second would make agreement meaningless.
    cache: false,
    // No weak local fallback: a bad verdict here promotes a broken question to
    // `verified`, and the learner is the one who finds out.
    excludeProviders: ['ollama'],
  },

  // ---- Snap / Slips / Map --------------------------------------------------
  'doubt.decompose': {
    tier: 'mid',
    prompt: 'doubt.decompose@1',
    schema: DoubtDecompositionSchema,
    maxOutputTokens: 2_000,
    timeoutMs: 60_000,
    cache: false,
  },
  'slip.classify': {
    // `best` because the label is written into the learner graph and persists.
    tier: 'best',
    prompt: 'slip.classify@2',
    schema: SlipClassificationSchema,
    maxOutputTokens: 2_000,
    timeoutMs: 20_000,
    cache: false,
  },
  'mindmap.build': {
    tier: 'mid',
    prompt: 'mindmap.build@1',
    schema: MindmapSchema,
    maxOutputTokens: 4_000,
    timeoutMs: 90_000,
    cache: true,
  },

  // ---- Eval ---------------------------------------------------------------
  'eval.judge': {
    tier: 'best',
    prompt: 'eval.judge@1',
    schema: EvalJudgementSchema,
    maxOutputTokens: 800,
    timeoutMs: 30_000,
    cache: false,
  },
} as const satisfies Record<string, TaskConfig>;

export type TaskId = keyof typeof TASKS;

export function taskConfig(task: TaskId): TaskConfig {
  const cfg = TASKS[task];
  if (!cfg) throw new Error(`Unknown task "${String(task)}"`);
  return cfg;
}

export function listTasks(): TaskId[] {
  return Object.keys(TASKS) as TaskId[];
}
