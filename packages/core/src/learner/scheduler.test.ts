import { describe, expect, it } from 'vitest';
import {
  composeFeed,
  DEFAULT_FEED,
  diversify,
  placementNext,
  poolsFor,
  type CandidateCard,
  type ConceptState,
  type ScheduledCard,
} from './scheduler';

/**
 * The scheduler decides what a learner sees next, which makes it the most
 * user-visible pure function in the system — and the easiest to get subtly
 * wrong in a way that only shows up as "the app feels repetitive".
 */

const NOW = new Date('2026-08-17T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

function state(over: Partial<ConceptState> & { conceptId: string }): ConceptState {
  return {
    state: 'learning',
    p: 0.5,
    nextDueAt: ahead(5),
    prereqIds: [],
    ...over,
  };
}

function card(over: Partial<CandidateCard> & { questionId: string; conceptId: string }): CandidateCard {
  return { difficulty: 0, type: 'mcq', ...over };
}

describe('poolsFor', () => {
  it('puts overdue concepts in due, soonest first', () => {
    const pools = poolsFor(
      [
        state({ conceptId: 'a', nextDueAt: ago(1) }),
        state({ conceptId: 'b', nextDueAt: ago(10) }),
        state({ conceptId: 'c', nextDueAt: ahead(3) }),
      ],
      NOW,
    );
    expect(pools.due).toEqual(['b', 'a']);
  });

  it('never puts an unseen concept in due', () => {
    const pools = poolsFor([state({ conceptId: 'x', state: 'unseen', nextDueAt: ago(5) })], NOW);
    expect(pools.due).toEqual([]);
  });

  it('orders weak concepts worst-first', () => {
    const pools = poolsFor(
      [
        state({ conceptId: 'ok', p: 0.45 }),
        state({ conceptId: 'bad', p: 0.1 }),
        state({ conceptId: 'mid', p: 0.3 }),
      ],
      NOW,
    );
    expect(pools.weak).toEqual(['bad', 'mid', 'ok']);
  });

  it('gates the frontier on prerequisite mastery', () => {
    // The payoff for authoring prerequisite edges: never drill someone on
    // something they cannot possibly do yet.
    const pools = poolsFor(
      [
        state({ conceptId: 'basics', state: 'mastered', p: 0.9 }),
        state({ conceptId: 'shaky', state: 'learning', p: 0.2 }),
        state({ conceptId: 'ready', state: 'unseen', prereqIds: ['basics'] }),
        state({ conceptId: 'blocked', state: 'unseen', prereqIds: ['shaky'] }),
      ],
      NOW,
    );
    expect(pools.frontier).toContain('ready');
    expect(pools.frontier).not.toContain('blocked');
  });

  it('treats an unknown prerequisite as satisfied', () => {
    // A gap in the graph should not lock a learner out of a whole branch.
    const pools = poolsFor(
      [state({ conceptId: 'x', state: 'unseen', prereqIds: ['never-authored'] })],
      NOW,
    );
    expect(pools.frontier).toContain('x');
  });

  it('draws interleave only from mastered concepts', () => {
    const pools = poolsFor(
      [
        state({ conceptId: 'done', state: 'mastered', p: 0.9 }),
        state({ conceptId: 'wip', state: 'learning', p: 0.4 }),
      ],
      NOW,
    );
    expect(pools.interleave).toEqual(['done']);
  });
});

describe('composeFeed', () => {
  const manyStates: ConceptState[] = [
    state({ conceptId: 'due1', nextDueAt: ago(3) }),
    state({ conceptId: 'due2', nextDueAt: ago(1) }),
    state({ conceptId: 'weak1', p: 0.15 }),
    state({ conceptId: 'weak2', p: 0.25 }),
    state({ conceptId: 'new1', state: 'unseen' }),
    state({ conceptId: 'new2', state: 'unseen' }),
    state({ conceptId: 'old1', state: 'mastered', p: 0.9 }),
  ];

  const manyCards: CandidateCard[] = manyStates.flatMap((s) =>
    Array.from({ length: 5 }, (_, i) =>
      card({
        questionId: `${s.conceptId}-q${i}`,
        conceptId: s.conceptId,
        difficulty: i - 2,
        type: (['mcq', 'numeric', 'multi', 'orderSteps', 'tapError'] as const)[i] ?? 'mcq',
      }),
    ),
  );

  it('returns the requested number of cards', () => {
    const feed = composeFeed(manyCards, manyStates, NOW, { ...DEFAULT_FEED, count: 12 });
    expect(feed).toHaveLength(12);
  });

  it('never repeats a question', () => {
    const feed = composeFeed(manyCards, manyStates, NOW);
    expect(new Set(feed.map((c) => c.questionId)).size).toBe(feed.length);
  });

  it('respects the per-concept cap', () => {
    // Three cards on one concept in a sitting reads as being stuck.
    const feed = composeFeed(manyCards, manyStates, NOW, { ...DEFAULT_FEED, maxPerConcept: 2 });
    const counts = new Map<string, number>();
    for (const c of feed) counts.set(c.conceptId, (counts.get(c.conceptId) ?? 0) + 1);
    for (const [concept, n] of counts) expect(n, concept).toBeLessThanOrEqual(2);
  });

  it('draws from more than one pool', () => {
    const feed = composeFeed(manyCards, manyStates, NOW);
    expect(new Set(feed.map((c) => c.pool)).size).toBeGreaterThan(1);
  });

  it('leads with due review when there is a backlog', () => {
    const feed = composeFeed(manyCards, manyStates, NOW);
    expect(feed.filter((c) => c.pool === 'due').length).toBeGreaterThan(0);
  });

  it('fills from other pools when one is empty rather than returning a short session', () => {
    // Nothing due and nothing mastered — the session should still be full.
    const onlyNew = [state({ conceptId: 'n1', state: 'unseen' }), state({ conceptId: 'n2', state: 'unseen' })];
    const cards = onlyNew.flatMap((s) =>
      Array.from({ length: 10 }, (_, i) => card({ questionId: `${s.conceptId}-${i}`, conceptId: s.conceptId })),
    );
    const feed = composeFeed(cards, onlyNew, NOW, { ...DEFAULT_FEED, count: 6, maxPerConcept: 5 });
    expect(feed.length).toBe(6);
  });

  it('prefers items near the learner’s level', () => {
    // Target ~80% success: too easy is boring, too hard and they quit.
    const one = [state({ conceptId: 'c', p: 0.5, nextDueAt: ago(1) })];
    const spread = [-3, -1, 0, 1, 3].map((d) =>
      card({ questionId: `q${d}`, conceptId: 'c', difficulty: d }),
    );
    const feed = composeFeed(spread, one, NOW, { ...DEFAULT_FEED, count: 1, maxPerConcept: 1 });
    expect(Math.abs(feed[0]!.difficulty)).toBeLessThanOrEqual(1);
  });

  it('returns nothing when there are no candidates', () => {
    expect(composeFeed([], manyStates, NOW)).toEqual([]);
  });

  it('is deterministic', () => {
    // A feed that reshuffles on every load makes retention impossible to read.
    const a = composeFeed(manyCards, manyStates, NOW);
    const b = composeFeed(manyCards, manyStates, NOW);
    expect(a.map((c) => c.questionId)).toEqual(b.map((c) => c.questionId));
  });
});

describe('diversify', () => {
  const mk = (id: string, conceptId: string, type: CandidateCard['type']): ScheduledCard => ({
    questionId: id,
    conceptId,
    difficulty: 0,
    type,
    pool: 'due',
  });

  it('avoids consecutive cards on the same concept', () => {
    const out = diversify([
      mk('1', 'a', 'mcq'),
      mk('2', 'a', 'mcq'),
      mk('3', 'b', 'numeric'),
      mk('4', 'b', 'numeric'),
    ]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.conceptId, `position ${i}`).not.toBe(out[i - 1]!.conceptId);
    }
  });

  it('avoids three of the same card type in a row', () => {
    // What makes a feed feel like a quiz instead of a feed.
    const out = diversify([
      mk('1', 'a', 'mcq'),
      mk('2', 'b', 'mcq'),
      mk('3', 'c', 'mcq'),
      mk('4', 'd', 'numeric'),
      mk('5', 'e', 'multi'),
      mk('6', 'f', 'orderSteps'),
    ]);
    for (let i = 2; i < out.length; i++) {
      const three = out[i]!.type === out[i - 1]!.type && out[i - 1]!.type === out[i - 2]!.type;
      expect(three, `positions ${i - 2}-${i}`).toBe(false);
    }
  });

  it('keeps every card', () => {
    const input = [mk('1', 'a', 'mcq'), mk('2', 'a', 'mcq'), mk('3', 'a', 'mcq')];
    expect(diversify(input).map((c) => c.questionId).sort()).toEqual(['1', '2', '3']);
  });

  it('degrades gracefully when everything is identical', () => {
    const same = [mk('1', 'a', 'mcq'), mk('2', 'a', 'mcq')];
    expect(diversify(same)).toHaveLength(2);
  });
});

describe('placementNext', () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({
    questionId: `q${i}`,
    conceptId: `c${i}`,
    difficulty: 0,
    type: 'mcq' as const,
    depth: i,
  }));

  it('starts near the middle of the ladder', () => {
    const first = placementNext(pool, [], 11);
    expect(first!.depth).toBeGreaterThan(3);
    expect(first!.depth).toBeLessThan(8);
  });

  it('goes deeper after a correct answer', () => {
    const next = placementNext(pool, [{ depth: 5, correct: true }], 11);
    expect(next!.depth).toBeGreaterThanOrEqual(5);
  });

  it('goes shallower after a wrong answer', () => {
    const next = placementNext(pool, [{ depth: 8, correct: false }], 11);
    expect(next!.depth).toBeLessThan(8);
  });

  it('converges as answers accumulate', () => {
    const next = placementNext(
      pool,
      [
        { depth: 6, correct: true },
        { depth: 9, correct: false },
        { depth: 7, correct: true },
      ],
      11,
    );
    expect(next!.depth).toBeGreaterThanOrEqual(7);
    expect(next!.depth).toBeLessThanOrEqual(8);
  });

  it('returns null when the pool is exhausted', () => {
    expect(placementNext([], [], 11)).toBeNull();
  });
});
