import { z } from 'zod';
import { ConceptId, Intent, QuestionType, RootCause } from './common';

/**
 * Output schemas for model tasks.
 *
 * Every task whose output is consumed by code declares one. The gateway converts
 * it to JSON Schema, passes it as the provider's native structured-output
 * constraint, validates the response, and repairs once on failure — so feature
 * code receives a typed value or an exception, never a `JSON.parse`.
 *
 * See docs/04-llm-gateway.md#structured-output.
 */

/**
 * `query.understand` — step 1 of the context broker, and the step most RAG
 * systems skip. Without the rewrite, every follow-up turn retrieves garbage.
 */
export const QueryUnderstandingSchema = z.object({
  /** Self-contained restatement. "explain that again" → the actual question. */
  rewritten: z.string().min(1),
  /** Concept nodes this query touches. Empty is valid for chitchat. */
  conceptIds: z.array(ConceptId).max(8),
  intent: Intent,
  /** True when the query cannot be resolved without more from the learner. */
  needsClarification: z.boolean().default(false),
});
export type QueryUnderstanding = z.infer<typeof QueryUnderstandingSchema>;

/** `concept.tag` — attaches a chunk or doubt to the graph. The interop layer. */
export const ConceptTaggingSchema = z.object({
  conceptIds: z.array(ConceptId).max(6),
  /** 0–1. Low-confidence tags are stored but excluded from retrieval boosts. */
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(400).optional(),
});
export type ConceptTagging = z.infer<typeof ConceptTaggingSchema>;

/**
 * `slip.classify` — runs on the `best` tier because the label is written into
 * the learner graph. A wrong label changes what the learner practises for weeks.
 */
export const SlipClassificationSchema = z.object({
  rootCause: RootCause,
  confidence: z.number().min(0).max(1),
  /** One learner-facing sentence. No blame, no jargon. */
  note: z.string().max(240),
  /** Set only for `prerequisite-gap`. */
  upstreamConceptId: ConceptId.optional(),
});
export type SlipClassification = z.infer<typeof SlipClassificationSchema>;

/** `card.generate` — draft only. Nothing reaches a learner before verification. */
export const GeneratedCardSchema = z.object({
  type: QuestionType,
  stem: z.string().min(1),
  options: z
    .array(z.object({ id: z.string(), text: z.string(), isCorrect: z.boolean() }))
    .optional(),
  answer: z.unknown(),
  solution: z.string().min(1),
  /** Model's own estimate, refined later from real attempts. */
  difficultyGuess: z.number().min(-3).max(3),
  conceptIds: z.array(ConceptId).min(1).max(3),
});
export type GeneratedCard = z.infer<typeof GeneratedCardSchema>;

/** `card.solve` — the independent solve leg of the verification pipeline. */
export const CardSolveSchema = z.object({
  answer: z.unknown(),
  reasoning: z.string(),
  /** Set when the item itself is broken — ambiguous stem, two correct options. */
  flaw: z.enum(['none', 'ambiguous', 'multiple-correct', 'no-correct', 'unanswerable']),
});
export type CardSolve = z.infer<typeof CardSolveSchema>;

/**
 * `concept.propose` — the model authoring a graph node it has just decided is
 * missing. See docs/adr/0007-llm-authored-concept-graph.md.
 *
 * Prerequisites come back as **names, not ids**: the model cannot know our slugs,
 * so each name is resolved through the same dedupe path recursively.
 */
export const ConceptProposalSchema = z.object({
  concepts: z
    .array(
      z.object({
        /** Canonical international-English name. Not a curriculum's local label. */
        name: z.string().min(2).max(120),
        /** Local and colloquial variants — these carry the dedupe fast path. */
        aliases: z.array(z.string()).max(10).default([]),
        subject: z.string().min(2),
        /** Broad universal grouping, e.g. `trigonometry`. Not a chapter number. */
        domain: z.string().default(''),
        description: z.string().min(10).max(600),
        objectives: z.array(z.string()).max(6).default([]),
        /** Typical band on the normalized ladder. Advisory only. */
        stageMin: z.number().int().min(1).max(14),
        stageMax: z.number().int().min(1).max(14),
        /**
         * Immediate prerequisites, by name. Only genuine hard dependencies —
         * things a learner must already hold to make sense of this at all.
         */
        prerequisiteNames: z.array(z.string().min(2).max(120)).max(5).default([]),
      }),
    )
    .min(1)
    .max(6),
});
export type ConceptProposal = z.infer<typeof ConceptProposalSchema>;

/** `session.title` — runs after turn 2. */
export const SessionTitleSchema = z.object({
  title: z.string().min(1).max(60),
});
export type SessionTitle = z.infer<typeof SessionTitleSchema>;

/** `session.digest` — the history compaction artifact. */
export const SessionDigestSchema = z.object({
  digest: z.string().min(1),
  conceptIds: z.array(ConceptId).max(12),
  openThreads: z.array(z.string()).max(5),
});
export type SessionDigest = z.infer<typeof SessionDigestSchema>;

/** `mindmap.build` — edges are typed, never untyped. */
export const MindmapSchema = z.object({
  rootLabel: z.string(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        conceptId: ConceptId.optional(),
        detail: z.string().max(300).optional(),
      }),
    )
    .min(2)
    .max(80),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        relation: z.enum(['is-a', 'part-of', 'causes', 'contrasts-with', 'requires']),
      }),
    )
    .max(160),
});
export type Mindmap = z.infer<typeof MindmapSchema>;

/** `doubt.decompose` — Snap's step-wise walkthrough. */
export const DoubtDecompositionSchema = z.object({
  restatedProblem: z.string(),
  conceptIds: z.array(ConceptId).min(1).max(4),
  steps: z
    .array(
      z.object({
        prompt: z.string(),
        /** What the learner should arrive at. Revealed only after they try. */
        expected: z.string(),
        hint: z.string(),
      }),
    )
    .min(1)
    .max(10),
  finalAnswer: z.string(),
});
export type DoubtDecomposition = z.infer<typeof DoubtDecompositionSchema>;

/** `eval.judge` — rubric scoring. Judged by a different family than produced it. */
export const EvalJudgementSchema = z.object({
  passed: z.boolean(),
  scores: z.record(z.string(), z.number().min(0).max(1)),
  reasoning: z.string().max(600),
});
export type EvalJudgement = z.infer<typeof EvalJudgementSchema>;
