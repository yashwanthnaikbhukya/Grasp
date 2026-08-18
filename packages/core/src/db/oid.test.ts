import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { oid, toIdString } from './oid';

/**
 * Id normalisation. A mismatch here never throws — the query just matches
 * nothing — so it surfaces far from the cause. It has cost real debugging time
 * four separate times.
 */

describe('oid', () => {
  it('accepts a valid hex string', () => {
    expect(oid('6a84d0fb526f8e32f7c2c7f5')?.toHexString()).toBe('6a84d0fb526f8e32f7c2c7f5');
  });

  it('returns null for malformed input rather than throwing', () => {
    // Ids arrive from URLs and request bodies — a bad one is untrusted input to
    // reject with a 404, not an exception to surface as a 500.
    for (const v of ['', 'nope', '123', null, undefined]) expect(oid(v)).toBeNull();
  });
});

describe('toIdString', () => {
  it('passes a string through', () => {
    expect(toIdString('6a84d0fb526f8e32f7c2c7f5')).toBe('6a84d0fb526f8e32f7c2c7f5');
  });

  it('converts a real ObjectId', () => {
    const id = new ObjectId();
    expect(toIdString(id)).toBe(id.toHexString());
  });

  it('converts a serialized ObjectId carrying a byte buffer', () => {
    // The shape Better Auth's Mongo adapter hands back. `String()` on this gives
    // "[object Object]", which matched nothing and reported nothing.
    const id = new ObjectId();
    const serialized = { buffer: { ...Object.fromEntries([...id.id].map((b, i) => [i, b])) } };
    expect(toIdString(serialized)).toBe(id.toHexString());
  });

  it('converts a bare byte bag', () => {
    const id = new ObjectId();
    const bytes = Object.fromEntries([...id.id].map((b, i) => [i, b]));
    expect(toIdString(bytes)).toBe(id.toHexString());
  });

  it('returns empty rather than "[object Object]"', () => {
    // A visibly empty id fails loudly at the next check; "[object Object]"
    // silently matches nothing forever.
    expect(toIdString({ unrelated: true })).toBe('');
    expect(toIdString(null)).toBe('');
    expect(toIdString(undefined)).toBe('');
  });

  it('round-trips through oid', () => {
    const id = new ObjectId();
    expect(oid(toIdString(id))?.toHexString()).toBe(id.toHexString());
  });
});
