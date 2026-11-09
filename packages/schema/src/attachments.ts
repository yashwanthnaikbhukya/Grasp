import { z } from 'zod';
import { ObjectIdString } from './common';

/**
 * Attachments in Ask — the shapes and the limits, shared by the browser (which
 * checks before uploading) and the server (which checks again, by the file's
 * bytes rather than its name). See docs/05-context-broker.md — Attachments.
 */

export const AttachmentKind = z.enum(['image', 'pdf', 'text']);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

/** MIME types accepted, by kind. The server re-derives the type from magic bytes. */
export const ATTACHMENT_MIME: Record<AttachmentKind, readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  pdf: ['application/pdf'],
  text: ['text/plain', 'text/markdown', 'text/csv'],
};

/** The `accept` attribute for the file picker. */
export const ATTACHMENT_ACCEPT = [
  ...ATTACHMENT_MIME.image,
  ...ATTACHMENT_MIME.pdf,
  ...ATTACHMENT_MIME.text,
  '.md',
  '.txt',
  '.csv',
].join(',');

export const ATTACHMENT_LIMITS = {
  /** Per message. Four photos of a worksheet is a real use; forty is not. */
  perMessage: 4,
  /** Bytes, after the browser has downscaled a photo to ≤ 1,600 px. */
  maxBytes: { image: 5 * 1024 * 1024, pdf: 8 * 1024 * 1024, text: 300 * 1024 } as Record<
    AttachmentKind,
    number
  >,
  /** Longest side a photo is downscaled to before upload — legible, and small. */
  imageMaxSide: 1600,
  /** Uploads per learner per 10 minutes. */
  uploadsPer10Min: 20,
  /** Characters of an attachment's transcript that reach the tutor, all files together. */
  transcriptChars: 12_000,
  /** Session attachments are kept this long, then deleted by a TTL index. */
  keepDays: 30,
} as const;

/** What the client knows about an attachment — never its bytes. */
export const AttachmentRefSchema = z.object({
  id: ObjectIdString,
  name: z.string(),
  kind: AttachmentKind,
  mime: z.string(),
  bytes: z.number().int().min(0),
  /** The model could read it. False ⇒ the tutor still gets the file, if its provider can open it. */
  read: z.boolean(),
  /** A short note for the learner when something went partly wrong. */
  note: z.string().optional(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

/** Shorten and clean a filename for display and storage. */
export function cleanFilename(name: string): string {
  // Control characters and path/shell-significant characters go.
  const cleaned = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f && !'<>:"/\\|?*'.includes(ch);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'attachment';
  if (cleaned.length <= 80) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 6 ? cleaned.slice(dot) : '';
  return `${cleaned.slice(0, 80 - ext.length - 1)}…${ext}`;
}
