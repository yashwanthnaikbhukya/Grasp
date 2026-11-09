import type { RetrievedChunk } from '../retrieval/retrieve';

/**
 * Which retrieved passages are actually about the question.
 *
 * Retrieval always returns its top k — rank fusion says which passages are
 * *least far*, never whether any is *near*. With one chapter of trigonometry in
 * the corpus, "what is photosynthesis" got six trig passages; the tutor cited
 * one for a biology fact and told the learner "we are looking at your
 * mathematics syllabus" (2026-11-09).
 *
 * The question-level signal decides how strict to be, because measured on the
 * corpus it separates cleanly where per-passage similarity does not:
 *
 *   - understood, tagged with ≥1 concept from the learner's graph → it is about
 *     something we teach; keep passages above a low floor (on-topic questions'
 *     best passage measured 0.42–0.85).
 *   - understood, tagged with none → off the graph; only a near-paraphrase
 *     passage survives (off-topic questions' best measured 0.41–0.56).
 *   - not understood (the step timed out) → a middle floor.
 *
 * Without similarities (embedder down, keyword-only) an off-graph question
 * keeps nothing and anything else keeps everything — the old behaviour.
 */
export const RELEVANCE_FLOOR = { onGraph: 0.38, offGraph: 0.62, unknown: 0.45 } as const;

export interface RelevanceInput {
  /** `query.understand` answered (rather than timing out). */
  understood: boolean;
  /** How many graph concepts it tagged the question with. */
  conceptCount: number;
}

export function relevanceFloor({ understood, conceptCount }: RelevanceInput): number {
  if (!understood) return RELEVANCE_FLOOR.unknown;
  return conceptCount > 0 ? RELEVANCE_FLOOR.onGraph : RELEVANCE_FLOOR.offGraph;
}

export function relevantChunks<C extends Pick<RetrievedChunk, 'similarity'>>(
  chunks: readonly C[],
  input: RelevanceInput,
): { kept: C[]; dropped: number; floor: number } {
  const floor = relevanceFloor(input);
  const offGraph = input.understood && input.conceptCount === 0;
  const kept = chunks.filter((c) => (c.similarity === undefined ? !offGraph : c.similarity >= floor));
  return { kept, dropped: chunks.length - kept.length, floor };
}
