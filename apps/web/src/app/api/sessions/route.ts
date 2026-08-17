import { NextResponse } from 'next/server';
import { oid } from '@grasp/core';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The learner's conversations, newest first. Scoped — no id needed or accepted. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const url = new URL(req.url);
  const sessionId = url.searchParams.get('id');

  if (sessionId) {
    // A session id belonging to another learner resolves to nothing here — the
    // scope injects the owner filter, so this cannot leak.
    const convo = await session.scope
      .chatSessions()
      .findOne({ _id: oid(sessionId) } as never);
    if (!convo) return NextResponse.json({ error: 'no such conversation' }, { status: 404 });

    const messages = await session.scope
      .messages()
      .find({ sessionId: oid(sessionId) } as never)
      .sort({ createdAt: 1 })
      .toArray();

    return NextResponse.json({
      session: { id: String(convo._id), title: convo.title },
      messages: messages.map((m) => ({
        id: String(m._id),
        role: m.role,
        text: (m.parts as { text?: string }[] | undefined)?.[0]?.text ?? '',
        flags: m.flags ?? [],
        createdAt: m.createdAt,
      })),
    });
  }

  const list = await session.scope
    .chatSessions()
    .find({ archivedAt: null })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  return NextResponse.json({
    sessions: list.map((s) => ({
      id: String(s._id),
      title: s.title ?? 'New chat',
      createdAt: s.createdAt,
    })),
  });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Archive rather than delete: an abandoned branch is still eval data, and a
  // learner who deletes by accident has lost an explanation that worked.
  await session.scope
    .chatSessions()
    .updateOne({ _id: oid(id) } as never, { $set: { archivedAt: new Date() } });

  return NextResponse.json({ ok: true });
}
