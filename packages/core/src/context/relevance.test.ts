import { describe, expect, it } from 'vitest';
import { relevanceFloor, relevantChunks } from './relevance';

const c = (similarity?: number) => ({ similarity });

describe('relevance gate', () => {
  it('drops every trig passage for "what is photosynthesis" (the reported bug)', () => {
    // Measured: best trig passage 0.41; the question tagged with no concept.
    const r = relevantChunks([c(0.41), c(0.39), c(0.38)], { understood: true, conceptCount: 0 });
    expect(r.kept).toEqual([]);
    expect(r.dropped).toBe(3);
  });

  it('keeps on-topic passages, including the weakest measured one', () => {
    // "what does SOH CAH TOA mean": tagged, best passage 0.42.
    const r = relevantChunks([c(0.42), c(0.3)], { understood: true, conceptCount: 1 });
    expect(r.kept).toEqual([c(0.42)]);
  });

  it('lets a near-paraphrase through even off the graph', () => {
    expect(relevantChunks([c(0.7)], { understood: true, conceptCount: 0 }).kept).toHaveLength(1);
  });

  it('is in between when understanding timed out', () => {
    expect(relevanceFloor({ understood: false, conceptCount: 0 })).toBeGreaterThan(relevanceFloor({ understood: true, conceptCount: 2 }));
    expect(relevanceFloor({ understood: false, conceptCount: 0 })).toBeLessThan(relevanceFloor({ understood: true, conceptCount: 0 }));
  });

  it('without similarities: off-graph keeps nothing, anything else keeps all', () => {
    expect(relevantChunks([c(), c()], { understood: true, conceptCount: 0 }).kept).toHaveLength(0);
    expect(relevantChunks([c(), c()], { understood: true, conceptCount: 1 }).kept).toHaveLength(2);
    expect(relevantChunks([c(), c()], { understood: false, conceptCount: 0 }).kept).toHaveLength(2);
  });
});
