import { ObjectId } from 'mongodb';
import type { StageRange } from '@grasp/schema';
import { collections } from '../db/collections';
import { embed } from '../llm/gateway';
import { resolveExisting, resolveOrCreate, invalidateGraphCache } from '../concepts/resolve';
import { chunkForEmbedding, chunkMarkdown, type Chunk } from './chunk';

/**
 * The ingestion pipeline: text → chunks → embeddings → concept tags → persisted.
 *
 * Concept tagging is what makes the corpus interoperate with everything else —
 * an untagged chunk is retrievable but cannot feed the feed, the Map, or gap
 * detection. See docs/02-architecture.md.
 *
 * Growth of the concept graph is bounded per run and degrades to "tag against
 * what exists" when providers rate-limit, so an ingest never fails wholesale
 * because one passage hit a 429. See ADR 0007.
 */

export interface IngestArgs {
  markdown: string;
  title: string;
  subject: string;
  /** Empty ⇒ curriculum-neutral, eligible for every learner. */
  curriculumIds?: string[];
  stageRange?: StageRange | null;
  language?: string;
  kind?: 'textbook' | 'notes' | 'upload' | 'transcript' | 'openstax' | 'web';
  licence?: string;
  attribution?: string;
  /** Learner-owned uploads. Omit for the shared corpus. */
  owner?: { scope: 'user' | 'session'; id: string; ttlDays?: number };
  /** Cap on new concept nodes this run may create. */
  maxNewConcepts?: number;
  onProgress?: (msg: string) => void;
}

export interface IngestResult {
  sourceId: string;
  chunksWritten: number;
  conceptsCreated: string[];
  conceptsTagged: number;
  /** Chunks that came out with no concept tag — retrievable but not interoperable. */
  untagged: number;
  deferred: number;
  latencyMs: number;
}

export async function ingestMarkdown(args: IngestArgs): Promise<IngestResult> {
  const started = Date.now();
  const say = args.onProgress ?? (() => {});

  const ownerScope = args.owner?.scope ?? 'global';
  const ownerId = args.owner?.id ?? null;
  const language = args.language ?? 'en';

  const chunks = chunkMarkdown(args.markdown);
  say(`${chunks.length} chunks`);
  if (chunks.length === 0) {
    return {
      sourceId: '',
      chunksWritten: 0,
      conceptsCreated: [],
      conceptsTagged: 0,
      untagged: 0,
      deferred: 0,
      latencyMs: Date.now() - started,
    };
  }

  const sourceId = new ObjectId();
  await collections.sources().insertOne({
    _id: sourceId,
    kind: args.kind ?? 'textbook',
    title: args.title,
    licence: args.licence ?? 'unknown',
    attribution: args.attribution ?? '',
    curriculumIds: args.curriculumIds ?? [],
    language,
    ownerScope,
    ownerId,
    ingestedAt: new Date(),
  } as never);

  // --- embed --------------------------------------------------------------
  // Batched: one Ollama round trip per batch rather than per chunk. Local, so
  // there is no quota to respect — only memory.
  say('embedding…');
  const BATCH = 32;
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const res = await embed({
      texts: slice.map((c) => chunkForEmbedding(c)),
      purpose: 'chunk',
    });
    vectors.push(...res.vectors);
    say(`embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }

  // --- concept tagging ----------------------------------------------------
  say('tagging concepts…');
  const conceptsCreated: string[] = [];
  const tagsPerChunk: string[][] = [];
  let deferred = 0;
  let newBudget = args.maxNewConcepts ?? 12;

  for (const [i, chunk] of chunks.entries()) {
    const vector = vectors[i];

    // Cheap path first: does the graph already cover this? No model call.
    const heading = chunk.headingPath[chunk.headingPath.length - 1] ?? '';
    const existing = heading
      ? await resolveExisting(heading, vector, args.subject)
      : ({ kind: 'none' } as const);

    if (existing.kind === 'alias' || existing.kind === 'embedding') {
      tagsPerChunk.push([existing.conceptId]);
      continue;
    }

    // Only spend a proposal call while there is budget left. Past that, the
    // chunk is still indexed and still retrievable — it simply carries no tag
    // until a later run picks it up.
    if (newBudget <= 0) {
      tagsPerChunk.push([]);
      continue;
    }

    const grown = await resolveOrCreate({
      text: chunkForEmbedding(chunk),
      subject: args.subject,
      source: `${args.title} · ${chunk.headingPath.join(' › ')}`,
      maxNewConcepts: Math.min(3, newBudget),
    });

    if (grown.deferred) {
      deferred++;
      tagsPerChunk.push([]);
      continue;
    }

    conceptsCreated.push(...grown.createdIds);
    newBudget -= grown.createdIds.length;
    tagsPerChunk.push(grown.conceptIds);
    if (grown.createdIds.length > 0) say(`+concepts: ${grown.createdIds.join(', ')}`);
  }

  // --- persist ------------------------------------------------------------
  const expiresAt =
    ownerScope === 'session' && args.owner?.ttlDays
      ? new Date(Date.now() + args.owner.ttlDays * 86_400_000)
      : null;

  const docs = chunks.map((chunk: Chunk, i) => ({
    ownerScope,
    ownerId,
    sourceId,
    text: chunk.text,
    embedding: vectors[i] ?? [],
    conceptIds: tagsPerChunk[i] ?? [],
    curriculumIds: args.curriculumIds ?? [],
    subject: args.subject,
    stageRange: args.stageRange ?? null,
    language,
    headingPath: chunk.headingPath,
    tokenCount: chunk.tokenCount,
    expiresAt,
    createdAt: new Date(),
  }));

  await collections.docChunks().insertMany(docs as never[], { ordered: false });
  invalidateGraphCache();

  const untagged = tagsPerChunk.filter((t) => t.length === 0).length;

  return {
    sourceId: String(sourceId),
    chunksWritten: docs.length,
    conceptsCreated: [...new Set(conceptsCreated)],
    conceptsTagged: tagsPerChunk.length - untagged,
    untagged,
    deferred,
    latencyMs: Date.now() - started,
  };
}
