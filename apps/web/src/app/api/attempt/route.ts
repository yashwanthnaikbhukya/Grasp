import { NextResponse } from 'next/server';
import {
  answersAgree,
  collections,
  currentP,
  emit,
  expectedAnswer,
  idempotencyKey,
  initialMastery,
  oid,
  updateMastery,
} from '@grasp/core';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Record an attempt.
 *
 * Grading is server-side because the client never receives the answer key, and
 * because this is the moment the learner model actually learns something: the
 * attempt is appended to the event log, then folded into mastery.
 *
 * Event first, projection second. If the fold fails, the evidence survives and a
 * replay recovers it — the reverse order would lose the observation permanently.
 * See docs/adr/0003-event-sourced-learner-state.md.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  let body: { questionId?: string; answer?: unknown; latencyMs?: number; hintsUsed?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'expected JSON' }, { status: 400 });
  }

  const questionId = oid(body.questionId);
  if (!questionId) return NextResponse.json({ error: 'bad question id' }, { status: 400 });

  const question = await collections.questions().findOne({ _id: questionId } as never);
  if (!question) return NextResponse.json({ error: 'no such question' }, { status: 404 });

  const type = question.type as Parameters<typeof answersAgree>[0];
  const key = expectedAnswer({
    type,
    stem: String(question.stem),
    options: question.options as { id: string; text: string; isCorrect: boolean }[] | undefined,
    answer: question.answer,
    solution: String(question.solution ?? ''),
    difficultyGuess: Number(question.difficulty ?? 0),
    conceptIds: (question.conceptIds as string[]) ?? [],
  });

  const correct = answersAgree(type, body.answer, key);
  const latencyMs = Math.max(0, Math.min(Number(body.latencyMs ?? 0), 3_600_000));
  const hintsUsed = Math.max(0, Number(body.hintsUsed ?? 0));
  const conceptIds = (question.conceptIds as string[]) ?? [];
  const now = new Date();

  // --- 1. append the evidence -------------------------------------------
  const attemptDoc = await session.scope.attempts().insertOne({
    questionId,
    conceptIds,
    correct,
    answer: body.answer,
    latencyMs,
    hintsUsed,
    surface: 'reps',
    ts: now,
  } as never);

  await emit({
    type: 'attempt.recorded',
    userId: session.userId,
    idempotencyKey: idempotencyKey(
      'attempt.recorded',
      session.userId,
      String(attemptDoc.insertedId),
    ),
    payload: {
      questionId: String(questionId),
      conceptIds,
      correct,
      answer: body.answer,
      latencyMs,
      hintsUsed,
      surface: 'reps',
    },
  }).catch((e: unknown) => {
    // The attempt row is already written, so the learner keeps their answer and
    // a replay can recover the projection. But this must not be silent: a
    // swallowed failure here hid an ObjectId/string mismatch that made every
    // event invisible to its owner.
    console.error('[attempt] event write failed', e);
  });

  // --- 2. fold into mastery ---------------------------------------------
  const updated: { conceptId: string; p: number; state: string }[] = [];

  for (const conceptId of conceptIds) {
    const existing = await session.scope.mastery().findOne({ conceptId } as never);

    const prev = existing
      ? {
          p: Number(existing.p ?? 0),
          attempts: Number(existing.attempts ?? 0),
          correct: Number(existing.correct ?? 0),
          elo: Number(existing.elo ?? 1200),
          stability: Number(existing.stability ?? 1),
          difficulty: Number(existing.difficulty ?? 0),
          lastSeenAt: (existing.lastSeenAt as Date | null) ?? null,
          nextDueAt: (existing.nextDueAt as Date) ?? now,
          state: (existing.state as ReturnType<typeof initialMastery>['state']) ?? 'unseen',
        }
      : initialMastery(now);

    const next = updateMastery(
      prev,
      {
        correct,
        latencyMs,
        hintsUsed,
        itemDifficulty: Number(question.difficulty ?? 0),
      },
      now,
    );

    await session.scope.mastery().updateOne(
      { conceptId } as never,
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
        },
        $setOnInsert: { conceptId },
      },
      { upsert: true },
    );

    updated.push({ conceptId, p: next.p, state: next.state });
  }

  return NextResponse.json({
    correct,
    // Shown after answering, never before.
    solution: String(question.solution ?? ''),
    correctAnswer: key,
    mastery: updated,
  });
}
