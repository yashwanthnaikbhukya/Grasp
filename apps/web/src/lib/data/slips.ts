import { loadGraph, ROOT_CAUSE_HINT, ROOT_CAUSE_LABEL, summarise } from '@grasp/core';
import type { RootCause } from '@grasp/schema';
import { conceptLabel } from '@/lib/labels';
import type { Session } from '@/lib/session';

/**
 * The mistake notebook.
 *
 * Low-confidence labels are stored but withheld from the learner-facing view —
 * a guess presented as a diagnosis is worse than saying nothing, and it is the
 * fastest way to lose trust in the whole feature.
 */
const MIN_CONFIDENCE = 0.4;

/** Shared by the Slips page (first render) and `GET /api/slips`. */
export async function loadSlips(session: Session) {
  // Independent reads in one round trip (the graph is usually cached).
  const [slips, graph] = await Promise.all([
    session.scope.slips().find({}).sort({ createdAt: -1 }).limit(200).toArray(),
    loadGraph(),
  ]);

  const shown = slips.filter((s) => Number(s.confidence ?? 0) >= MIN_CONFIDENCE);
  const nameOf = (id: string) => conceptLabel(graph.find((c) => c._id === id)?.name ?? id);

  const summary = summarise(
    shown.map((s) => ({
      rootCause: s.rootCause as RootCause,
      conceptId: String(s.conceptId),
    })),
  );

  return {
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
  };
}

/** What the Slips page renders. */
export type SlipsData = Awaited<ReturnType<typeof loadSlips>>;
