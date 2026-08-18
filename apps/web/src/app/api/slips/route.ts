import { NextResponse } from 'next/server';
import { collections, loadGraph, ROOT_CAUSE_HINT, ROOT_CAUSE_LABEL, summarise } from '@grasp/core';
import type { RootCause } from '@grasp/schema';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The mistake notebook.
 *
 * Low-confidence labels are stored but withheld from the learner-facing view —
 * a guess presented as a diagnosis is worse than saying nothing, and it is the
 * fastest way to lose trust in the whole feature.
 */
const MIN_CONFIDENCE = 0.4;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const slips = await session.scope
    .slips()
    .find({})
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();

  const shown = slips.filter((s) => Number(s.confidence ?? 0) >= MIN_CONFIDENCE);
  const graph = await loadGraph();
  const nameOf = (id: string) => graph.find((c) => c._id === id)?.name ?? id;

  const summary = summarise(
    shown.map((s) => ({
      rootCause: s.rootCause as RootCause,
      conceptId: String(s.conceptId),
    })),
  );

  return NextResponse.json({
    total: slips.length,
    // Surfaced so the number is explainable rather than looking like data loss.
    lowConfidence: slips.length - shown.length,
    summary: summary.map((s) => ({
      rootCause: s.rootCause,
      label: ROOT_CAUSE_LABEL[s.rootCause],
      hint: ROOT_CAUSE_HINT[s.rootCause],
      count: s.count,
      share: s.share,
      concepts: s.concepts.map(nameOf),
    })),
    recent: shown.slice(0, 40).map((s) => ({
      id: String(s._id),
      rootCause: s.rootCause,
      label: ROOT_CAUSE_LABEL[s.rootCause as RootCause],
      note: String(s.note ?? ''),
      concept: nameOf(String(s.conceptId)),
      upstream: s.upstreamConceptId ? nameOf(String(s.upstreamConceptId)) : null,
      confidence: Number(s.confidence ?? 0),
      createdAt: s.createdAt,
    })),
  });
}
