import { z } from 'zod';
import { ConceptId, ObjectIdString, OwnerScope, QuestionType, VerificationStatus } from './common';
import { CurriculumId } from './curriculum';
import { StageRange } from './stage';

/**
 * Content atoms carry `curriculumIds[]` plus an advisory `stageRange` — not a
 * single board and grade.
 *
 * A chunk serving several curricula is the normal case, not an edge case: a good
 * explanation of the Pythagorean identity is correct in all of them. Cross-
 * curriculum reuse is the default. See
 * docs/adr/0006-curriculum-agnostic-concepts.md.
 */

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

  /** Curricula this content is valid for. Empty ⇒ curriculum-neutral, always eligible. */
  curriculumIds: z.array(CurriculumId).default([]),
  subject: z.string().default(''),
  /** Advisory fit band. Ranks and caveats; never refuses. */
  stageRange: StageRange.nullable().default(null),
  /** BCP-47. Retrieval stays in the corpus language; the tutor translates. */
  language: z.string().default('en'),

  page: z.number().int().min(1).optional(),
  /** e.g. ["Ch 8", "8.2 Identities"]. Prepended at assembly — cheap grounding win. */
  headingPath: z.array(z.string()).default([]),
  tokenCount: z.number().int().min(0),

  /** TTL for `session` scope. Throwaway uploads are what fills the 512 MB cap. */
  expiresAt: z.coerce.date().nullable().default(null),
  createdAt: z.coerce.date(),
});
export type DocChunk = z.infer<typeof DocChunkSchema>;

export const SourceSchema = z.object({
  _id: ObjectIdString.optional(),
  kind: z.enum(['textbook', 'notes', 'upload', 'transcript', 'openstax', 'web']),
  title: z.string().min(1),
  /** Licence matters for a global product shipping other people's material. */
  licence: z.string().default('unknown'),
  attribution: z.string().default(''),
  r2Key: z.string().optional(),
  pageCount: z.number().int().min(1).optional(),
  curriculumIds: z.array(CurriculumId).default([]),
  language: z.string().default('en'),
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

  /** Empty ⇒ curriculum-neutral. Exam-format items are usually curriculum-specific. */
  curriculumIds: z.array(CurriculumId).default([]),
  subject: z.string().default(''),
  stageRange: StageRange.nullable().default(null),
  language: z.string().default('en'),
  createdAt: z.coerce.date(),
});
export type Question = z.infer<typeof QuestionSchema>;
