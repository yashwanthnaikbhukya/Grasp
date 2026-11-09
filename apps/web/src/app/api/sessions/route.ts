import { NextResponse } from 'next/server';
import { oid } from '@grasp/core';
import {
  ChatMode,
  DEFAULT_CHAT_MODE,
  ObjectIdString,
  type AnswerSource,
  type AttachmentRef,
} from '@grasp/schema';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The learner's conversations, newest first. Scoped — no id needed or accepted. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const url = new URL(req.url);
  const sessionId = url.searchParams.get('id');
  if (sessionId !== null && !ObjectIdString.safeParse(sessionId).success) {
    return NextResponse.json({ error: 'invalid conversation id' }, { status: 400 });
  }

  if (sessionId) {
    // A session id belonging to another learner resolves to nothing here — the
    // scope injects the owner filter, so this cannot leak.
    const convo = await session.scope
      .chatSessions()
      .findOne({ _id: oid(sessionId) } as never);
    if (!convo) return NextResponse.json({ error: 'no such conversation' }, { status: 404 });

    // Superseded by Regenerate or Edit: kept for evals, never shown.
    const messages = await session.scope
      .messages()
      .find({ sessionId: oid(sessionId), supersededAt: null } as never)
      .sort({ createdAt: 1 })
      .toArray();

    const refsOf = (m: (typeof messages)[number]) =>
      ((m.parts as { kind?: string; attachmentId?: unknown }[] | undefined) ?? [])
        .filter((p) => p.kind === 'attachmentRef')
        .map((p) => String(p.attachmentId));
    const refIds = messages.flatMap(refsOf);
    const files = refIds.length
      ? await session.scope
          .attachments()
          .find({ _id: { $in: refIds.flatMap((id) => oid(id) ?? []) } } as never)
          .project({ data: 0, 'extract.text': 0 })
          .toArray()
      : [];
    const fileById = new Map(
      files.map((a): [string, AttachmentRef] => [
        String(a._id),
        {
          id: String(a._id),
          name: String(a.filename),
          kind: a.kind as AttachmentRef['kind'],
          mime: String(a.mime),
          bytes: Number(a.bytes ?? 0),
          read: Boolean(a.extract),
        },
      ]),
    );

    return NextResponse.json({
      session: {
        id: String(convo._id),
        title: convo.title,
        // Conversations from before modes existed open in the default.
        mode: ChatMode.catch(DEFAULT_CHAT_MODE).parse(convo.mode),
      },
      messages: messages.map((m) => ({
        id: String(m._id),
        role: m.role,
        text: (m.parts as { text?: string }[] | undefined)?.[0]?.text ?? '',
        flags: m.flags ?? [],
        mode: m.mode,
        // An expired file (past ATTACHMENT_LIMITS.keepDays) simply drops out.
        attachments: refsOf(m).flatMap((id) => fileById.get(id) ?? []),
        feedback: (m.feedback as { rating?: 'up' | 'down' } | undefined)?.rating ?? null,
        // Answers saved before 2026-11-09 have no stored sources and show none.
        ...(m.role === 'assistant'
          ? {
              sources: (m.sources as AnswerSource[] | undefined) ?? [],
              meta: m.understoodAs ? { rewritten: String(m.understoodAs) } : undefined,
            }
          : {}),
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
      mode: ChatMode.catch(DEFAULT_CHAT_MODE).parse(s.mode),
      createdAt: s.createdAt,
    })),
  });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id || !ObjectIdString.safeParse(id).success) {
    return NextResponse.json({ error: 'a valid conversation id is required' }, { status: 400 });
  }

  // Archive rather than delete: an abandoned branch is still eval data, and a
  // learner who deletes by accident has lost an explanation that worked.
  const res = await session.scope
    .chatSessions()
    .updateOne({ _id: oid(id) } as never, { $set: { archivedAt: new Date() } });

  // Scoped, so another learner's id matches nothing — and says so, like GET does,
  // rather than reporting a delete that never happened (2026-11-09 test pass).
  if (res.matchedCount === 0) {
    return NextResponse.json({ error: 'no such conversation' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
