import type { Collection, Document, Filter, OptionalUnlessRequiredId, UpdateFilter } from 'mongodb';
import { collections } from '../db/collections';
import { GraspError } from '../errors';

/**
 * User-scoped data access.
 *
 * Everything a learner owns is read and written through a `UserScope`, which
 * injects the owner filter into every operation. The point is that forgetting to
 * scope a query becomes **impossible** rather than merely discouraged — the
 * unscoped `collections.*` accessors exist for system code (ingestion, the
 * concept graph, curricula), and anything learner-owned goes through here.
 *
 * This is the difference between "we remember to add userId" and "a query
 * without userId cannot be expressed". The first fails eventually; every product
 * that has leaked user data believed it was doing the first correctly.
 *
 * See docs/09-conventions.md — the cross-user isolation test is a security test
 * and blocking it is not negotiable.
 */

export class CrossUserAccessError extends GraspError {}

/**
 * A collection bound to one user. Every read filters by owner; every write
 * stamps the owner.
 */
export class ScopedCollection<T extends Document> {
  constructor(
    private readonly col: Collection<T>,
    private readonly userId: string,
    /** The field carrying ownership. `userId` everywhere except a few. */
    private readonly ownerField: string = 'userId',
  ) {}

  /**
   * Merge the owner constraint into a caller's filter.
   *
   * A caller passing a *different* owner is a bug — usually a copied query or a
   * parameter threaded from the wrong place. Throwing surfaces it; silently
   * overriding would hide it and let the mistake spread.
   */
  private scoped(filter: Filter<T> = {}): Filter<T> {
    const supplied = (filter as Record<string, unknown>)[this.ownerField];
    if (supplied !== undefined && String(supplied) !== this.userId) {
      throw new CrossUserAccessError(
        `Query filtered on ${this.ownerField}=${String(supplied)} inside a scope for ${this.userId}`,
        { ownerField: this.ownerField, supplied: String(supplied), scope: this.userId },
      );
    }
    return { ...filter, [this.ownerField]: this.userId } as Filter<T>;
  }

  find(filter: Filter<T> = {}) {
    return this.col.find(this.scoped(filter));
  }

  findOne(filter: Filter<T> = {}) {
    return this.col.findOne(this.scoped(filter));
  }

  countDocuments(filter: Filter<T> = {}) {
    return this.col.countDocuments(this.scoped(filter));
  }

  async insertOne(doc: Omit<T, 'userId'> & Partial<Record<string, unknown>>) {
    const supplied = (doc as Record<string, unknown>)[this.ownerField];
    if (supplied !== undefined && String(supplied) !== this.userId) {
      throw new CrossUserAccessError(
        `Insert carried ${this.ownerField}=${String(supplied)} inside a scope for ${this.userId}`,
        { ownerField: this.ownerField, supplied: String(supplied), scope: this.userId },
      );
    }
    return this.col.insertOne({
      ...(doc as object),
      [this.ownerField]: this.userId,
    } as OptionalUnlessRequiredId<T>);
  }

  async updateOne(filter: Filter<T>, update: UpdateFilter<T>, opts?: { upsert?: boolean }) {
    // An upsert must carry the owner, or a miss creates an unowned document.
    const patched = opts?.upsert
      ? ({ ...update, $setOnInsert: { ...(update.$setOnInsert ?? {}), [this.ownerField]: this.userId } } as UpdateFilter<T>)
      : update;
    return this.col.updateOne(this.scoped(filter), patched, opts ?? {});
  }

  async deleteOne(filter: Filter<T>) {
    return this.col.deleteOne(this.scoped(filter));
  }

  async deleteMany(filter: Filter<T> = {}) {
    return this.col.deleteMany(this.scoped(filter));
  }

  /**
   * Escape hatch, deliberately ugly to type and grep for.
   *
   * A few operations legitimately need the raw collection — aggregations with
   * a `$match` the caller writes itself, mostly. Named so a reviewer notices.
   */
  unsafeUnscoped(): Collection<T> {
    return this.col;
  }
}

/**
 * Everything a learner owns, bound to them.
 *
 * Collections absent here are system-owned and shared: `concepts`, `curricula`,
 * `curriculumMappings`, `questions`, and global `docChunks`. Those are read
 * through the plain `collections.*` accessors because they belong to nobody.
 */
export class UserScope {
  constructor(readonly userId: string) {
    if (!userId) throw new CrossUserAccessError('UserScope requires a userId');
  }

  chatSessions() {
    return new ScopedCollection(collections.chatSessions(), this.userId);
  }

  /**
   * `userId` is denormalized onto messages rather than joined through the
   * session. A join would mean every message read depends on a second query
   * being written correctly, which is exactly the kind of care that lapses.
   */
  messages() {
    return new ScopedCollection(collections.messages(), this.userId);
  }

  attachments() {
    return new ScopedCollection(collections.attachments(), this.userId);
  }

  attempts() {
    return new ScopedCollection(collections.attempts(), this.userId);
  }

  mastery() {
    return new ScopedCollection(collections.mastery(), this.userId);
  }

  episodes() {
    return new ScopedCollection(collections.episodes(), this.userId);
  }

  misconceptions() {
    return new ScopedCollection(collections.misconceptions(), this.userId);
  }

  slips() {
    return new ScopedCollection(collections.slips(), this.userId);
  }

  mindmaps() {
    return new ScopedCollection(collections.mindmaps(), this.userId);
  }

  events() {
    return new ScopedCollection(collections.events(), this.userId);
  }

  /**
   * A learner's own uploaded chunks. Global corpus chunks are read unscoped —
   * retrieval combines both, and that combination lives in one reviewed place
   * (the retrieval scope filter), not in every call site.
   */
  ownChunks() {
    return new ScopedCollection(collections.docChunks(), this.userId, 'ownerId');
  }

  /** The learner's own user document. */
  async me() {
    const { ObjectId } = await import('mongodb');
    return collections.users().findOne({ _id: new ObjectId(this.userId) } as never);
  }
}

export function forUser(userId: string): UserScope {
  return new UserScope(userId);
}
