import { describe, expect, it } from 'vitest';
import { boostByConcept, fuseRRF, lexicalOverlap, rerank } from './fuse';

/**
 * Ranking bugs are silent — you get plausible chunks in the wrong order and a
 * tutor that cites the less relevant passage. Hence exhaustive tests on the pure
 * half. See docs/05-context-broker.md § 4.
 */

describe('fuseRRF', () => {
  it('ranks an item agreed on by both legs above one either leg alone loves', () => {
    // The whole point of hybrid retrieval: agreement beats a single strong vote.
    const bm25 = [{ id: 'only-lexical', score: 99 }, { id: 'both', score: 5 }];
    const vector = [{ id: 'only-semantic', score: 0.99 }, { id: 'both', score: 0.5 }];

    const fused = fuseRRF([bm25, vector]);
    expect(fused[0]?.id).toBe('both');
  });

  it('ignores the magnitude of incoming scores', () => {
    // BM25 scores and cosines live on different scales; RRF must read position
    // only, or one leg silently dominates whenever its scale happens to be bigger.
    const a = fuseRRF([[{ id: 'x', score: 1000 }, { id: 'y', score: 999 }]]);
    const b = fuseRRF([[{ id: 'x', score: 0.002 }, { id: 'y', score: 0.001 }]]);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });

  it('includes items present in only one list', () => {
    const fused = fuseRRF([[{ id: 'a', score: 1 }], [{ id: 'b', score: 1 }]]);
    expect(fused.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('is deterministic when scores tie', () => {
    // Non-deterministic ordering makes eval scores drift for reasons unrelated
    // to retrieval quality.
    const lists = [[{ id: 'b', score: 1 }, { id: 'a', score: 1 }]];
    expect(fuseRRF(lists).map((r) => r.id)).toEqual(fuseRRF(lists).map((r) => r.id));
  });

  it('handles empty input', () => {
    expect(fuseRRF([])).toEqual([]);
    expect(fuseRRF([[], []])).toEqual([]);
  });
});

describe('boostByConcept', () => {
  const tags: Record<string, string[]> = {
    onTopic: ['pythagorean-identity'],
    offTopic: ['quadratic-formula'],
    doubleMatch: ['pythagorean-identity', 'trig-ratios'],
  };
  const conceptOf = (id: string) => tags[id] ?? [];

  it('lifts a chunk tagged with a query concept', () => {
    const ranked = [{ id: 'offTopic', score: 1 }, { id: 'onTopic', score: 0.95 }];
    const out = boostByConcept(ranked, conceptOf, ['pythagorean-identity']);
    expect(out[0]?.id).toBe('onTopic');
  });

  it('is a nudge, not an override', () => {
    // Concept tags are model-generated and sometimes wrong, so a far-behind
    // chunk must not leapfrog on one tag match.
    const ranked = [{ id: 'offTopic', score: 10 }, { id: 'onTopic', score: 1 }];
    const out = boostByConcept(ranked, conceptOf, ['pythagorean-identity']);
    expect(out[0]?.id).toBe('offTopic');
  });

  it('caps the benefit of many matching tags', () => {
    const ranked = [{ id: 'doubleMatch', score: 1 }, { id: 'onTopic', score: 1 }];
    const out = boostByConcept(ranked, conceptOf, ['pythagorean-identity', 'trig-ratios']);
    // Two matches beat one, but by a bounded amount.
    expect(out[0]?.id).toBe('doubleMatch');
    expect(out[0]!.score / out[1]!.score).toBeLessThan(1.5);
  });

  it('is a no-op when the query has no concepts', () => {
    const ranked = [{ id: 'a', score: 2 }, { id: 'b', score: 1 }];
    expect(boostByConcept(ranked, conceptOf, [])).toEqual(ranked);
  });
});

describe('lexicalOverlap', () => {
  it('is 1 when every query term appears', () => {
    expect(lexicalOverlap('pythagorean identity', 'the pythagorean identity states')).toBe(1);
  });

  it('is 0 when nothing overlaps', () => {
    expect(lexicalOverlap('quadratic formula', 'sine and cosine ratios')).toBe(0);
  });

  it('ignores case and punctuation', () => {
    expect(lexicalOverlap('Pythagoras!', 'pythagoras')).toBe(1);
  });

  it('ignores very short words', () => {
    // "of", "is", "an" carry no retrieval signal and would inflate every score.
    expect(lexicalOverlap('is an of', 'completely unrelated text')).toBe(0);
  });

  it('handles an empty query without dividing by zero', () => {
    expect(lexicalOverlap('', 'anything')).toBe(0);
  });
});

describe('rerank', () => {
  const texts: Record<string, string> = {
    exact: 'The Pythagorean identity sin squared plus cos squared equals one.',
    adjacent: 'Trigonometric ratios are defined on the unit circle for any angle.',
    far: 'Quadratic equations are solved by completing the square.',
  };
  const textOf = (id: string) => texts[id] ?? '';

  it('demotes a topically-adjacent chunk that shares no query terms', () => {
    // The case a cross-encoder would catch: near in embedding space, but
    // answering a different question.
    const fused = [
      { id: 'adjacent', score: 0.9 },
      { id: 'exact', score: 0.85 },
      { id: 'far', score: 0.2 },
    ];
    const out = rerank(fused, 'pythagorean identity squared', textOf, 3);
    expect(out[0]?.id).toBe('exact');
  });

  it('respects topK', () => {
    const fused = [
      { id: 'exact', score: 1 },
      { id: 'adjacent', score: 0.9 },
      { id: 'far', score: 0.8 },
    ];
    expect(rerank(fused, 'anything', textOf, 2)).toHaveLength(2);
  });

  it('does not let lexical overlap alone decide the order', () => {
    // Lexical is a bad ranker on its own — it cannot see paraphrase. It gets a
    // 20% say, no more.
    const fused = [
      { id: 'exact', score: 1.0 },
      { id: 'far', score: 0.05 },
    ];
    const out = rerank(fused, 'quadratic completing square', textOf, 2);
    expect(out[0]?.id).toBe('exact');
  });

  it('handles a single candidate without dividing by zero', () => {
    expect(rerank([{ id: 'exact', score: 0 }], 'q', textOf, 5)).toHaveLength(1);
  });

  it('is deterministic', () => {
    const fused = [{ id: 'a', score: 1 }, { id: 'b', score: 1 }];
    const t = () => '';
    expect(rerank(fused, 'q', t, 2)).toEqual(rerank(fused, 'q', t, 2));
  });
});
