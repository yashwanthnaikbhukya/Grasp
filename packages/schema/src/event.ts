import { z } from 'zod';
import { ConceptId, ObjectIdString, RootCause, Surface } from './common';

/**
 * The append-only event log. See docs/adr/0003-event-sourced-learner-state.md.
 *
 * Rules that are not negotiable:
 *   · never update, never delete — corrections are new superseding events
 *   · every event carries an idempotencyKey (unique index) so retries are free
 *   · `seq` is monotonic and is the replay cursor
 */

export const AttemptRecordedPayload = z.object({
  questionId: ObjectIdString,
  conceptIds: z.array(ConceptId).min(1),
  correct: z.boolean(),
  /** What they actually chose. Needed for root-cause analysis, not just scoring. */
  answer: z.unknown(),
  /**
   * Latency distinguishes failure modes a boolean cannot: fast+wrong reads as
   * careless, slow+wrong as a genuine conceptual gap.
   */
  latencyMs: z.number().int().min(0),
  hintsUsed: z.number().int().min(0).default(0),
  surface: Surface,
  sessionRef: z.string().optional(),
});

export const CardSkippedPayload = z.object({
  questionId: ObjectIdString,
  conceptIds: z.array(ConceptId),
  dwellMs: z.number().int().min(0),
});

export const DoubtAskedPayload = z.object({
  conceptIds: z.array(ConceptId),
  sourceRef: z.string().optional(),
  surface: Surface,
});

export const HintRequestedPayload = z.object({
  questionId: ObjectIdString,
  level: z.number().int().min(1).max(3),
});

export const SessionBoundaryPayload = z.object({
  surface: Surface,
  durationMs: z.number().int().min(0).optional(),
  cardCount: z.number().int().min(0).optional(),
});

export const PlacementCompletedPayload = z.object({
  estimates: z.array(z.object({ conceptId: ConceptId, p: z.number().min(0).max(1) })),
  questionCount: z.number().int().min(1),
});

export const MisconceptionObservedPayload = z.object({
  conceptId: ConceptId,
  /** Stated as the learner's belief, never as a correction. */
  statement: z.string().min(1).max(240),
  rootCause: RootCause.optional(),
});

export const MasteryRebuiltPayload = z.object({
  fromSeq: z.number().int().min(0),
  toSeq: z.number().int().min(0),
  reason: z.string(),
});

/** Discriminated on `type`, so payload validation is exact per event kind. */
export const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('attempt.recorded'), payload: AttemptRecordedPayload }),
  z.object({ type: z.literal('card.skipped'), payload: CardSkippedPayload }),
  z.object({ type: z.literal('doubt.asked'), payload: DoubtAskedPayload }),
  z.object({ type: z.literal('hint.requested'), payload: HintRequestedPayload }),
  z.object({ type: z.literal('session.started'), payload: SessionBoundaryPayload }),
  z.object({ type: z.literal('session.ended'), payload: SessionBoundaryPayload }),
  z.object({ type: z.literal('placement.completed'), payload: PlacementCompletedPayload }),
  z.object({ type: z.literal('misconception.observed'), payload: MisconceptionObservedPayload }),
  z.object({ type: z.literal('mastery.rebuilt'), payload: MasteryRebuiltPayload }),
]);
export type GraspEventBody = z.infer<typeof EventSchema>;
export type GraspEventType = GraspEventBody['type'];

/** What `emit()` accepts. `seq` and `_id` are assigned by the writer. */
export const EventInputSchema = z.intersection(
  EventSchema,
  z.object({
    userId: ObjectIdString,
    /**
     * Convention: `{type}:{userId}:{naturalKey}` — never a random value, or
     * retries stop being free. See docs/06-learner-model.md.
     */
    idempotencyKey: z.string().min(8).max(200),
    ts: z.coerce.date().optional(),
  }),
);
export type EventInput = z.infer<typeof EventInputSchema>;

/** What lands in the `events` collection. */
export type StoredEvent = EventInput & {
  seq: number;
  ts: Date;
};
