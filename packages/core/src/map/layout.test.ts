import { describe, expect, it } from 'vitest';
import { heatFor, layoutGraph, weakestChain, type MapNode } from './layout';

/**
 * A map that reshuffles on every load is unreadable — the reader's spatial
 * memory of where a concept sits is most of what makes it useful. So determinism
 * is tested as a property, not assumed.
 */

function node(over: Partial<MapNode> & { id: string }): MapNode {
  return {
    name: over.id,
    depth: 0,
    prereqIds: [],
    p: 0,
    state: 'unseen',
    attempts: 0,
    isBlocker: false,
    ...over,
  };
}

const chain: MapNode[] = [
  node({ id: 'basics', depth: 0, p: 0.9, state: 'mastered', attempts: 8 }),
  node({ id: 'ratios', depth: 1, prereqIds: ['basics'], p: 0.3, state: 'learning', attempts: 5 }),
  node({ id: 'identity', depth: 2, prereqIds: ['ratios'], p: 0.2, state: 'learning', attempts: 3 }),
];

describe('layoutGraph', () => {
  it('places prerequisites above what depends on them', () => {
    // The one arrangement where edges carry meaning: every arrow points down.
    const { nodes } = layoutGraph(chain);
    const y = (id: string) => nodes.find((n) => n.id === id)!.y;
    expect(y('basics')).toBeLessThan(y('ratios'));
    expect(y('ratios')).toBeLessThan(y('identity'));
  });

  it('is deterministic', () => {
    const a = layoutGraph(chain).nodes.map((n) => `${n.id}:${n.x},${n.y}`);
    const b = layoutGraph(chain).nodes.map((n) => `${n.id}:${n.x},${n.y}`);
    expect(a).toEqual(b);
  });

  it('is stable under input reordering', () => {
    // The same graph handed over in a different order must draw the same.
    const forward = layoutGraph(chain).nodes.map((n) => `${n.id}:${n.x},${n.y}`).sort();
    const reversed = layoutGraph([...chain].reverse()).nodes.map((n) => `${n.id}:${n.x},${n.y}`).sort();
    expect(forward).toEqual(reversed);
  });

  it('centres narrower layers against the widest', () => {
    const wide: MapNode[] = [
      node({ id: 'only', depth: 0 }),
      node({ id: 'a', depth: 1, prereqIds: ['only'] }),
      node({ id: 'b', depth: 1, prereqIds: ['only'] }),
      node({ id: 'c', depth: 1, prereqIds: ['only'] }),
    ];
    const { nodes } = layoutGraph(wide);
    const root = nodes.find((n) => n.id === 'only')!;
    const xs = nodes.filter((n) => n.depth === 1).map((n) => n.x);
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(Math.abs(root.x - middle)).toBeLessThan(1);
  });

  it('emits an edge per real prerequisite and drops dangling ones', () => {
    const withDangling = [...chain, node({ id: 'orphan', depth: 1, prereqIds: ['not-loaded'] })];
    const { edges } = layoutGraph(withDangling);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.from !== 'not-loaded')).toBe(true);
  });

  it('marks a weak prerequisite under an attempted concept as critical', () => {
    // The chain Slips talks about, drawn.
    const { edges } = layoutGraph(chain);
    const weak = edges.find((e) => e.from === 'ratios' && e.to === 'identity');
    expect(weak?.critical).toBe(true);
    const solid = edges.find((e) => e.from === 'basics');
    expect(solid?.critical).toBe(false);
  });

  it('reports a canvas large enough to hold every node', () => {
    const { nodes, width, height } = layoutGraph(chain);
    for (const n of nodes) {
      expect(n.x).toBeLessThan(width);
      expect(n.y).toBeLessThan(height);
    }
  });

  it('handles an empty graph', () => {
    expect(layoutGraph([])).toEqual({ nodes: [], edges: [], width: 0, height: 0, layers: 0 });
  });
});

describe('weakestChain', () => {
  it('walks back through the weakest prerequisite', () => {
    expect(weakestChain(chain, 'identity')).toEqual(['identity', 'ratios']);
  });

  it('stops once the ground is solid', () => {
    // A chain that runs to the root every time tells the learner nothing.
    expect(weakestChain(chain, 'identity')).not.toContain('basics');
  });

  it('returns just the node when its prerequisites are all held', () => {
    expect(weakestChain(chain, 'ratios')).toEqual(['ratios']);
  });

  it('terminates on a cycle', () => {
    const cyclic = [
      node({ id: 'a', prereqIds: ['b'], p: 0.1 }),
      node({ id: 'b', prereqIds: ['a'], p: 0.1 }),
    ];
    expect(() => weakestChain(cyclic, 'a')).not.toThrow();
    expect(weakestChain(cyclic, 'a').length).toBeLessThanOrEqual(2);
  });

  it('respects the depth cap', () => {
    const deep = Array.from({ length: 20 }, (_, i) =>
      node({ id: `n${i}`, depth: i, prereqIds: i > 0 ? [`n${i - 1}`] : [], p: 0.1 }),
    );
    expect(weakestChain(deep, 'n19', 4)).toHaveLength(4);
  });

  it('returns empty for an unknown id', () => {
    expect(weakestChain(chain, 'nope')).toEqual([]);
  });
});

describe('heatFor', () => {
  it('separates untouched from weak', () => {
    // An unseen concept is not a failing one, and colouring them alike would
    // make a new learner's map look like a disaster.
    expect(heatFor(node({ id: 'x' }))).toBe('unseen');
    expect(heatFor(node({ id: 'x', state: 'learning', attempts: 3, p: 0.2 }))).toBe('weak');
  });

  it('grades partial and strong', () => {
    expect(heatFor(node({ id: 'x', state: 'review', attempts: 4, p: 0.6 }))).toBe('partial');
    expect(heatFor(node({ id: 'x', state: 'mastered', attempts: 9, p: 0.9 }))).toBe('strong');
  });
});
