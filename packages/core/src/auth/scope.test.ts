import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CrossUserAccessError, ScopedCollection, UserScope } from './scope';

/**
 * Cross-user isolation. This is a **security** test — see
 * docs/09-conventions.md. Blocking it is not negotiable.
 *
 * These assert the *shape of the query that reaches Mongo*, not that Mongo
 * behaves: the failure being guarded against is a query leaving here without an
 * owner constraint, which no amount of database correctness would catch.
 */

const ALICE = '000000000000000000000a11';
const BOB = '000000000000000000000b0b';

function fakeCollection() {
  return {
    find: vi.fn(() => ({ toArray: async () => [] })),
    findOne: vi.fn(async () => null),
    countDocuments: vi.fn(async () => 0),
    insertOne: vi.fn(async () => ({ insertedId: 'x' })),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
  };
}

let col: ReturnType<typeof fakeCollection>;
let scoped: ScopedCollection<Record<string, unknown>>;

beforeEach(() => {
  col = fakeCollection();
  scoped = new ScopedCollection(col as never, ALICE);
});

describe('every read carries the owner constraint', () => {
  it('injects userId into an empty filter', () => {
    scoped.find();
    expect(col.find).toHaveBeenCalledWith({ userId: ALICE });
  });

  it('injects userId alongside the caller filter', () => {
    scoped.find({ archivedAt: null });
    expect(col.find).toHaveBeenCalledWith({ archivedAt: null, userId: ALICE });
  });

  it.each(['findOne', 'countDocuments'] as const)('injects on %s', async (method) => {
    await scoped[method]({ foo: 1 });
    expect(col[method]).toHaveBeenCalledWith({ foo: 1, userId: ALICE });
  });

  it.each(['deleteOne', 'deleteMany'] as const)('injects on %s', async (method) => {
    await scoped[method]({ foo: 1 });
    expect(col[method]).toHaveBeenCalledWith({ foo: 1, userId: ALICE });
  });

  it('injects on updateOne', async () => {
    await scoped.updateOne({ ref: 'z' }, { $set: { x: 1 } });
    expect(col.updateOne).toHaveBeenCalledWith(
      { ref: 'z', userId: ALICE },
      { $set: { x: 1 } },
      {},
    );
  });
});

describe('reaching for another user is an error, never a silent override', () => {
  // Silently rewriting the filter would hide the bug and let it spread. The
  // caller is confused about whose data they hold; that must surface.
  it('throws when a read filters on a different user', () => {
    expect(() => scoped.find({ userId: BOB })).toThrow(CrossUserAccessError);
    expect(col.find).not.toHaveBeenCalled();
  });

  it('throws when a write carries a different user', async () => {
    await expect(scoped.insertOne({ userId: BOB, text: 'hi' })).rejects.toThrow(
      CrossUserAccessError,
    );
    expect(col.insertOne).not.toHaveBeenCalled();
  });

  it('throws when a delete targets a different user', async () => {
    await expect(scoped.deleteMany({ userId: BOB })).rejects.toThrow(CrossUserAccessError);
    expect(col.deleteMany).not.toHaveBeenCalled();
  });

  it('allows a redundant but matching owner filter', () => {
    // Harmless and sometimes clearer at the call site.
    expect(() => scoped.find({ userId: ALICE })).not.toThrow();
  });
});

describe('writes are stamped with the owner', () => {
  it('stamps userId on insert', async () => {
    await scoped.insertOne({ text: 'hello' });
    expect(col.insertOne).toHaveBeenCalledWith({ text: 'hello', userId: ALICE });
  });

  it('stamps userId via $setOnInsert on upsert', async () => {
    // Without this an upsert that misses creates a document owned by nobody,
    // which then belongs to whoever queries unscoped next.
    await scoped.updateOne({ conceptId: 'x' }, { $set: { p: 0.5 } }, { upsert: true });
    expect(col.updateOne).toHaveBeenCalledWith(
      { conceptId: 'x', userId: ALICE },
      { $set: { p: 0.5 }, $setOnInsert: { userId: ALICE } },
      { upsert: true },
    );
  });

  it('preserves an existing $setOnInsert', async () => {
    await scoped.updateOne(
      { conceptId: 'x' },
      { $set: { p: 0.5 }, $setOnInsert: { createdAt: 'then' } },
      { upsert: true },
    );
    expect(col.updateOne).toHaveBeenCalledWith(
      { conceptId: 'x', userId: ALICE },
      { $set: { p: 0.5 }, $setOnInsert: { createdAt: 'then', userId: ALICE } },
      { upsert: true },
    );
  });
});

describe('owner field varies by collection', () => {
  it('scopes a learner\'s own chunks on ownerId', () => {
    // docChunks uses ownerId + ownerScope, not userId.
    const chunks = new ScopedCollection(col as never, ALICE, 'ownerId');
    chunks.find({ ownerScope: 'user' });
    expect(col.find).toHaveBeenCalledWith({ ownerScope: 'user', ownerId: ALICE });
  });

  it('still rejects another owner on the alternate field', () => {
    const chunks = new ScopedCollection(col as never, ALICE, 'ownerId');
    expect(() => chunks.find({ ownerId: BOB })).toThrow(CrossUserAccessError);
  });
});

describe('UserScope', () => {
  it('refuses to construct without a user', () => {
    expect(() => new UserScope('')).toThrow(CrossUserAccessError);
  });

  it('exposes only learner-owned collections', () => {
    const scope = new UserScope(ALICE);
    // Present: things a learner owns.
    for (const k of [
      'chatSessions',
      'messages',
      'attachments',
      'attempts',
      'mastery',
      'episodes',
      'misconceptions',
      'slips',
      'mindmaps',
      'events',
      'ownChunks',
    ] as const) {
      expect(typeof scope[k], k).toBe('function');
    }
    // Absent: system-owned and shared. Reaching for these through a user scope
    // would imply an ownership that doesn't exist.
    for (const k of ['concepts', 'curricula', 'questions'] as const) {
      expect((scope as unknown as Record<string, unknown>)[k], k).toBeUndefined();
    }
  });

  it('gives no way to edit the event log (rule 4)', () => {
    const events = new UserScope(ALICE).events() as unknown as Record<string, unknown>;
    expect(typeof events.find).toBe('function');
    expect(typeof events.countDocuments).toBe('function');
    for (const write of ['insertOne', 'updateOne', 'deleteOne', 'deleteMany', 'unsafeUnscoped']) {
      expect(events[write], write).toBeUndefined();
    }
  });

  it('keeps the escape hatch findable', () => {
    // Named to be greppable in review. If this is ever renamed to something
    // innocuous, that is the review signal being removed.
    expect(typeof scoped.unsafeUnscoped).toBe('function');
  });
});
