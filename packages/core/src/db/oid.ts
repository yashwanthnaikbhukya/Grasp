import { ObjectId } from 'mongodb';

/**
 * String → ObjectId, for callers that must not import the Mongo driver.
 *
 * `apps/web` owns no business logic and does not depend on the driver
 * (docs/09-conventions.md), but route handlers still need to build id filters.
 * This is the sanctioned seam.
 *
 * Returns null on a malformed id rather than throwing: ids arrive from URLs and
 * request bodies, so a bad one is untrusted input to reject with a 404, not an
 * exception to surface as a 500.
 */
export function oid(value: string | null | undefined): ObjectId | null {
  if (!value || !/^[0-9a-fA-F]{24}$/.test(value)) return null;
  return new ObjectId(value);
}

export type { ObjectId };

/**
 * Any id representation → its 24-character hex string.
 *
 * Necessary because an ObjectId does not always arrive as an ObjectId. Crossing
 * a serialization boundary — a third-party adapter, a server/client hop — turns
 * it into a plain object carrying a byte buffer, and `String()` on that yields
 * `"[object Object]"`, which then matches nothing and throws no error.
 *
 * That failure mode has cost real debugging time repeatedly, so every foreign id
 * is normalised here rather than at each call site. See CLAUDE.md rule 12.
 */
export function toIdString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  // A real ObjectId, or anything else exposing the standard accessor.
  const maybe = value as { toHexString?: () => string };
  if (typeof maybe.toHexString === 'function') return maybe.toHexString();

  // A serialized ObjectId: { buffer: { 0: 106, 1: 132, … } }, or a raw byte bag.
  const record = value as { buffer?: unknown };
  const bytes = record.buffer ?? value;
  if (typeof bytes === 'object' && bytes !== null) {
    const values = Object.values(bytes as Record<string, unknown>).filter(
      (b): b is number => typeof b === 'number',
    );
    if (values.length === 12) {
      return values.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  }

  const asString = String(value);
  // Better a visible empty than "[object Object]" silently matching nothing.
  return asString === '[object Object]' ? '' : asString;
}
