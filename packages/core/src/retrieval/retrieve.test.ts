import { describe, expect, it } from 'vitest';
import { scopeFilter, searchScopeFilter, topUpChunks, type RetrievedChunk } from './retrieve';

/**
 * The retrieval scope is a security boundary: a learner must never retrieve
 * another learner's uploads. It is expressed twice — MQL (vector pre-filter,
 * post-search $match, fallback scans) and Atlas Search operators ($search
 * compound.filter) — and these tests pin both shapes.
 */

const ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SESSION = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const profile = { curriculumIds: ['in-cbse-secondary-math'], subjects: ['mathematics'] };

type Doc = Record<string, unknown>;
const branches = (f: Doc): Doc[] => ((f.$or as Doc[] | undefined) ?? [f]);

describe('scopeFilter (MQL)', () => {
  it('without a user, only global content is in scope', () => {
    const f = scopeFilter({ query: 'x', profile });
    expect(f.ownerScope).toBe('global');
    expect(JSON.stringify(f)).not.toContain('"user"');
  });

  it("a user's branch is pinned to that user's own id", () => {
    const f = scopeFilter({ query: 'x', profile, userId: ALICE, sessionId: SESSION });
    const userBranch = branches(f).find((b) => b.ownerScope === 'user');
    const sessionBranch = branches(f).find((b) => b.ownerScope === 'session');
    expect(userBranch).toEqual({ ownerScope: 'user', ownerId: ALICE });
    expect(sessionBranch).toEqual({ ownerScope: 'session', ownerId: SESSION });
    // Every branch constrains the owner scope — none can match "anything".
    for (const b of branches(f)) expect(b.ownerScope).toBeDefined();
  });

  it('keeps curriculum-neutral content eligible, via the indexed flag not $size', () => {
    const f = scopeFilter({ query: 'x', profile });
    expect(JSON.stringify(f)).toContain('"curriculumNeutral":true');
    // $size cannot run inside $vectorSearch — which is where this filter runs.
    expect(JSON.stringify(f)).not.toContain('$size');
  });
});

describe('searchScopeFilter (Atlas Search operators)', () => {
  it('mirrors the MQL scope: global branch + the learner’s own branches only', () => {
    const f = searchScopeFilter({ query: 'x', profile, userId: ALICE, sessionId: SESSION }) as {
      compound: { should: { compound: { filter: Doc[] } }[]; minimumShouldMatch: number };
    };
    expect(f.compound.minimumShouldMatch).toBe(1);
    const owners = f.compound.should.map((b) =>
      b.compound.filter
        .map((c) => (c.equals as { path: string; value: unknown } | undefined))
        .filter((e) => e?.path === 'ownerId' || e?.path === 'ownerScope')
        .map((e) => `${e?.path}=${String(e?.value)}`)
        .join('&'),
    );
    expect(owners).toEqual([
      'ownerScope=global',
      `ownerScope=user&ownerId=${ALICE}`,
      `ownerScope=session&ownerId=${SESSION}`,
    ]);
  });

  it('carries the curriculum and subject constraints on the global branch', () => {
    const json = JSON.stringify(searchScopeFilter({ query: 'x', profile }));
    expect(json).toContain('"path":"curriculumIds","value":["in-cbse-secondary-math"]');
    expect(json).toContain('"path":"curriculumNeutral","value":true');
    expect(json).toContain('"path":"subject","value":["mathematics",""]');
  });
});

describe('topUpChunks — curriculum is a preference, not a gate', () => {
  const chunk = (id: string): RetrievedChunk => ({
    chunkId: id,
    text: id,
    headingPath: [],
    conceptIds: [],
    tokenCount: 1,
    score: 1,
  });

  it("keeps the learner's own curriculum first and marks the top-up", () => {
    const out = topUpChunks([chunk('a')], [chunk('a'), chunk('b'), chunk('c')], 3);
    expect(out.map((c) => c.chunkId)).toEqual(['a', 'b', 'c']);
    expect(out.map((c) => Boolean(c.outsideCurriculum))).toEqual([false, true, true]);
  });

  it('a learner whose curriculum has no material still gets the shared corpus', () => {
    // The 2026-11-09 finding: a GCSE learner retrieved 0 chunks.
    const out = topUpChunks([], [chunk('x'), chunk('y')], 5);
    expect(out.map((c) => c.chunkId)).toEqual(['x', 'y']);
    expect(out.every((c) => c.outsideCurriculum)).toBe(true);
  });

  it('never exceeds topK and never duplicates', () => {
    const out = topUpChunks([chunk('a'), chunk('b')], [chunk('b'), chunk('c'), chunk('d')], 3);
    expect(out.map((c) => c.chunkId)).toEqual(['a', 'b', 'c']);
  });
});
