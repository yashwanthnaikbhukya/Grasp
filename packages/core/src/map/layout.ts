/**
 * Concept-graph layout.
 *
 * Pure, so the arrangement is testable and deterministic — a map that reshuffles
 * on every load is unreadable, because the reader's spatial memory of where a
 * concept sits is most of what makes a map useful.
 *
 * Layered by prerequisite depth: roots at the top, everything below what it
 * depends on. That is the one arrangement where the edges carry meaning — every
 * arrow points downward, so "what do I need first" is a direction rather than a
 * thing to trace.
 */

export interface MapNode {
  id: string;
  name: string;
  depth: number;
  prereqIds: string[];
  p: number;
  state: 'unseen' | 'learning' | 'review' | 'mastered';
  attempts: number;
  /** True when something the learner is trying depends on this and it is weak. */
  isBlocker: boolean;
}

export interface Positioned extends MapNode {
  x: number;
  y: number;
}

export interface MapEdge {
  from: string;
  to: string;
  /** The edge that explains a struggle — drawn heavier. */
  critical: boolean;
}

export interface Layout {
  nodes: Positioned[];
  edges: MapEdge[];
  width: number;
  height: number;
  layers: number;
}

const COL = 190;
const ROW = 116;
const PAD = 70;

/**
 * Order nodes within a layer to reduce crossings.
 *
 * One barycentre pass: place each node near the mean position of its
 * prerequisites in the layer above. Not optimal — minimising crossings exactly is
 * NP-hard — but it removes most of the obvious tangles for the cost of a sort,
 * and the result stays deterministic.
 */
function orderLayer(
  layer: MapNode[],
  previousOrder: Map<string, number>,
): MapNode[] {
  return [...layer].sort((a, b) => {
    const bary = (n: MapNode) => {
      const known = n.prereqIds.map((id) => previousOrder.get(id)).filter((v): v is number => v !== undefined);
      // A node with no placed prerequisite keeps its position rather than being
      // shoved to one end, which would fight the reader's spatial memory.
      return known.length === 0 ? Number.POSITIVE_INFINITY : known.reduce((s, v) => s + v, 0) / known.length;
    };
    const diff = bary(a) - bary(b);
    if (Number.isFinite(diff) && diff !== 0) return diff;
    // Deterministic tiebreak.
    return a.id.localeCompare(b.id);
  });
}

export function layoutGraph(nodes: readonly MapNode[]): Layout {
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0, layers: 0 };

  const present = new Set(nodes.map((n) => n.id));
  const byDepth = new Map<number, MapNode[]>();
  for (const n of nodes) {
    const list = byDepth.get(n.depth) ?? [];
    list.push(n);
    byDepth.set(n.depth, list);
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const positioned: Positioned[] = [];
  let order = new Map<string, number>();
  let widest = 0;

  for (const depth of depths) {
    const layer = orderLayer(byDepth.get(depth) ?? [], order);
    widest = Math.max(widest, layer.length);

    const nextOrder = new Map<string, number>();
    layer.forEach((node, i) => {
      nextOrder.set(node.id, i);
      // Grid coordinates for now; scaled to pixels once every layer width is known.
      positioned.push({ ...node, x: i, y: depths.indexOf(depth) });
    });
    order = nextOrder;
  }

  // Centre each layer against the widest one, so the graph reads as a shape
  // rather than as left-aligned rows.
  const perDepth = new Map<number, number>();
  for (const n of positioned) perDepth.set(n.y, (perDepth.get(n.y) ?? 0) + 1);

  for (const n of positioned) {
    const count = perDepth.get(n.y) ?? 1;
    const offset = (widest - count) / 2;
    n.x = PAD + (n.x + offset) * COL;
    n.y = PAD + n.y * ROW;
  }

  const edges: MapEdge[] = nodes.flatMap((n) =>
    n.prereqIds
      .filter((id) => present.has(id))
      .map((from) => ({
        from,
        to: n.id,
        // The edge worth looking at: a weak prerequisite under something being
        // attempted. This is the chain Slips talks about, drawn.
        critical:
          n.state !== 'unseen' &&
          (nodes.find((x) => x.id === from)?.p ?? 1) < 0.5,
      })),
  );

  return {
    nodes: positioned,
    edges,
    width: PAD * 2 + Math.max(widest - 1, 0) * COL + COL,
    height: PAD * 2 + Math.max(depths.length - 1, 0) * ROW + 60,
    layers: depths.length,
  };
}

/**
 * The weakest chain: walk from a struggling concept back through its
 * prerequisites, taking the weakest at each step.
 *
 * This is the single most useful thing the map can tell a learner — not "you are
 * bad at trigonometry" but "this is the one thing underneath it to fix first".
 */
export function weakestChain(nodes: readonly MapNode[], startId: string, maxDepth = 6): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(startId);

  while (current && !seen.has(current.id) && chain.length < maxDepth) {
    chain.push(current.id);
    seen.add(current.id);

    const weakest = current.prereqIds
      .map((id) => byId.get(id))
      .filter((n): n is MapNode => n !== undefined && !seen.has(n.id))
      .sort((a, b) => a.p - b.p)[0];

    // Stop climbing once the ground is solid — a chain that runs to the root
    // every time tells the learner nothing.
    if (!weakest || weakest.p >= 0.6) break;
    current = weakest;
  }

  return chain;
}

/** Mastery → colour stop, for the heat overlay. */
export function heatFor(node: MapNode): 'unseen' | 'weak' | 'partial' | 'strong' {
  if (node.state === 'unseen' || node.attempts === 0) return 'unseen';
  if (node.p < 0.4) return 'weak';
  if (node.p < 0.75) return 'partial';
  return 'strong';
}
