import type { Collection, Document, ObjectId } from 'mongodb';
import { db } from './client';

/**
 * Typed collection accessors. These names are the only place collection strings
 * appear — never `db().collection('users')` in feature code.
 *
 * Field-level shapes are documented in docs/03-data-model.md and enforced by Zod
 * at the boundary. The `Doc*` types below are the storage view (ObjectId, Date),
 * distinct from the Zod-inferred wire view (hex string, ISO date).
 */

export const COLLECTIONS = {
  users: 'users',
  concepts: 'concepts',
  sources: 'sources',
  docChunks: 'docChunks',
  questions: 'questions',
  attempts: 'attempts',
  mastery: 'mastery',
  episodes: 'episodes',
  misconceptions: 'misconceptions',
  chatSessions: 'chatSessions',
  messages: 'messages',
  attachments: 'attachments',
  slips: 'slips',
  duels: 'duels',
  mindmaps: 'mindmaps',
  events: 'events',
  counters: 'counters',
  llmCalls: 'llmCalls',
  promptVersions: 'promptVersions',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

function col<T extends Document>(name: CollectionName): Collection<T> {
  return db().collection<T>(name);
}

export interface DocEvent extends Document {
  _id?: ObjectId;
  seq: number;
  type: string;
  userId: ObjectId | string;
  payload: unknown;
  idempotencyKey: string;
  ts: Date;
}

export interface DocLlmCall extends Document {
  _id?: ObjectId;
  task: string;
  tier: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latencyMs: number;
  ok: boolean;
  errorKind?: string;
  /** > 0 means the primary provider was unusable. The number to watch. */
  failoverDepth: number;
  userId?: string;
  traceId: string;
  createdAt: Date;
}

export interface DocCounter extends Document {
  _id: string;
  value: number;
}

export const collections = {
  users: () => col(COLLECTIONS.users),
  concepts: () => col(COLLECTIONS.concepts),
  sources: () => col(COLLECTIONS.sources),
  docChunks: () => col(COLLECTIONS.docChunks),
  questions: () => col(COLLECTIONS.questions),
  attempts: () => col(COLLECTIONS.attempts),
  mastery: () => col(COLLECTIONS.mastery),
  episodes: () => col(COLLECTIONS.episodes),
  misconceptions: () => col(COLLECTIONS.misconceptions),
  chatSessions: () => col(COLLECTIONS.chatSessions),
  messages: () => col(COLLECTIONS.messages),
  attachments: () => col(COLLECTIONS.attachments),
  slips: () => col(COLLECTIONS.slips),
  duels: () => col(COLLECTIONS.duels),
  mindmaps: () => col(COLLECTIONS.mindmaps),
  events: () => col<DocEvent>(COLLECTIONS.events),
  counters: () => col<DocCounter>(COLLECTIONS.counters),
  llmCalls: () => col<DocLlmCall>(COLLECTIONS.llmCalls),
  promptVersions: () => col(COLLECTIONS.promptVersions),
};

/** Atlas Search / Vector Search index names, referenced from retrieval code. */
export const SEARCH_INDEXES = {
  chunksVector: 'grasp_chunks_vec',
  chunksText: 'grasp_chunks_text',
  messagesText: 'grasp_messages_text',
} as const;
