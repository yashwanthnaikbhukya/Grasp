import { z } from 'zod';
import { ConceptId, MasteryState, ObjectIdString, RootCause, Surface } from './common';
import { LearnerProfileSchema } from './profile';

/**
 * Derived learner state. Never authored, never hand-edited — rebuildable by
 * replaying `events`. See docs/adr/0003-event-sourced-learner-state.md.
 */
export const MasterySchema = z.object({
  userId: ObjectIdString,
  conceptId: ConceptId,

  /** Probability the learner knows this concept *now*. Decays with time away. */
  p: z.number().min(0).max(1),
  attempts: z.number().int().min(0),
  correct: z.number().int().min(0),

  /** Ability estimate on this concept, Elo scale. */
  elo: z.number(),

  /** Spaced-repetition params. Deliberately simpler than FSRS for Phase 2. */
  stability: z.number().min(0),
  difficulty: z.number(),

  lastSeenAt: z.coerce.date().nullable(),
  /** The due-queue key. Indexed with userId; hit on every feed load. */
  nextDueAt: z.coerce.date(),
  state: MasteryState,

  /** Replay watermark — makes a rebuild resumable and a partial one detectable. */
  updatedFromEventSeq: z.number().int().min(0),
});
export type Mastery = z.infer<typeof MasterySchema>;

export const EpisodeSchema = z.object({
  userId: ObjectIdString,
  kind: z.enum(['doubt', 'struggle', 'breakthrough']),
  conceptIds: z.array(ConceptId),
  summary: z.string().max(400),
  sourceRef: z.string().optional(),
  createdAt: z.coerce.date(),
});
export type Episode = z.infer<typeof EpisodeSchema>;

/**
 * An active, named wrong belief. The single highest-value item in the learner
 * card — stated as the learner's belief, never as a correction, so the model
 * decides how to address it.
 */
export const MisconceptionSchema = z.object({
  userId: ObjectIdString,
  conceptId: ConceptId,
  statement: z.string().max(240),
  evidenceCount: z.number().int().min(1),
  firstSeenAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable().default(null),
});
export type Misconception = z.infer<typeof MisconceptionSchema>;

export const AttemptSchema = z.object({
  _id: ObjectIdString.optional(),
  userId: ObjectIdString,
  questionId: ObjectIdString,
  conceptIds: z.array(ConceptId),
  correct: z.boolean(),
  answer: z.unknown(),
  latencyMs: z.number().int().min(0),
  hintsUsed: z.number().int().min(0),
  surface: Surface,
  sessionRef: z.string().optional(),
  ts: z.coerce.date(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const SlipSchema = z.object({
  _id: ObjectIdString.optional(),
  userId: ObjectIdString,
  attemptId: ObjectIdString,
  conceptId: ConceptId,
  rootCause: RootCause,
  note: z.string().max(240),
  /** Low-confidence labels are stored but kept out of learner-facing digests. */
  confidence: z.number().min(0).max(1),
  upstreamConceptId: ConceptId.optional(),
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable().default(null),
});
export type Slip = z.infer<typeof SlipSchema>;

export const UserSchema = z.object({
  _id: ObjectIdString.optional(),
  /**
   * Better Auth owns the credential record; this is Grasp's learner record.
   * Two collections so an auth-library upgrade can never migrate learner data.
   */
  authId: z.string().min(1),
  email: z.string().email(),
  /**
   * Display name only. **Never enters a prompt** — the learner card addresses the
   * learner in the second person and carries no PII, so a prompt leak is not a
   * PII leak. See docs/10-onboarding.md.
   */
  name: z.string().min(1),

  /**
   * Everything about who this learner is and what they need, from onboarding.
   * This replaced the old process-level board/grade/subject scope: scope belongs
   * to the learner, not the deployment.
   * See docs/adr/0006-curriculum-agnostic-concepts.md.
   */
  profile: LearnerProfileSchema.default({}),

  streak: z
    .object({
      current: z.number().int().min(0).default(0),
      longest: z.number().int().min(0).default(0),
      lastActiveDate: z.coerce.date().nullable().default(null),
    })
    .default({ current: 0, longest: 0, lastActiveDate: null }),
  xp: z.number().int().min(0).default(0),

  /** null ⇒ show the 8-question cold-start placement. */
  placementDoneAt: z.coerce.date().nullable().default(null),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;
