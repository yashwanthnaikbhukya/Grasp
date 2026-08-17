import { z } from 'zod';
import {
  ConceptId,
  ObjectIdString,
  OwnerScope,
  QuestionType,
  VerificationStatus,
} from './common';

/** A retrievable span of text. This `_id` is what the model cites. */
export const DocChunkSchema = z.object({
  _id: ObjectIdString.optional(),
  ownerScope: OwnerScope,
  /** userId or sessionId when scoped. Part of the retrieval security filter. */
  ownerId: z.string().nullable().default(null),
  sourceId: ObjectIdString,

  text: z.string().min(1),
  /** Dimension must match OLLAMA_EMBED_DIM and the Atlas vector index. */
  embedding: z.array(z.number()),
  conceptIds: z.array(ConceptId).default([]),

  page: z.number().int().min(1).optional(),
  /** e.g. ["Ch 8", "8.2 Identities"]. Prepended at assembly — cheap grounding win. */
  headingPath: z.array(z.string()).default([]),
  tokenCount: z.number().int().min(0),

  board: z.string(),
  grade: z.string(),
  subject: z.string(),

  /** TTL for `session` scope. Throwaway uploads are what fills the 512 MB cap. */
  expiresAt: z.coerce.date().nullable().default(null),
  createdAt: z.coerce.date(),
});
export type DocChunk = z.infer<typeof DocChunkSchema>;

export const SourceSchema = z.object({
  _id: ObjectIdString.optional(),
  kind: z.enum(['textbook', 'notes', 'upload', 'transcript']),
  title: z.string().min(1),
  r2Key: z.string().optional(),
  pageCount: z.number().int().min(1).optional(),
  ownerScope: OwnerScope,
  ownerId: z.string().nullable().default(null),
  ingestedAt: z.coerce.date(),
});
export type Source = z.infer<typeof SourceSchema>;

const Option = z.object({ id: z.string(), text: z.string(), isCorrect: z.boolean() });

export const QuestionSchema = z.object({
  _id: ObjectIdString.optional(),
  conceptIds: z.array(ConceptId).min(1),
  type: QuestionType,
  stem: z.string().min(1),
  options: z.array(Option).optional(),
  answer: z.unknown(),
  solution: z.string().min(1),

  /** IRT `b`. Starts as a model estimate, refined from real attempts. */
  difficulty: z.number().min(-3).max(3),

  /**
   * Only `verified` may be served — enforced in the card query, not by
   * convention. Generated questions are subtly wrong often enough that shipping
   * unverified ones is the fastest way to lose a learner's trust.
   */
  verificationStatus: VerificationStatus.default('draft'),
  verification: z
    .object({
      solvedBy: z.array(z.object({ model: z.string(), answer: z.unknown(), flaw: z.string() })),
      agreement: z.boolean(),
      checkedBy: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),

  sourceId: ObjectIdString.optional(),
  generatedBy: z
    .object({ task: z.string(), promptVersion: z.string(), model: z.string() })
    .optional(),

  board: z.string(),
  grade: z.string(),
  subject: z.string(),
  createdAt: z.coerce.date(),
});
export type Question = z.infer<typeof QuestionSchema>;
