import { NextResponse } from 'next/server';
import type { Binary } from 'mongodb';
import { oid } from '@grasp/core';
import { ObjectIdString } from '@grasp/schema';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * GET — the file itself, for thumbnails and "open" in the conversation. Scoped:
 * another learner's id is a 404. Served with its sniffed type and `nosniff`, so
 * the browser never reinterprets it.
 */
export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { id } = await params;
  if (!ObjectIdString.safeParse(id).success) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const doc = await session.scope.attachments().findOne({ _id: oid(id) } as never);
  if (!doc) return NextResponse.json({ error: 'no such attachment' }, { status: 404 });

  const data = doc.data as Binary | null | undefined;
  const body =
    data ? new Uint8Array(data.buffer) : new TextEncoder().encode(String((doc.extract as { text?: string } | null)?.text ?? ''));
  const mime = data ? String(doc.mime) : 'text/plain; charset=utf-8';

  return new Response(body, {
    headers: {
      'content-type': mime,
      'content-length': String(body.byteLength),
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(String(doc.filename))}`,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
      // A PDF opened in the browser must not run anything against this origin.
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** DELETE — removed from the composer before sending. A sent attachment stays with its message. */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { id } = await params;
  if (!ObjectIdString.safeParse(id).success) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const res = await session.scope.attachments().deleteOne({ _id: oid(id), messageId: null } as never);
  if (res.deletedCount === 0) return NextResponse.json({ error: 'no such unsent attachment' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
