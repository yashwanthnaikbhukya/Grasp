import { z } from 'zod';
import { AttachmentKind, ATTACHMENT_LIMITS } from './attachments';
import { ConceptId, Intent, ObjectIdString, Surface } from './common';

/** A retrieved passage as an answer shows it: its marker, where it is from, a glimpse of it. */
export const AnswerSourceSchema = z.object({
  citeId: z.string(),
  chunkId: z.string(),
  heading: z.string(),
  excerpt: z.string(),
});
export type AnswerSource = z.infer<typeof AnswerSourceSchema>;

/** Discriminated message parts — never a bare string, so citations survive. */
export const MessagePart = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('attachmentRef'), attachmentId: ObjectIdString }),
  z.object({ kind: z.literal('citation'), citeId: z.string(), chunkId: ObjectIdString }),
  z.object({ kind: z.literal('toolCall'), name: z.string(), input: z.unknown() }),
]);
export type MessagePart = z.infer<typeof MessagePart>;

export const MessageSchema = z.object({
  _id: ObjectIdString.optional(),
  sessionId: ObjectIdString,
  /**
   * Denormalized from the session so user-scoping is a direct filter.
   *
   * Joining through `chatSessions` would make every message read depend on a
   * second query being written correctly — exactly the kind of care that lapses.
   * See packages/core/src/auth/scope.ts.
   */
  userId: ObjectIdString,
  role: z.enum(['user', 'assistant', 'system']),

  /**
   * The tree. null ⇒ root. See docs/adr/0004-messages-are-a-tree.md — this is
   * nearly free now and a week of risky migration later.
   */
  parentMessageId: ObjectIdString.nullable().default(null),

  parts: z.array(MessagePart).min(1),
  citations: z.array(z.object({ chunkId: ObjectIdString, quoted: z.string() })).default([]),

  /**
   * Assistant messages: what the answer was given to read — every retrieved
   * passage under its `[cN]` marker, cited or not — and how the question was
   * understood. Saved so a reopened conversation shows "N sources" like a live
   * one; `citations` above stays the record of what was actually cited.
   */
  sources: z.array(AnswerSourceSchema).optional(),
  understoodAs: z.string().optional(),

  model: z.string().optional(),
  promptVersion: z.string().optional(),
  traceId: z.string().optional(),
  usage: z
    .object({ in: z.number().int(), out: z.number().int(), cachedIn: z.number().int().default(0) })
    .optional(),

  /**
   * Set after generation. `fabricated-citation`, `ungrounded` and `budget-shed`
   * are the hallucination metric; `keyword-only` means retrieval ran without the
   * embedder; `interrupted` means Stop or a closed tab cut the answer short.
   */
  flags: z
    .array(z.enum(['fabricated-citation', 'ungrounded', 'budget-shed', 'keyword-only', 'interrupted', 'no-material']))
    .default([]),

  /** Assistant messages: the mode that produced them and the learner's wait. */
  mode: z.lazy(() => ChatMode).optional(),
  ttftMs: z.number().int().nullable().optional(),

  /** The learner's thumbs on an answer — eval data, never shown to anyone else. */
  feedback: z
    .object({ rating: z.enum(['up', 'down']), at: z.coerce.date() })
    .optional(),

  /**
   * Replaced by Regenerate or Edit. Kept, not deleted — a rejected answer is
   * exactly the example an eval set needs — but never shown or sent as history.
   */
  supersededAt: z.coerce.date().nullable().optional(),

  createdAt: z.coerce.date(),
});
export type Message = z.infer<typeof MessageSchema>;

/**
 * How the tutor talks — chosen by the learner, per conversation.
 *
 *   answer — a complete answer straight away, the way a general assistant does.
 *   teach  — explains step by step at their level, then one check question.
 *   coach  — helps them work it out themselves: one step, one question at a time.
 *
 * All three share the same dialogue rules (an "I don't know" is answered with an
 * explanation, never another question). See docs/11-experience.md — Ask.
 */
export const ChatMode = z.enum(['answer', 'teach', 'coach']);
export type ChatMode = z.infer<typeof ChatMode>;
export const DEFAULT_CHAT_MODE: ChatMode = 'teach';

/**
 * POST /api/chat
 *
 *   a new turn   — `message` and/or `attachmentIds`
 *   `regenerate` — answer the latest question again; the old answer is superseded
 *   `editLast`   — replace the latest question (and its answer) with this one
 */
export const ChatRequestSchema = z
  .object({
    message: z.string().trim().max(4_000).default(''),
    sessionId: ObjectIdString.nullish(),
    mode: ChatMode.default(DEFAULT_CHAT_MODE),
    attachmentIds: z.array(ObjectIdString).max(ATTACHMENT_LIMITS.perMessage).default([]),
    regenerate: z.boolean().default(false),
    editLast: z.boolean().default(false),
  })
  .refine((r) => r.regenerate || r.message.length > 0 || r.attachmentIds.length > 0, {
    message: 'empty message',
    path: ['message'],
  })
  .refine((r) => !(r.regenerate || r.editLast) || Boolean(r.sessionId), {
    message: 'regenerate and edit need a conversation',
    path: ['sessionId'],
  });
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** POST /api/chat/feedback — thumbs on an answer; `null` clears it. */
export const ChatFeedbackRequestSchema = z.object({
  messageId: ObjectIdString,
  rating: z.enum(['up', 'down']).nullable(),
});
export type ChatFeedbackRequest = z.infer<typeof ChatFeedbackRequestSchema>;

export const ChatSessionSchema = z.object({
  _id: ObjectIdString.optional(),
  userId: ObjectIdString,
  title: z.string().default('New chat'),
  /** The mode of the latest turn — what the conversation reopens in. */
  mode: ChatMode.default(DEFAULT_CHAT_MODE),

  /** Rolling summary — the compaction artifact. Keeps the cache prefix stable. */
  digest: z
    .object({
      text: z.string(),
      throughMessageId: ObjectIdString,
      tokenCount: z.number().int().min(0),
    })
    .nullable()
    .default(null),

  /** Which branch of the tree renders. */
  activeLeafId: ObjectIdString.nullable().default(null),

  tokenStats: z
    .object({ in: z.number().int().default(0), out: z.number().int().default(0), cachedIn: z.number().int().default(0) })
    .default({ in: 0, out: 0, cachedIn: 0 }),

  createdAt: z.coerce.date(),
  archivedAt: z.coerce.date().nullable().default(null),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

/**
 * An uploaded file. The bytes sit on the same document as a BSON `data` field
 * until object storage (R2) lands — bounded by `ATTACHMENT_LIMITS`, never in an
 * API response, and always projected out of list reads.
 */
export const AttachmentSchema = z.object({
  _id: ObjectIdString.optional(),
  userId: ObjectIdString,
  sessionId: ObjectIdString.nullable().default(null),
  /** The user message it was sent with; null while it waits in the composer. */
  messageId: ObjectIdString.nullable().default(null),
  kind: AttachmentKind,
  /** Sniffed from the bytes, not trusted from the browser. */
  mime: z.string(),
  bytes: z.number().int().min(0),
  filename: z.string(),
  /** Where the bytes are: on this document today, `r2` once object storage lands. */
  storage: z.enum(['inline', 'r2']).default('inline'),
  r2Key: z.string().optional(),

  /**
   * `library` is the edge over ChatGPT: the upload persists into the learner's
   * corpus instead of dying with the conversation. Only `session` exists today.
   */
  scope: z.enum(['session', 'library']),
  status: z.enum(['uploading', 'extracting', 'ready', 'failed']),
  /** What the model read from it — the text the tutor and retrieval see. */
  extract: z
    .object({
      text: z.string(),
      pageCount: z.number().int().optional(),
      chunkCount: z.number().int().min(0).default(0),
      warnings: z.array(z.string()).default([]),
      promptVersion: z.string().optional(),
    })
    .nullable()
    .default(null),
  createdAt: z.coerce.date(),
  /** A TTL index deletes the document at this time. */
  expiresAt: z.coerce.date(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * What the context broker hands a model. Ordered, budgeted, citable.
 * See docs/05-context-broker.md.
 */
/**
 * What the context broker hands a model call — the shape `assemble()` returns.
 * Rule 3: this is the definition; core's `assemble()` is typed by it.
 * Attachments are planned (Phase 1.5) and optional until then.
 */
export const ContextBundleSchema = z.object({
  bundleId: z.string(),
  intent: Intent,
  rewrittenQuery: z.string(),
  conceptIds: z.array(ConceptId),
  needsClarification: z.boolean(),

  /** ~300 tokens of hand-formatted prose. The whole differentiator. */
  learnerCard: z.string(),
  /** The verbatim tail, oldest first; older turns would live in `digest`. */
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })),
  digest: z.string().optional(),
  retrieved: z.array(
    z.object({
      citeId: z.string(),
      chunkId: z.string(),
      headingPath: z.array(z.string()),
      text: z.string(),
    }),
  ),
  attachments: z
    .array(z.object({ citeId: z.string(), attachmentId: ObjectIdString, excerpt: z.string() }))
    .optional(),

  budget: z.object({
    granted: z.record(z.string(), z.number()),
    used: z.record(z.string(), z.number()),
    /** Non-empty is not an error — it's the signal a budget profile needs tuning. */
    shed: z.array(z.string()),
    totalUsed: z.number(),
  }),
  /** citeId → chunkId, for verifying citations after generation. */
  citeMap: z.record(z.string(), z.string()),
  timings: z.object({ understand: z.number(), retrieve: z.number(), total: z.number() }),
  /** Which path each retrieval leg took — `unavailable` means keyword-only. */
  retrievalLegs: z.object({ lexical: z.string(), vector: z.string() }),
  /** The relevance gate: the similarity floor applied and how many passages it removed. */
  relevance: z.object({ floor: z.number(), dropped: z.number().int().min(0) }).optional(),
});
export type ContextBundle = z.infer<typeof ContextBundleSchema>;
