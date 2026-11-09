import { z } from 'zod';
import { Intent, RootCause } from './common';

/**
 * Golden-set cases for `pnpm eval` (docs/09-conventions.md — Evals).
 *
 * One JSONL file per task in packages/core/src/eval/golden/. A case is an input,
 * optional prior turns, and an `expect` block whose shape depends on the task —
 * deterministic checks wherever the answer is checkable, a rubric for prose.
 */

export const RubricItemSchema = z.object({
  id: z.string().min(1),
  /** Independently checkable. "Is it good" is not a rubric item. */
  text: z.string().min(1),
  /** A MUST item failing fails the case; a non-must item only lowers the score. */
  must: z.boolean().default(true),
});
export type RubricItem = z.infer<typeof RubricItemSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  /** Why this case exists — usually the real failure it was grown from. */
  note: z.string().optional(),
  /** Task input. Missing context keys are filled from the task's fixtures. */
  input: z.record(z.string(), z.unknown()).default({}),
  /** Earlier turns, sent as real chat messages (tutor tasks). */
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .default([]),
  expect: z.record(z.string(), z.unknown()),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** Case-insensitive substring groups: every group must match one of its alternatives. */
const MentionGroups = z.array(z.array(z.string().min(1)).min(1));

export const QueryUnderstandExpectSchema = z.object({
  intent: z.array(Intent).min(1).optional(),
  /** Every one of these must be tagged. */
  conceptsInclude: z.array(z.string()).default([]),
  /** At least one of these must be tagged. */
  conceptsAnyOf: z.array(z.string()).default([]),
  /** None of these may be tagged. */
  conceptsExclude: z.array(z.string()).default([]),
  /** True ⇒ the tag list must be empty (chitchat, meta). */
  conceptsEmpty: z.boolean().optional(),
  rewriteMentions: MentionGroups.default([]),
  needsClarification: z.boolean().optional(),
});

export const SlipExpectSchema = z.object({
  /** Any of these labels is a correct classification. */
  rootCause: z.array(RootCause).min(1),
});

export const CardSolveExpectSchema = z.object({
  type: z.enum(['mcq', 'numeric']),
  /** Option id for mcq, a number (or numeric string) for numeric. Absent for flawed items. */
  answer: z.unknown().optional(),
  flaw: z
    .array(z.enum(['none', 'ambiguous', 'multiple-correct', 'no-correct', 'unanswerable']))
    .default(['none']),
});

export const TutorExpectSchema = z.object({
  /** Counted as `?` characters — the dialogue rules cap questions per message. */
  maxQuestions: z.number().int().min(0).optional(),
  minQuestions: z.number().int().min(0).optional(),
  /** The message's last sentence is a question (Teach's check question). */
  endsWithQuestion: z.boolean().optional(),
  /** Case-insensitive; e.g. the question already asked, which must not repeat. */
  mustNotContain: z.array(z.string()).default([]),
  mustMention: MentionGroups.default([]),
  rubric: z.array(RubricItemSchema).default([]),
});

export type QueryUnderstandExpect = z.infer<typeof QueryUnderstandExpectSchema>;
export type SlipExpect = z.infer<typeof SlipExpectSchema>;
export type CardSolveExpect = z.infer<typeof CardSolveExpectSchema>;
export type TutorExpect = z.infer<typeof TutorExpectSchema>;
