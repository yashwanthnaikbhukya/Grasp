import {
  currentP,
  heatFor,
  layoutGraph,
  loadGraph,
  masteryFromDoc,
  weakestChain,
  type MapEdge,
  type MapNode,
  type Positioned,
} from '@grasp/core';
import { conceptLabel } from '@/lib/labels';
import type { Session } from '@/lib/session';

/**
 * The concept graph with this learner's mastery on it — shared by the Map page
 * (first render, in the same response) and `GET /api/map` (refresh).
 */
export async function loadMap(session: Session) {
  // Independent reads in one round trip (the graph is usually cached).
  const [graph, masteryDocs] = await Promise.all([loadGraph(), session.scope.mastery().find({}).toArray()]);
  const subjects = session.profile.subjects;

  const scoped = subjects.length > 0
    ? graph.filter((c) => !c.subject || subjects.includes(c.subject))
    : graph;

  if (scoped.length === 0) {
    return {
      nodes: [] as (Positioned & { heat: ReturnType<typeof heatFor> })[],
      edges: [] as MapEdge[],
      width: 0,
      height: 0,
      layers: 0,
      focusChain: [] as string[],
      stats: { total: 0, touched: 0, mastered: 0, blockers: 0 },
      empty: true,
    };
  }

  const byConcept = new Map(masteryDocs.map((m) => [String(m.conceptId), m]));
  const now = new Date();

  // Depth is recomputed against the *scoped* set. Using the stored depth would
  // leave a floating layer whenever a prerequisite sits outside the subject.
  const present = new Set(scoped.map((c) => c._id));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    const hit = depthCache.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return 0;
    seen.add(id);
    const node = scoped.find((c) => c._id === id);
    const prereqs = (node?.prereqIds ?? []).filter((p) => present.has(p));
    const d = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map((p) => depthOf(p, seen)));
    depthCache.set(id, d);
    return d;
  };

  const nodes: MapNode[] = scoped.map((c) => {
    const m = byConcept.get(c._id);
    const p = m
      ? currentP(masteryFromDoc(m, now), now)
      : 0;

    return {
      id: c._id,
      name: conceptLabel(c.name),
      depth: depthOf(c._id),
      prereqIds: c.prereqIds.filter((p) => present.has(p)),
      p,
      state: (m?.state as MapNode['state']) ?? 'unseen',
      attempts: Number(m?.attempts ?? 0),
      isBlocker: false,
    };
  });

  // A blocker is a weak concept that something the learner is actively trying
  // depends on — the thing worth fixing first.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.state === 'unseen') continue;
    for (const prereqId of n.prereqIds) {
      const prereq = byId.get(prereqId);
      if (prereq && prereq.p < 0.5) prereq.isBlocker = true;
    }
  }

  const layout = layoutGraph(nodes);

  // The single most useful thing the map can say: not "you are weak at
  // trigonometry" but "this is the one thing underneath it to fix first".
  const struggling = nodes
    .filter((n) => n.state !== 'unseen' && n.p < 0.5)
    .sort((a, b) => a.p - b.p)[0];

  return {
    ...layout,
    empty: false,
    nodes: layout.nodes.map((n) => ({ ...n, heat: heatFor(n) })),
    focusChain: struggling ? weakestChain(nodes, struggling.id) : [],
    stats: {
      total: nodes.length,
      touched: nodes.filter((n) => n.attempts > 0).length,
      mastered: nodes.filter((n) => n.state === 'mastered').length,
      blockers: nodes.filter((n) => n.isBlocker).length,
    },
  };
}

/** What the Map page renders — derived from the loader, never hand-copied (rule 3). */
export type MapData = Awaited<ReturnType<typeof loadMap>>;
