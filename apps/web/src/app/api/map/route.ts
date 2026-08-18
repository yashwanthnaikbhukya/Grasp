import { NextResponse } from 'next/server';
import { currentP, heatFor, layoutGraph, loadGraph, weakestChain, type MapNode } from '@grasp/core';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The concept graph, rendered with this learner's mastery on it.
 *
 * This is where the invisible personalization becomes legible: the same graph
 * every learner shares, coloured by what *this* one actually holds.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const graph = await loadGraph();
  const subjects = session.profile.subjects;

  const scoped = subjects.length > 0
    ? graph.filter((c) => !c.subject || subjects.includes(c.subject))
    : graph;

  if (scoped.length === 0) {
    return NextResponse.json({ nodes: [], edges: [], width: 0, height: 0, empty: true });
  }

  const masteryDocs = await session.scope.mastery().find({}).toArray();
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
      ? currentP(
          {
            p: Number(m.p ?? 0),
            attempts: Number(m.attempts ?? 0),
            correct: Number(m.correct ?? 0),
            elo: Number(m.elo ?? 1200),
            stability: Number(m.stability ?? 1),
            difficulty: Number(m.difficulty ?? 0),
            lastSeenAt: (m.lastSeenAt as Date | null) ?? null,
            nextDueAt: (m.nextDueAt as Date) ?? now,
            state: 'learning',
          },
          now,
        )
      : 0;

    return {
      id: c._id,
      name: c.name,
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

  return NextResponse.json({
    ...layout,
    nodes: layout.nodes.map((n) => ({ ...n, heat: heatFor(n) })),
    focusChain: struggling ? weakestChain(nodes, struggling.id) : [],
    stats: {
      total: nodes.length,
      touched: nodes.filter((n) => n.attempts > 0).length,
      mastered: nodes.filter((n) => n.state === 'mastered').length,
      blockers: nodes.filter((n) => n.isBlocker).length,
    },
  });
}
