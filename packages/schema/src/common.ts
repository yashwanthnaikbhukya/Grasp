import { z } from 'zod';

/** Mongo ObjectId rendered as a 24-char hex string at every boundary. */
export const ObjectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'not an ObjectId');

/**
 * Concept ids are human-readable kebab-case slugs on purpose — they show up in
 * traces, prompts and logs, and `sin-cos-identities` is debuggable where
 * `c_7f3a91` is not. See docs/09-conventions.md.
 */
export const ConceptId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'concept ids are kebab-case slugs');

export const Surface = z.enum(['ask', 'reps', 'snap', 'duel', 'map', 'slips', 'test', 'placement']);
export type Surface = z.infer<typeof Surface>;

export const LangPref = z.enum(['en', 'hinglish']);
export type LangPref = z.infer<typeof LangPref>;

export const Scope = z.object({
  board: z.string().min(1),
  grade: z.string().min(1),
  subject: z.string().min(1),
});
export type Scope = z.infer<typeof Scope>;

/** Where a retrievable chunk belongs. Drives the retrieval security filter. */
export const OwnerScope = z.enum(['global', 'user', 'session']);
export type OwnerScope = z.infer<typeof OwnerScope>;

export const MasteryState = z.enum(['unseen', 'learning', 'review', 'mastered']);
export type MasteryState = z.infer<typeof MasteryState>;

/**
 * Fixed taxonomy, never free text. Aggregation is the entire product value of
 * Slips — "you lose 40% of your marks to sign errors under time pressure" only
 * exists if the labels are enumerable. See docs/06-learner-model.md.
 */
export const RootCause = z.enum([
  'careless-arithmetic',
  'misread-question',
  'prerequisite-gap',
  'misconception',
  'knowledge-gap',
  'time-pressure',
]);
export type RootCause = z.infer<typeof RootCause>;

export const QuestionType = z.enum(['mcq', 'multi', 'tapError', 'orderSteps', 'numeric', 'label']);
export type QuestionType = z.infer<typeof QuestionType>;

export const VerificationStatus = z.enum(['draft', 'quarantined', 'verified', 'rejected']);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const Intent = z.enum(['explain', 'solve', 'quiz', 'meta', 'chitchat']);
export type Intent = z.infer<typeof Intent>;

export const ModelTier = z.enum(['fast', 'mid', 'best']);
export type ModelTier = z.infer<typeof ModelTier>;

export const ProviderName = z.enum(['gemini', 'groq', 'openrouter', 'ollama']);
export type ProviderName = z.infer<typeof ProviderName>;
