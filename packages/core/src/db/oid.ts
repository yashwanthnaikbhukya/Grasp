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
