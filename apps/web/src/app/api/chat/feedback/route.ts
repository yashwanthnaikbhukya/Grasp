import { NextResponse } from 'next/server';
import { oid } from '@grasp/core';
import { ChatFeedbackRequestSchema } from '@grasp/schema';
import { getSession } from '@/lib/session';
import { badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Thumbs on a tutor answer. Stored on the message: a thumbs-down is the cheapest
 * golden-set candidate there is, and it carries the prompt version that wrote
 * the answer. Scoped — another learner's message id matches nothing.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const parsed = ChatFeedbackRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  const { messageId, rating } = parsed.data;

  const res = await session.scope.messages().updateOne(
    { _id: oid(messageId), role: 'assistant' } as never,
    (rating ? { $set: { feedback: { rating, at: new Date() } } } : { $unset: { feedback: '' } }) as never,
  );
  if (res.matchedCount === 0) return NextResponse.json({ error: 'no such answer' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
