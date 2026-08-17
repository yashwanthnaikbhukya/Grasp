import { ObjectId } from 'mongodb';
import { EventInputSchema, type EventInput, type StoredEvent } from '@grasp/schema';
import { collections } from '../db/collections';

/**
 * The only way into the learner plane.
 *
 * `events` is append-only: never updated, never deleted. Corrections are new
 * superseding events. See docs/adr/0003-event-sourced-learner-state.md.
 */

/**
 * Monotonic sequence, allocated via a counter document.
 *
 * `findOneAndUpdate` with `$inc` is atomic, so this is safe under concurrency
 * without a transaction. It is a single round trip per event — acceptable at
 * Grasp's write volume, and the ordering guarantee is what makes replay possible.
 */
async function nextSeq(): Promise<number> {
  const doc = await collections.counters().findOneAndUpdate(
    { _id: 'events.seq' },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return doc?.value ?? 1;
}

export interface EmitResult {
  seq: number;
  eventId: string;
  /** True when the idempotency key already existed — the write was a no-op. */
  duplicate: boolean;
}

export async function emit(input: EventInput): Promise<EmitResult> {
  const parsed = EventInputSchema.parse(input);
  const ts = parsed.ts ?? new Date();

  // Idempotency first: if the key exists, return the original without burning a
  // sequence number. Retries stay genuinely free.
  const existing = await collections
    .events()
    .findOne({ idempotencyKey: parsed.idempotencyKey }, { projection: { seq: 1 } });

  if (existing) {
    return {
      seq: existing.seq,
      eventId: String(existing._id),
      duplicate: true,
    };
  }

  const seq = await nextSeq();

  const doc = {
    seq,
    type: parsed.type,
    userId: new ObjectId(parsed.userId),
    payload: parsed.payload,
    idempotencyKey: parsed.idempotencyKey,
    ts,
  };

  try {
    const res = await collections.events().insertOne(doc);
    return { seq, eventId: String(res.insertedId), duplicate: false };
  } catch (e) {
    // Lost a race on the unique index — another writer inserted the same key
    // between our check and our insert. Treat as duplicate, which it is.
    if (isDuplicateKeyError(e)) {
      const winner = await collections
        .events()
        .findOne({ idempotencyKey: parsed.idempotencyKey }, { projection: { seq: 1 } });
      if (winner) {
        return { seq: winner.seq, eventId: String(winner._id), duplicate: true };
      }
    }
    throw e;
  }
}

export async function emitMany(inputs: EventInput[]): Promise<EmitResult[]> {
  const out: EmitResult[] = [];
  for (const input of inputs) out.push(await emit(input));
  return out;
}

/** Replay source for `pnpm learner:rebuild`. Ordered by `seq`, streamed. */
export function readEventsFrom(fromSeq: number, userId?: string) {
  const filter: Record<string, unknown> = { seq: { $gt: fromSeq } };
  if (userId) filter.userId = new ObjectId(userId);
  return collections.events().find(filter).sort({ seq: 1 });
}

export async function latestSeq(): Promise<number> {
  const doc = await collections.counters().findOne({ _id: 'events.seq' });
  return doc?.value ?? 0;
}

/**
 * Idempotency key convention. Never derive one from a random value — that
 * defeats the whole mechanism.
 */
export function idempotencyKey(
  type: string,
  userId: string,
  ...naturalKeyParts: (string | number)[]
): string {
  return [type, userId, ...naturalKeyParts.map(String)].join(':');
}

function isDuplicateKeyError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === 11000
  );
}

export type { EventInput, StoredEvent };
