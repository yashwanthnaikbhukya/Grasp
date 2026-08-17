import { z } from 'zod';
import { ConceptId, Intent, ObjectIdString, Surface } from './common';

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
  role: z.enum(['user', 'assistant', 'system']),

  /**
   * The tree. null ⇒ root. See docs/adr/0004-messages-are-a-tree.md — this is
   * nearly free now and a week of risky migration later.
   */
  parentMessageId: ObjectIdString.nullable().default(null),

  parts: z.array(MessagePart).min(1),
  citations: z.array(z.object({ chunkId: ObjectIdString, quoted: z.string() })).default([]),

  model: z.string().optional(),
  promptVersion: z.string().optional(),
  traceId: z.string().optional(),
  usage: z
    .object({ in: z.number().int(), out: z.number().int(), cachedIn: z.number().int().default(0) })
    .optional(),

  /** Set post-generation by citation verification — the hallucination metric. */
  flags: z.array(z.enum(['fabricated-citation', 'ungrounded', 'budget-shed'])).default([]),

  createdAt: z.coerce.date(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ChatSessionSchema = z.object({
  _id: ObjectIdString.optional(),
  userId: ObjectIdString,
  title: z.string().default('New chat'),

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

export const AttachmentSchema = z.object({
  _id: ObjectIdString.optional(),
  userId: ObjectIdString,
  sessionId: ObjectIdString.nullable().default(null),
  r2Key: z.string(),
  mime: z.string(),
  bytes: z.number().int().min(0),
  filename: z.string(),

  /**
   * `library` is the edge over ChatGPT: the upload persists into the learner's
   * corpus instead of dying with the conversation.
   */
  scope: z.enum(['session', 'library']),
  status: z.enum(['uploading', 'extracting', 'ready', 'failed']),
  extract: z
    .object({
      pageCount: z.number().int().optional(),
      chunkCount: z.number().int().min(0),
      warnings: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  createdAt: z.coerce.date(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * What the context broker hands a model. Ordered, budgeted, citable.
 * See docs/05-context-broker.md.
 */
export const ContextBundleSchema = z.object({
  bundleId: z.string(),
  surface: Surface,
  intent: Intent,
  rewrittenQuery: z.string(),
  conceptIds: z.array(ConceptId),

  /** Stable → belongs at the front of a cacheable prefix. */
  system: z.string(),
  /** ~300 tokens of hand-formatted prose. The whole differentiator. */
  learnerCard: z.string(),
  history: z.object({
    verbatim: z.array(z.object({ role: z.string(), text: z.string() })),
    digest: z.string().optional(),
  }),
  retrieved: z.array(
    z.object({
      citeId: z.string(),
      chunkId: ObjectIdString,
      headingPath: z.array(z.string()),
      text: z.string(),
    }),
  ),
  attachments: z.array(
    z.object({ citeId: z.string(), attachmentId: ObjectIdString, excerpt: z.string() }),
  ),

  budget: z.object({
    allocated: z.record(z.string(), z.number()),
    used: z.record(z.string(), z.number()),
    /** Non-empty is not an error — it's the signal a budget profile needs tuning. */
    shed: z.array(z.string()),
  }),
  citeMap: z.record(z.string(), z.string()),
});
export type ContextBundle = z.infer<typeof ContextBundleSchema>;
