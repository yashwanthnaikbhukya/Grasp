import { after, NextResponse } from 'next/server';
import { AttemptRequestSchema } from '@grasp/schema';
import { recordAttempt } from '@grasp/core';
import { getSession } from '@/lib/session';
import { badRequest, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Record an attempt. Thin on purpose — grading, the event and the mastery fold
 * live in `recordAttempt()` in `@grasp/core`, so a replay and this route can
 * never disagree about what an attempt does to a learner.
 *
 * Idempotent on the client's `attemptId`: a retried POST returns the same result
 * with `duplicate: true` and counts nothing twice.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const parsed = AttemptRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);

  let outcome: Awaited<ReturnType<typeof recordAttempt>>;
  try {
    outcome = await recordAttempt({ ...parsed.data, userId: session.userId });
  } catch (e) {
    // Most likely the event write. Nothing was folded without it (rule 4), so
    // the client can safely retry with the same attemptId.
    return serverError('attempt', e, 503, 'Could not save that answer. Try again.');
  }
  if (!outcome) return NextResponse.json({ error: 'no such question' }, { status: 404 });

  // Slip classification runs after the response — the learner never waits for
  // it, and `after()` keeps a serverless runtime alive until it finishes.
  const work = outcome.afterResponse;
  if (work) {
    after(() =>
      work().catch((e: unknown) => {
        // A missing label degrades the digest; it must never break practice.
        console.error('[attempt] slip classification failed', e);
      }),
    );
  }

  return NextResponse.json(outcome.result);
}
