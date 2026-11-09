import { NextResponse } from 'next/server';
import { Binary } from 'mongodb';
import { checkUpload, oid, readAttachment, sniff, takeToken } from '@grasp/core';
import {
  ATTACHMENT_LIMITS,
  cleanFilename,
  ObjectIdString,
  type AttachmentRef,
} from '@grasp/schema';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DAY = 86_400_000;
/** The largest single file plus multipart overhead — refused before buffering. */
const MAX_BODY = Math.max(...Object.values(ATTACHMENT_LIMITS.maxBytes)) + 64 * 1024;

/**
 * POST /api/attachments — one file, as multipart `file` (+ optional `sessionId`).
 *
 * Checked by its bytes, stored, and read into a transcript before answering, so
 * by the time the learner presses Send the tutor's view of the file is ready.
 * The chip in the composer shows "Reading…" for that wait.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const rate = takeToken(`upload:${session.userId}`, ATTACHMENT_LIMITS.uploadsPer10Min, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'That is a lot of uploads at once — try again in a few minutes.' },
      { status: 429, headers: { 'retry-after': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) {
    return NextResponse.json({ error: 'That file is too large.' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected a multipart upload with a `file` field' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'expected a multipart upload with a `file` field' }, { status: 400 });
  }
  const sessionIdRaw = form.get('sessionId');
  const sessionId =
    typeof sessionIdRaw === 'string' && ObjectIdString.safeParse(sessionIdRaw).success ? sessionIdRaw : null;

  if (file.size > MAX_BODY) return NextResponse.json({ error: 'That file is too large.' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = cleanFilename(file.name);
  const type = sniff(bytes, filename);
  const problem = checkUpload(type, bytes.byteLength);
  if (problem || !type) return NextResponse.json({ error: problem }, { status: 415 });

  const read = await readAttachment({
    kind: type.kind,
    mime: type.mime,
    bytes,
    filename,
    userId: session.userId,
  });

  const now = new Date();
  const inserted = await session.scope.attachments().insertOne({
    sessionId: sessionId ? oid(sessionId) : null,
    messageId: null,
    kind: type.kind,
    mime: type.mime,
    bytes: bytes.byteLength,
    filename,
    storage: 'inline',
    scope: 'session',
    status: 'ready',
    extract: read.text
      ? { text: read.text, chunkCount: 0, warnings: read.warnings, promptVersion: read.promptVersion }
      : null,
    // Text files are their transcript; only images and PDFs need their bytes later.
    data: type.kind === 'text' ? null : new Binary(Buffer.from(bytes)),
    createdAt: now,
    expiresAt: new Date(now.getTime() + ATTACHMENT_LIMITS.keepDays * DAY),
  } as never);

  return NextResponse.json({
    id: String(inserted.insertedId),
    name: filename,
    kind: type.kind,
    mime: type.mime,
    bytes: bytes.byteLength,
    read: Boolean(read.text),
    note: read.warnings[0],
  } satisfies AttachmentRef);
}
