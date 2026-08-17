import type { Document } from 'mongodb';
import type { LearnerProfile } from '@grasp/schema';
import { collections, SEARCH_INDEXES } from '../db/collections';
import { cosine } from '../concepts/resolve';
import { embed } from '../llm/gateway';
import { boostByConcept, fuseRRF, rerank, type Ranked } from './fuse';

/**
 * Hybrid retrieval: BM25 ∥ vector → RRF → concept boost → rerank → top-k.
 *
 * Both legs are mandatory. Vector-only fails on exactly what students ask most —
 * formula names, theorem names, specific numbers, section references. BM25-only
 * fails on paraphrase. See docs/05-context-broker.md § 4.
 *
 * ## Degradation
 *
 * Atlas Search and Vector Search are separate resources that must be created by
 * hand in the Atlas UI, and a POC should not be dead in the water until someone
 * does that. Each leg detects a missing index and falls back:
 *
 *   BM25   → a regex scan over the scoped chunk set
 *   vector → exact cosine in memory over the scoped chunk set
 *
 * Both are O(corpus) and fine at POC scale; both are wrong at real scale. The
 * result reports which path ran, so a fallback that silently became permanent is
 * visible rather than mysterious.
 */

export interface RetrievedChunk {
  chunkId: string;
  text: string;
  headingPath: string[];
  conceptIds: string[];
  tokenCount: number;
  score: number;
  sourceId?: string;
  page?: number;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  /** Which path each leg took. `fallback` here means the Atlas index is absent. */
  legs: { lexical: 'atlas' | 'fallback' | 'skipped'; vector: 'atlas' | 'fallback' | 'skipped' };
  candidateCount: number;
  latencyMs: number;
}

export interface RetrieveArgs {
  query: string;
  /** Concepts the query touches, from `query.understand`. Used to boost, not filter. */
  conceptIds?: string[];
  /** Drives the curriculum + subject scope filter. */
  profile?: Pick<LearnerProfile, 'curriculumIds' | 'subjects'>;
  /** Include this learner's own uploads alongside the global corpus. */
  userId?: string;
  sessionId?: string;
  topK?: number;
  /** Candidates pulled per leg before fusion. */
  perLeg?: number;
}

/**
 * The scope filter. A security boundary for the `user`/`session` legs and a
 * relevance filter for the rest, expressed once so no call site can get it wrong.
 *
 * Curriculum-neutral content (`curriculumIds: []`) stays eligible for everyone —
 * most good explanations are.
 */
export function scopeFilter(args: RetrieveArgs): Document {
  const global: Document = { ownerScope: 'global' };

  const curricula = args.profile?.curriculumIds ?? [];
  if (curricula.length > 0) {
    global.$or = [{ curriculumIds: { $in: curricula } }, { curriculumIds: { $size: 0 } }];
  }
  const subjects = args.profile?.subjects ?? [];
  if (subjects.length > 0) {
    global.$and = [{ $or: [{ subject: { $in: subjects } }, { subject: '' }] }];
  }

  const branches: Document[] = [global];
  if (args.userId) branches.push({ ownerScope: 'user', ownerId: args.userId });
  if (args.sessionId) branches.push({ ownerScope: 'session', ownerId: args.sessionId });

  return branches.length === 1 ? global : { $or: branches };
}

function isMissingIndex(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /index not found|no such index|Unrecognized pipeline stage|\$search|\$vectorSearch/i.test(
    msg,
  );
}

/**
 * Which Atlas Search indexes actually exist and are queryable.
 *
 * **This check is not optional.** A `$search` or `$vectorSearch` against a
 * missing index does **not** throw — Atlas returns an empty result set. Gating
 * the fallback on a caught exception therefore never fires, and retrieval
 * silently returns nothing forever while every leg reports success. That failure
 * cost a debugging session; hence the explicit probe.
 *
 * Cached, because it is a round trip and the answer changes about once a
 * quarter — when someone finally creates the index.
 */
let indexCache: { at: number; names: Set<string> } | null = null;
const INDEX_CACHE_MS = 30_000;

export async function availableSearchIndexes(force = false): Promise<Set<string>> {
  if (!force && indexCache && Date.now() - indexCache.at < INDEX_CACHE_MS) {
    return indexCache.names;
  }

  const names = new Set<string>();
  try {
    const rows = await collections.docChunks().listSearchIndexes().toArray();
    for (const r of rows) {
      const status = String((r as { status?: unknown }).status ?? '');
      // A building index answers queries with partial or no results, which is
      // the same trap as a missing one.
      if (!status || status === 'READY') names.add(String((r as { name?: unknown }).name ?? ''));
    }
  } catch {
    // Self-hosted Mongo has no search indexes at all; the fallback is correct.
  }

  indexCache = { at: Date.now(), names };
  return names;
}

interface ChunkRow extends Document {
  _id: unknown;
  text: string;
  headingPath?: string[];
  conceptIds?: string[];
  tokenCount?: number;
  embedding?: number[];
  sourceId?: unknown;
  page?: number;
}

async function lexicalLeg(
  args: RetrieveArgs,
  filter: Document,
  limit: number,
): Promise<{ ranked: Ranked[]; mode: 'atlas' | 'fallback' }> {
  const indexes = await availableSearchIndexes();
  const useAtlas = indexes.has(SEARCH_INDEXES.chunksText);

  try {
    if (!useAtlas) throw new Error('index not found (probe)');
    const rows = await collections
      .docChunks()
      .aggregate([
        {
          $search: {
            index: SEARCH_INDEXES.chunksText,
            compound: {
              must: [{ text: { query: args.query, path: ['text', 'headingPath'] } }],
            },
          },
        },
        { $match: filter },
        { $limit: limit },
        { $project: { _id: 1, score: { $meta: 'searchScore' } } },
      ])
      .toArray();

    return {
      ranked: rows.map((r) => ({ id: String(r._id), score: Number(r.score ?? 0) })),
      mode: 'atlas',
    };
  } catch (e) {
    if (!isMissingIndex(e)) throw e;

    // Fallback: term-overlap scan. Crude, but it keeps the tutor working while
    // the Atlas index is missing, and it degrades on ordering rather than recall.
    const terms = args.query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 12);

    if (terms.length === 0) return { ranked: [], mode: 'fallback' };

    const rows = (await collections
      .docChunks()
      .find(filter, { projection: { _id: 1, text: 1, headingPath: 1 } })
      .limit(2000)
      .toArray()) as ChunkRow[];

    const ranked = rows
      .map((r) => {
        const hay = `${(r.headingPath ?? []).join(' ')} ${r.text}`.toLowerCase();
        let hits = 0;
        for (const t of terms) if (hay.includes(t)) hits++;
        return { id: String(r._id), score: hits / terms.length };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { ranked, mode: 'fallback' };
  }
}

async function vectorLeg(
  args: RetrieveArgs,
  filter: Document,
  limit: number,
): Promise<{ ranked: Ranked[]; mode: 'atlas' | 'fallback' }> {
  const [queryVector] = (await embed({ texts: [args.query], purpose: 'query' })).vectors;
  if (!queryVector) return { ranked: [], mode: 'fallback' };

  const indexes = await availableSearchIndexes();
  const useAtlas = indexes.has(SEARCH_INDEXES.chunksVector);

  try {
    if (!useAtlas) throw new Error('index not found (probe)');
    const rows = await collections
      .docChunks()
      .aggregate([
        {
          $vectorSearch: {
            index: SEARCH_INDEXES.chunksVector,
            path: 'embedding',
            queryVector,
            numCandidates: limit * 10,
            limit,
          },
        },
        { $match: filter },
        { $project: { _id: 1, score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray();

    return {
      ranked: rows.map((r) => ({ id: String(r._id), score: Number(r.score ?? 0) })),
      mode: 'atlas',
    };
  } catch (e) {
    if (!isMissingIndex(e)) throw e;

    // Fallback: exact cosine in memory. More accurate than approximate nearest
    // neighbour, just O(corpus) — acceptable while the corpus is small.
    const rows = (await collections
      .docChunks()
      .find(filter, { projection: { _id: 1, embedding: 1 } })
      .limit(5000)
      .toArray()) as ChunkRow[];

    const ranked = rows
      .filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0)
      .map((r) => ({ id: String(r._id), score: cosine(queryVector, r.embedding ?? []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { ranked, mode: 'fallback' };
  }
}

export async function retrieve(args: RetrieveArgs): Promise<RetrieveResult> {
  const started = Date.now();
  const topK = args.topK ?? 5;
  const perLeg = args.perLeg ?? 20;
  const filter = scopeFilter(args);

  const [lexical, vector] = await Promise.all([
    lexicalLeg(args, filter, perLeg),
    vectorLeg(args, filter, perLeg),
  ]);

  const fused = fuseRRF([lexical.ranked, vector.ranked]);
  if (fused.length === 0) {
    return {
      chunks: [],
      legs: { lexical: lexical.mode, vector: vector.mode },
      candidateCount: 0,
      latencyMs: Date.now() - started,
    };
  }

  // Hydrate once, then rank on the loaded rows — the boost and rerank both need
  // chunk bodies, and a second round trip per candidate would dominate latency.
  const { ObjectId } = await import('mongodb');
  const ids = fused.slice(0, perLeg * 2).map((f) => f.id);
  const rows = (await collections
    .docChunks()
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } } as Document)
    .toArray()) as ChunkRow[];

  const byId = new Map(rows.map((r) => [String(r._id), r]));

  const boosted = boostByConcept(
    fused,
    (id) => byId.get(id)?.conceptIds ?? [],
    args.conceptIds ?? [],
  );
  const final = rerank(boosted, args.query, (id) => byId.get(id)?.text ?? '', topK);

  return {
    chunks: final.flatMap((f) => {
      const row = byId.get(f.id);
      if (!row) return [];
      return [
        {
          chunkId: f.id,
          text: row.text,
          headingPath: row.headingPath ?? [],
          conceptIds: row.conceptIds ?? [],
          tokenCount: row.tokenCount ?? 0,
          score: f.score,
          sourceId: row.sourceId ? String(row.sourceId) : undefined,
          page: row.page,
        },
      ];
    }),
    legs: { lexical: lexical.mode, vector: vector.mode },
    candidateCount: fused.length,
    latencyMs: Date.now() - started,
  };
}
