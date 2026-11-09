import { z } from 'zod';
import { CurriculumId } from './curriculum';
import { Region, Stage } from './stage';

/**
 * The learner profile, discovered at onboarding.
 *
 * This replaces the old process-level `GRASP_BOARD/GRADE/SUBJECT` scope: scope is
 * a property of the learner, not of the deployment. Two learners on different
 * continents, curricula, and languages work in the same instance — which is the
 * whole point of a learner model.
 *
 * **Every field is optional with a documented default.** Onboarding is
 * progressive and skippable; an incomplete profile degrades the experience, it
 * never breaks it. See docs/10-onboarding.md.
 */

export const GoalKind = z.enum(['exam', 'coursework', 'self-study', 'competition', 'career']);
export type GoalKind = z.infer<typeof GoalKind>;

export const LearnerGoal = z.object({
  kind: GoalKind.default('self-study'),
  /** Set for `exam`. Drives review urgency and the study plan's direction. */
  examDate: z.coerce.date().nullable().default(null),
  /** Learner-facing name, e.g. "CBSE Board", "SAT", "IMO qualifier". */
  label: z.string().default(''),
});
export type LearnerGoal = z.infer<typeof LearnerGoal>;

export const LanguagePref = z.object({
  /** BCP-47. The language explanations are written in. */
  instruction: z.string().min(2).default('en'),
  /**
   * The other half of a code-switching pair, e.g. `hi` with `instruction: 'en'`
   * for Hinglish. Null means monolingual.
   *
   * How a large share of the world actually studies — Hinglish, Spanglish,
   * Taglish, Arabizi. Offering it explicitly is a real differentiator, and it
   * costs one field.
   */
  codeSwitch: z.string().min(2).nullable().default(null),
});
export type LanguagePref = z.infer<typeof LanguagePref>;

/**
 * The consent basis. Driven by age and region — the strictest applicable regime
 * wins. See docs/10-onboarding.md#safety-and-age-appropriateness.
 */
export const ConsentRecord = z.object({
  basis: z.enum(['adult', 'parental', 'pending', 'unknown']).default('unknown'),
  grantedAt: z.coerce.date().nullable().default(null),
  guardianEmail: z.string().email().nullable().default(null),
  /** Which regime was applied, for the audit trail. */
  regime: z.enum(['coppa', 'gdpr-k', 'dpdp', 'aadc', 'none']).default('none'),
});
export type ConsentRecord = z.infer<typeof ConsentRecord>;

export const LearnerProfileSchema = z.object({
  /** ISO 3166-1 alpha-2, or `XX` when declined. Sets curricula, units, notation. */
  region: Region.default('XX'),
  locale: z.string().default('en'),

  /**
   * The reliable anchor — works in school, repeating a year, or as an adult.
   * Never inferred from stage: being a year or two off-ladder is common, and
   * getting age wrong in either direction is a compliance problem.
   */
  age: z.number().int().min(4).max(120).nullable().default(null),
  /** Normalized ladder position. Labelled per region for display only. */
  stage: Stage.nullable().default(null),
  inFormalEducation: z.boolean().default(true),

  curriculumIds: z.array(CurriculumId).default([]),
  subjects: z.array(z.string()).default([]),

  goal: LearnerGoal.default({}),
  minutesPerDay: z.number().int().min(5).max(600).default(30),

  language: LanguagePref.default({}),
  /** Default response length. A starting point, later overridden by behaviour. */
  depth: z.enum(['brief', 'balanced', 'thorough']).default('balanced'),

  /**
   * Self-rated confidence per subject, 1–5. A **prior only** — the placement
   * quiz and real attempts measure. People misjudge in both directions, so this
   * decays quickly as evidence arrives.
   */
  selfRated: z.record(z.string(), z.number().int().min(1).max(5)).default({}),

  consent: ConsentRecord.default({}),

  /** Which onboarding steps are done. Drives the nudge, never a blocking modal. */
  completedSteps: z.array(z.string()).default([]),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

/**
 * Fields that most improve the experience, in the order worth asking for them.
 *
 * Each carries an explicit predicate rather than a generic emptiness check,
 * because "has a default" and "the learner told us" are different things. Most
 * fields here have a usable default — that is what keeps onboarding skippable —
 * so only an affirmative signal counts.
 */
const WEIGHTED_FIELDS: {
  key: keyof LearnerProfile;
  weight: number;
  isSet: (p: LearnerProfile) => boolean;
}[] = [
  { key: 'region', weight: 2, isSet: (p) => p.region !== 'XX' },
  { key: 'age', weight: 2, isSet: (p) => p.age !== null },
  // A learner outside formal education has no stage, and that is a complete
  // answer rather than a gap — don't nag them about it forever.
  { key: 'stage', weight: 2, isSet: (p) => p.stage !== null || !p.inFormalEducation },
  { key: 'curriculumIds', weight: 3, isSet: (p) => p.curriculumIds.length > 0 },
  { key: 'subjects', weight: 3, isSet: (p) => p.subjects.length > 0 },
  { key: 'goal', weight: 2, isSet: (p) => p.goal.label !== '' || p.goal.examDate !== null },
  // `language` always parses to a default, so only an explicit pass through the
  // onboarding step counts. Otherwise every profile would score points for an
  // assumption nobody made.
  { key: 'language', weight: 1, isSet: (p) => p.completedSteps.includes('language') },
];

const TOTAL_WEIGHT = WEIGHTED_FIELDS.reduce((s, f) => s + f.weight, 0);

/**
 * 0–1. Surfaced as a gentle nudge toward the highest-value gap.
 * Never used to block a surface.
 */
export function profileCompleteness(p: LearnerProfile): number {
  const have = WEIGHTED_FIELDS.reduce((s, f) => (f.isSet(p) ? s + f.weight : s), 0);
  return Math.round((have / TOTAL_WEIGHT) * 100) / 100;
}

/** The single most useful thing still missing, or null when nothing is. */
export function nextProfileGap(p: LearnerProfile): keyof LearnerProfile | null {
  return WEIGHTED_FIELDS.find((f) => !f.isSet(p))?.key ?? null;
}
