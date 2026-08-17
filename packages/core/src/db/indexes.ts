import type { IndexDescription } from 'mongodb';
import { env } from '../env';
import { COLLECTIONS, type CollectionName, SEARCH_INDEXES } from './collections';
import { db } from './client';

/**
 * Every regular index, in one place. Idempotent — `createIndexes` is a no-op for
 * definitions that already exist, so `pnpm db:indexes` is safe to re-run.
 *
 * Atlas Search and Atlas Vector Search are *separate resources* the driver
 * cannot create. `searchIndexDefinitions()` prints the JSON to paste into the
 * Atlas UI. See docs/08-setup.md#5.
 */

export const REGULAR_INDEXES: Partial<Record<CollectionName, IndexDescription[]>> = {
  [COLLECTIONS.users]: [{ key: { email: 1 }, unique: true, name: 'email_unique' }],

  // The universal concept graph — no board, no grade. See ADR 0006.
  [COLLECTIONS.concepts]: [
    { key: { subject: 1, domain: 1 }, name: 'subject_domain' },
    { key: { prereqIds: 1 }, name: 'prereqs' },
    { key: { aliases: 1 }, name: 'aliases' },
  ],

  [COLLECTIONS.curricula]: [
    // Onboarding: candidates for a learner's region + stage.
    { key: { regions: 1, subject: 1, active: 1 }, name: 'onboarding_candidates' },
  ],

  [COLLECTIONS.curriculumMappings]: [
    { key: { curriculumId: 1, conceptId: 1 }, unique: true, name: 'pair_unique' },
    // Coursework mode follows this curriculum's own teaching order.
    { key: { curriculumId: 1, sequenceIndex: 1 }, name: 'teaching_order' },
    { key: { conceptId: 1 }, name: 'reverse_lookup' },
  ],

  [COLLECTIONS.docChunks]: [
    // The retrieval security filter. A user must never read another's chunks.
    { key: { ownerScope: 1, ownerId: 1 }, name: 'owner' },
    { key: { conceptIds: 1 }, name: 'concepts' },
    // Curriculum-scoped retrieval, per the learner's profile.
    { key: { curriculumIds: 1, subject: 1 }, name: 'curriculum' },
    { key: { language: 1 }, name: 'language' },
    { key: { sourceId: 1 }, name: 'source' },
    // Reclaims the 512 MB cap from throwaway session uploads.
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl_session_chunks' },
  ],

  [COLLECTIONS.questions]: [
    // Card selection: concept + only-verified + difficulty band, in one index.
    {
      key: { conceptIds: 1, verificationStatus: 1, difficulty: 1 },
      name: 'card_selection',
    },
    { key: { curriculumIds: 1, verificationStatus: 1 }, name: 'curriculum_bank' },
    { key: { verificationStatus: 1, createdAt: -1 }, name: 'verification_queue' },
  ],

  [COLLECTIONS.attempts]: [
    { key: { userId: 1, conceptIds: 1, ts: -1 }, name: 'user_concept_recent' },
    { key: { questionId: 1 }, name: 'item_difficulty' },
    { key: { userId: 1, ts: -1 }, name: 'user_timeline' },
  ],

  [COLLECTIONS.mastery]: [
    { key: { userId: 1, conceptId: 1 }, unique: true, name: 'user_concept_unique' },
    // The due queue — hit on every single feed load.
    { key: { userId: 1, nextDueAt: 1 }, name: 'due_queue' },
    { key: { userId: 1, p: 1 }, name: 'weakest_first' },
  ],

  [COLLECTIONS.episodes]: [{ key: { userId: 1, createdAt: -1 }, name: 'user_recent' }],

  [COLLECTIONS.misconceptions]: [
    { key: { userId: 1, conceptId: 1, statement: 1 }, unique: true, name: 'unique_belief' },
    { key: { userId: 1, resolvedAt: 1 }, name: 'active' },
  ],

  [COLLECTIONS.chatSessions]: [
    { key: { userId: 1, createdAt: -1 }, name: 'user_recent' },
    { key: { userId: 1, archivedAt: 1 }, name: 'user_active' },
  ],

  [COLLECTIONS.messages]: [
    { key: { sessionId: 1, createdAt: 1 }, name: 'session_order' },
    // Walking the message tree. See docs/adr/0004-messages-are-a-tree.md.
    { key: { parentMessageId: 1 }, name: 'tree' },
  ],

  [COLLECTIONS.attachments]: [
    { key: { userId: 1, createdAt: -1 }, name: 'user_recent' },
    { key: { sessionId: 1 }, name: 'session' },
    { key: { status: 1 }, name: 'pipeline' },
  ],

  [COLLECTIONS.slips]: [
    { key: { userId: 1, rootCause: 1, createdAt: -1 }, name: 'error_dna' },
    { key: { attemptId: 1 }, unique: true, name: 'one_per_attempt' },
  ],

  [COLLECTIONS.duels]: [
    { key: { code: 1 }, unique: true, name: 'code_unique' },
    { key: { status: 1, createdAt: -1 }, name: 'lobby' },
  ],

  [COLLECTIONS.mindmaps]: [{ key: { userId: 1, createdAt: -1 }, name: 'user_recent' }],

  [COLLECTIONS.events]: [
    // Makes retries free. See docs/adr/0003-event-sourced-learner-state.md.
    { key: { idempotencyKey: 1 }, unique: true, name: 'idempotency' },
    { key: { seq: 1 }, unique: true, name: 'replay_cursor' },
    { key: { userId: 1, ts: -1 }, name: 'user_timeline' },
    { key: { type: 1, ts: -1 }, name: 'by_type' },
  ],

  [COLLECTIONS.llmCalls]: [
    { key: { createdAt: -1 }, name: 'recent' },
    { key: { task: 1, createdAt: -1 }, name: 'by_task' },
    // Keep 30 days locally; Langfuse holds the long tail.
    { key: { createdAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 30, name: 'ttl_30d' },
  ],

  [COLLECTIONS.promptVersions]: [{ key: { id: 1 }, unique: true, name: 'id_unique' }],
};

export interface EnsureResult {
  collection: string;
  created: string[];
  note?: string;
}

export async function ensureIndexes(): Promise<EnsureResult[]> {
  const database = db();
  const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const results: EnsureResult[] = [];

  for (const [name, specs] of Object.entries(REGULAR_INDEXES)) {
    if (!specs || specs.length === 0) continue;

    if (!existing.has(name)) {
      await database.createCollection(name);
    }

    try {
      const created = await database.collection(name).createIndexes(specs);
      results.push({ collection: name, created });
    } catch (e) {
      // Most commonly: an index with the same name but a different definition.
      // Report it rather than failing the whole run.
      results.push({
        collection: name,
        created: [],
        note: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}

/**
 * The two Atlas index definitions, generated from live config so
 * `numDimensions` can never drift from `OLLAMA_EMBED_DIM`.
 */
export function searchIndexDefinitions() {
  return [
    {
      name: SEARCH_INDEXES.chunksVector,
      collection: COLLECTIONS.docChunks,
      type: 'Atlas Vector Search',
      definition: {
        fields: [
          {
            type: 'vector',
            path: 'embedding',
            numDimensions: env.ollama.embedDim,
            similarity: 'cosine',
          },
          // Filter paths let the scope filter run *inside* the search instead of
          // after it. Post-filtering wrecks recall at small k.
          { type: 'filter', path: 'ownerScope' },
          { type: 'filter', path: 'ownerId' },
          { type: 'filter', path: 'conceptIds' },
          { type: 'filter', path: 'curriculumIds' },
          { type: 'filter', path: 'subject' },
          { type: 'filter', path: 'language' },
        ],
      },
    },
    {
      name: SEARCH_INDEXES.chunksText,
      collection: COLLECTIONS.docChunks,
      type: 'Atlas Search',
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            text: { type: 'string', analyzer: 'lucene.standard' },
            headingPath: { type: 'string', analyzer: 'lucene.standard' },
            ownerScope: { type: 'token' },
            ownerId: { type: 'token' },
            conceptIds: { type: 'token' },
            curriculumIds: { type: 'token' },
            subject: { type: 'token' },
            language: { type: 'token' },
          },
        },
      },
    },
  ];
}
