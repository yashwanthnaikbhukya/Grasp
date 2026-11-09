import type { AttemptRequest, AttemptResult, MasteryDelta, Surface } from '@grasp/schema';
import { forUser } from '../auth/scope';
import { collections } from '../db/collections';
import { oid } from '../db/oid';
import { emit, idempotencyKey } from '../events/emit';
import { answersAgree, expectedAnswer } from '../questions/verify';
import { recordSlip } from '../slips/record';
import { masteryFromDoc, updateMastery } from './mastery';

/**
 * Record one attempt: grade → append the event → project it into mastery.
 *
 * The single path for an attempt, so `/api/attempt` and a future
 * `learner:rebuild` cannot disagree about what an attempt does to a learner.
 *
 * **Event first, and nothing without it.** If the event write fails this throws
 * before anything is folded — a mastery change with no event behind it can never
 * be rebuilt (rule 4). The caller turns that into a 503 and the client retries
 * with the same `attemptId`, which is the idempotency key, so a retry is the same
 * attempt rather than a second one.
 *
 * **Projection is watermarked.** Each mastery row records `updatedFromEventSeq`.
 * A first-time event always folds (with optimistic concurrency, so two attempts
 * racing on one concept both land). A duplicate event only folds into rows whose
 * watermark is still below its seq — the crash-between-event-and-fold case —
 * so replays and retries never count twice.
 */

export interface RecordAttemptInput extends AttemptRequest {
  userId: string;
  surface?: Surface;
}

export interface RecordAttemptOutcome {
  result: AttemptResult;
  /**
   * Work to run after the response is sent (slip classification). The route
   * hands it to `after()` so a serverless runtime keeps it alive.
   */
  afterResponse?: () => Promise<unknown>;
}

const FOLD_RETRIES = 5;

export async function recordAttempt(
  input: RecordAttemptInput,
  now = new Date(),
): Promise<RecordAttemptOutcome | null> {
  const questionOid = oid(input.questionId);
  if (!questionOid) return null;

  // Rule 6: grading returns the solution and moves mastery, so an unverified
  // question must be as unreachable by id as it is in the feed.
  const question = await collections
    .questions()
    .findOne({ _id: questionOid, verificationStatus: 'verified' } as never);
  if (!question) return null;

  const type = question.type as Parameters<typeof answersAgree>[0];
  const conceptIds = ((question.conceptIds as string[] | undefined) ?? []).filter(Boolean);
  // An attempt the learner model can't attribute is evidence about nothing; the
  // feed never serves such a card, so reaching here means a stale client.
  if (conceptIds.length === 0) return null;
  const key = expectedAnswer({
    type,
    stem: String(question.stem),
    options: question.options as { id: string; text: string; isCorrect: boolean }[] | undefined,
    answer: question.answer,
    solution: String(question.solution ?? ''),
    difficultyGuess: Number(question.difficulty ?? 0),
    conceptIds,
  });
  const correct = answersAgree(type, input.answer, key);
  const surface = input.surface ?? 'reps';

  // --- 1. the evidence: append-only, idempotent on the client's attemptId ----
  const event = await emit({
    type: 'attempt.recorded',
    userId: input.userId,
    idempotencyKey: idempotencyKey('attempt.recorded', input.userId, input.attemptId),
    ts: now,
    payload: {
      questionId: input.questionId,
      conceptIds,
      correct,
      answer: input.answer,
      latencyMs: input.latencyMs,
      hintsUsed: input.hintsUsed,
      surface,
    },
  });

  const scope = forUser(input.userId);

  // --- 2 + 3. the attempt row and the projection, together -------------------
  // Both follow the event and neither reads the other, so they share one round
  // trip instead of two (the answer → verdict wait, 2026-11-09). The order that
  // matters — event first — is unchanged.
  //
  // The attempt row is keyed on the event, so a retry cannot duplicate it.
  // `questionId` is a string, like the event payload (rule 12) — two
  // representations of one id made attempts and events un-joinable.
  const writeAttempt = scope.attempts().updateOne(
    { eventSeq: event.seq } as never,
    {
      $setOnInsert: {
        attemptId: input.attemptId,
        eventSeq: event.seq,
        questionId: input.questionId,
        conceptIds,
        correct,
        answer: input.answer,
        latencyMs: input.latencyMs,
        hintsUsed: input.hintsUsed,
        surface,
        ts: now,
      },
    } as never,
    { upsert: true },
  );

  // Concepts fold one after another, as before: each fold is an optimistic
  // read-modify-write on its own row, and nothing here needs them concurrent.
  const foldAll = (async () => {
    const out: MasteryDelta[] = [];
    for (const conceptId of conceptIds) {
      out.push(
        await foldOne({
          userId: input.userId,
          conceptId,
          seq: event.seq,
          duplicate: event.duplicate,
          signal: {
            correct,
            latencyMs: input.latencyMs,
            hintsUsed: input.hintsUsed,
            itemDifficulty: Number(question.difficulty ?? 0),
          },
          now,
        }),
      );
    }
    return out;
  })();

  const [, mastery] = await Promise.all([writeAttempt, foldAll]);

  const result: AttemptResult = {
    correct,
    solution: String(question.solution ?? ''),
    correctAnswer: key,
    mastery,
    duplicate: event.duplicate,
  };

  // --- 4. classify the mistake — after the learner has their answer ----------
  const afterResponse =
    !correct && !event.duplicate
      ? () =>
          recordSlip({
            userId: input.userId,
            attemptId: input.attemptId,
            questionId: input.questionId,
            conceptIds,
            stem: String(question.stem),
            correctAnswer: key,
            studentAnswer: input.answer,
            latencyMs: input.latencyMs,
            hintsUsed: input.hintsUsed,
            positionInSession: input.positionInSession,
            sessionLength: input.sessionLength,
          })
      : undefined;

  return { result, afterResponse };
}

async function foldOne(args: {
  userId: string;
  conceptId: string;
  seq: number;
  duplicate: boolean;
  signal: Parameters<typeof updateMastery>[1];
  now: Date;
}): Promise<MasteryDelta> {
  const masteryCol = forUser(args.userId).mastery();

  for (let attempt = 0; attempt < FOLD_RETRIES; attempt++) {
    const doc = (await masteryCol.findOne({ conceptId: args.conceptId } as never)) as
      | Record<string, unknown>
      | null;
    const watermark = typeof doc?.updatedFromEventSeq === 'number' ? doc.updatedFromEventSeq : null;
    const prev = masteryFromDoc(doc, args.now);

    // A retried event whose fold already landed: report, don't re-apply.
    if (args.duplicate && watermark !== null && watermark >= args.seq) {
      return { conceptId: args.conceptId, p: prev.p, state: prev.state };
    }

    const next = updateMastery(prev, args.signal, args.now);

    // Optimistic concurrency on the row we read. `updatedFromEventSeq` only ever
    // moves forward, so a concurrent fold makes this filter miss and we re-read.
    const filter: Record<string, unknown> = { conceptId: args.conceptId };
    filter.updatedFromEventSeq = watermark === null ? { $exists: false } : watermark;

    try {
      const res = await masteryCol.updateOne(
        filter as never,
        {
          $set: {
            p: next.p,
            attempts: next.attempts,
            correct: next.correct,
            elo: next.elo,
            stability: next.stability,
            difficulty: next.difficulty,
            lastSeenAt: next.lastSeenAt,
            nextDueAt: next.nextDueAt,
            state: next.state,
            updatedFromEventSeq: Math.max(watermark ?? 0, args.seq),
          },
          $setOnInsert: { conceptId: args.conceptId },
        } as never,
        // Upsert only when no row existed; otherwise a missed filter would try
        // to insert a second row for the concept.
        { upsert: doc === null },
      );
      if (res.matchedCount > 0 || res.upsertedCount > 0) {
        return { conceptId: args.conceptId, p: next.p, state: next.state };
      }
    } catch (e) {
      // Two first-ever folds on one concept raced to insert; the unique
      // (userId, conceptId) index rejected ours. Re-read and fold on top.
      if (!isDuplicateKey(e)) throw e;
    }
  }

  throw new Error(`mastery fold for ${args.conceptId} lost ${FOLD_RETRIES} races in a row`);
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 11000;
}
