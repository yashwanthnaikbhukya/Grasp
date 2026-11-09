import { z } from 'zod';
import { ConceptId, MasteryState, ObjectIdString, QuestionType } from './common';

/**
 * Request and response shapes for the HTTP routes in `apps/web`.
 *
 * One definition per shape (CLAUDE.md rule 3): the route parses requests with
 * these, and the client imports the inferred types instead of hand-writing them.
 */

// ---- Reps: POST /api/attempt ------------------------------------------------

/** What a learner can submit as an answer. Bounded, because it lands in `events`. */
export const AnswerValue = z.union([
  z.string().max(2_000),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(500), z.number()])).max(50),
]);

export const AttemptRequestSchema = z.object({
  /**
   * Minted by the client once per card render. It is the idempotency key, so a
   * retried POST is the same attempt — never a second one.
   */
  attemptId: z.string().uuid(),
  questionId: ObjectIdString,
  answer: AnswerValue,
  /** Rounded, not rejected: `performance.now()` arithmetic is fractional. */
  latencyMs: z.number().min(0).max(3_600_000).transform(Math.round),
  hintsUsed: z.number().int().min(0).max(20).default(0),
  positionInSession: z.number().int().min(0).max(1_000).default(0),
  sessionLength: z.number().int().min(1).max(1_000).default(1),
});
export type AttemptRequest = z.infer<typeof AttemptRequestSchema>;

export const MasteryDeltaSchema = z.object({
  conceptId: ConceptId,
  p: z.number().min(0).max(1),
  state: MasteryState,
});
export type MasteryDelta = z.infer<typeof MasteryDeltaSchema>;

export const AttemptResultSchema = z.object({
  correct: z.boolean(),
  /** Shown after answering, never before. */
  solution: z.string(),
  correctAnswer: z.unknown(),
  mastery: z.array(MasteryDeltaSchema),
  /** True when this attemptId was already recorded — nothing was counted twice. */
  duplicate: z.boolean(),
});
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

// ---- Reps: GET /api/feed ------------------------------------------------------

export const FeedQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(30).default(12),
  /** Practise one idea — linked from Today's "Fix this first" and the Map. */
  concept: ConceptId.optional(),
});

export const FeedPool = z.enum(['due', 'weak', 'frontier', 'interleave']);
export type FeedPool = z.infer<typeof FeedPool>;

/** A card as the client sees it — options without `isCorrect`, no solution. */
export const FeedCardSchema = z.object({
  id: ObjectIdString,
  type: QuestionType,
  stem: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  conceptId: ConceptId,
  conceptName: z.string(),
  pool: FeedPool,
});
export type FeedCard = z.infer<typeof FeedCardSchema>;

export const FeedResponseSchema = z.object({
  cards: z.array(FeedCardSchema),
  empty: z.string().optional(),
  message: z.string().optional(),
});
export type FeedResponse = z.infer<typeof FeedResponseSchema>;
