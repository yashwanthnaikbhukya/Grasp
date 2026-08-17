/**
 * Rank fusion and reranking — the pure half of retrieval.
 *
 * Kept separate from the I/O so the ranking logic can be tested exhaustively
 * without a database. Ranking bugs are silent: you get plausible chunks in the
 * wrong order and a tutor that cites the less relevant passage.
 */

export interface Ranked {
  id: string;
  score: number;
}

/**
 * Reciprocal Rank Fusion.
 *
 * Combines ranked lists without needing their scores to be comparable — BM25
 * scores and cosine similarities live on entirely different scales, and
 * normalizing them against each other requires assumptions that break as soon as
 * a query is unusual. RRF only reads *positions*, which is why it is the right
 * fusion for a system whose two legs are this different.
 *
 * k=60 is the value from the original paper and is not sensitive; it damps the
 * advantage of rank 1 over rank 2 so a single leg cannot dominate.
 */
export function fuseRRF(lists: readonly (readonly Ranked[])[], k = 60): Ranked[] {
  const totals = new Map<string, number>();

  for (const list of lists) {
    list.forEach((item, index) => {
      totals.set(item.id, (totals.get(item.id) ?? 0) + 1 / (k + index + 1));
    });
  }

  return [...totals.entries()]
    .map(([id, score]) => ({ id, score }))
    // Ties broken by id so ordering is deterministic across runs — otherwise
    // eval scores drift for reasons unrelated to retrieval quality.
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Boost chunks tagged with a concept the query is about.
 *
 * Applied *before* fusion so it shifts position rather than score, which keeps
 * RRF's scale-independence intact. Deliberately gentle: concept tags are
 * model-generated and sometimes wrong, so this nudges rather than overrides.
 */
export function boostByConcept(
  ranked: readonly Ranked[],
  conceptOf: (id: string) => readonly string[],
  queryConcepts: readonly string[],
  boost = 0.15,
): Ranked[] {
  if (queryConcepts.length === 0) return [...ranked];
  const wanted = new Set(queryConcepts);

  return [...ranked]
    .map((r) => {
      const tags = conceptOf(r.id);
      const overlap = tags.filter((t) => wanted.has(t)).length;
      return { id: r.id, score: r.score * (1 + boost * Math.min(overlap, 2)) };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Lexical overlap between query and chunk, as a cheap reranking signal.
 *
 * Not a cross-encoder — that needs a model call per candidate and belongs in the
 * Python service (ADR 0002). This catches the common case a cross-encoder would:
 * a chunk that is topically near but shares none of the query's actual terms.
 */
export function lexicalOverlap(query: string, text: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const q = new Set(norm(query));
  if (q.size === 0) return 0;

  const t = new Set(norm(text));
  let hits = 0;
  for (const w of q) if (t.has(w)) hits++;
  return hits / q.size;
}

/**
 * Final ordering: fused rank, nudged by lexical agreement with the query.
 *
 * The blend is 0.8 fused / 0.2 lexical. Lexical alone is a bad ranker — it
 * cannot see paraphrase — but as a tiebreak it reliably demotes the
 * topically-adjacent chunk that answers a different question.
 */
export function rerank(
  fused: readonly Ranked[],
  query: string,
  textOf: (id: string) => string,
  topK: number,
): Ranked[] {
  const maxScore = Math.max(...fused.map((f) => f.score), 1e-9);

  return [...fused]
    .map((f) => ({
      id: f.id,
      score: 0.8 * (f.score / maxScore) + 0.2 * lexicalOverlap(query, textOf(f.id)),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, topK);
}
