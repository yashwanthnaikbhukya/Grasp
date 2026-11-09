import {
  ATTACHMENT_LIMITS,
  ATTACHMENT_MIME,
  type AttachmentKind,
} from '@grasp/schema';
import { generate } from '../llm/gateway';
import { taskConfig } from '../llm/registry';
import type { InlineFile } from '../llm/types';

/**
 * Attachments in Ask: what a file *is*, what it *says*, and how a turn carries it.
 *
 * Interim design, until object storage and the extraction job (docs/07-phases.md
 * §1.5) land: the bytes live on the Mongo document within ATTACHMENT_LIMITS, and
 * the file is read once, at upload, into a transcript. The transcript is what
 * query understanding, retrieval and history see; the tutor also gets the file
 * itself when its provider can open it.
 */

export interface Sniffed {
  kind: AttachmentKind;
  mime: string;
}

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  sig.every((x, i) => b[at + i] === x);

const TEXT_EXT: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
};

/**
 * The file's real type, from its first bytes — never from the browser's
 * declared MIME or the filename alone. A file that is none of the accepted
 * kinds returns null. Text needs a text extension *and* clean UTF-8, so an
 * HTML or SVG file renamed `.txt` still has to be text to pass, and SVG (which
 * can carry script) is never accepted as an image.
 */
export function sniff(bytes: Uint8Array, filename: string): Sniffed | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: 'image', mime: 'image/gif' };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { kind: 'image', mime: 'image/webp' };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: 'pdf', mime: 'application/pdf' };

  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const textMime = TEXT_EXT[ext];
  if (!textMime) return null;
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return { kind: 'text', mime: textMime };
}

/** Accepted, and within its kind's size limit. Returns the reason when not. */
export function checkUpload(s: Sniffed | null, bytes: number): string | null {
  if (!s || !ATTACHMENT_MIME[s.kind].includes(s.mime)) {
    return 'That file type is not supported. Attach a photo (PNG, JPEG, WebP), a PDF, or a text file.';
  }
  const max = ATTACHMENT_LIMITS.maxBytes[s.kind];
  if (bytes > max) return `That ${s.kind === 'image' ? 'image' : s.kind === 'pdf' ? 'PDF' : 'file'} is over ${Math.round(max / 1024 / 1024) || 0.3} MB.`;
  if (bytes === 0) return 'That file is empty.';
  return null;
}

export interface ReadResult {
  text: string | null;
  warnings: string[];
  promptVersion?: string;
}

/** Stored transcript cap per file; what reaches the tutor is capped again per turn. */
const STORED_CHARS = 40_000;

/** Turn an attachment into text, once, at upload. Never throws — a failed read is a warning. */
export async function readAttachment(args: {
  kind: AttachmentKind;
  mime: string;
  bytes: Uint8Array;
  filename: string;
  userId?: string;
}): Promise<ReadResult> {
  if (args.kind === 'text') {
    const text = new TextDecoder().decode(args.bytes);
    return text.length > STORED_CHARS
      ? { text: text.slice(0, STORED_CHARS), warnings: ['Only the first part of this file was read.'] }
      : { text, warnings: [] };
  }

  try {
    const res = await generate({
      task: 'attachment.read',
      input: { filename: args.filename, kind: args.kind },
      files: [{ mime: args.mime, base64: Buffer.from(args.bytes).toString('base64'), name: args.filename }],
      filesRequired: true,
      userId: args.userId,
    });
    const text = res.text.trim().slice(0, STORED_CHARS);
    return {
      text: text || null,
      warnings: text ? [] : ['Nothing readable was found in this file.'],
      promptVersion: taskConfig('attachment.read').prompt,
    };
  } catch (e) {
    console.error('[attachments] read failed', e instanceof Error ? e.message : e);
    return { text: null, warnings: ['This file could not be read right now.'] };
  }
}

export interface TurnAttachment {
  filename: string;
  kind: AttachmentKind;
  mime: string;
  text: string | null;
  /** Present for images and PDFs; text files travel as text only. */
  bytes?: Uint8Array;
}

/**
 * How a turn carries its attachments to the tutor.
 *
 * `text` is the learner's message with each file's transcript appended under
 * an `[Attached: …]` line — that is all a text-only provider sees, and what is
 * stored as history. `files` go inline to providers that can open them. The
 * transcript budget is shared across the turn's files.
 */
export function composeTurn(message: string, attachments: TurnAttachment[]): { text: string; files: InlineFile[] } {
  let budget: number = ATTACHMENT_LIMITS.transcriptChars;
  const blocks = attachments.map((a) => {
    const transcript = (a.text ?? '').slice(0, Math.max(0, budget));
    budget -= transcript.length;
    const label = `[Attached ${a.kind === 'image' ? 'image' : a.kind === 'pdf' ? 'PDF' : 'file'}: ${a.filename}]`;
    if (!transcript) return `${label}\n(Its contents could not be read as text.)`;
    const cut = a.text && transcript.length < a.text.length ? '\n[…the rest of the file is not shown]' : '';
    return `${label}\n${transcript}${cut}`;
  });
  const text = [message.trim() || (attachments.length > 0 ? 'Help me with the attached file.' : ''), ...blocks]
    .filter(Boolean)
    .join('\n\n');
  const files: InlineFile[] = attachments.flatMap((a) =>
    a.bytes && a.kind !== 'text'
      ? [{ mime: a.mime, base64: Buffer.from(a.bytes).toString('base64'), name: a.filename }]
      : [],
  );
  return { text, files };
}

/** A shorter version for query understanding and retrieval: the message plus the start of each transcript. */
export function queryForRetrieval(message: string, attachments: Pick<TurnAttachment, 'text'>[]): string {
  const extra = attachments
    .map((a) => (a.text ?? '').slice(0, 600))
    .filter(Boolean)
    .join('\n');
  return [message.trim(), extra].filter(Boolean).join('\n\n').slice(0, 2_000) || 'the attached file';
}
