import { z } from 'zod';
import { ConceptId } from './common';
import { Region, Stage, StageRange } from './stage';
import { SubjectId } from './subjects';

/**
 * A curriculum is an **overlay** on the universal concept graph — it says which
 * concepts are in scope, what they're called locally, and in what order they're
 * taught. It never owns concepts.
 *
 * Since ADR 0008 a curriculum is a *programme*: a board or school curriculum
 * (CBSE Senior Secondary, GCSE), an entrance or admissions exam (JEE, NEET-UG,
 * SAT, GRE), university coursework, a professional qualification (ACCA, CFA), or
 * a competition — each offering several subjects. Learners pick programmes, then
 * subjects from the full catalogue (subjects.ts), with the programme's subjects
 * suggested first.
 *
 * See docs/adr/0006-curriculum-agnostic-concepts.md.
 */

export const CurriculumKind = z.enum(['school', 'exam', 'university', 'professional', 'competition', 'self-study']);
export type CurriculumKind = z.infer<typeof CurriculumKind>;

/** Onboarding's section headings, in the order shown. */
export const CURRICULUM_KIND_NAME: Record<CurriculumKind, string> = {
  school: 'School boards & curricula',
  exam: 'Entrance & admission exams',
  university: 'College & university',
  professional: 'Professional qualifications',
  competition: 'Competitions & olympiads',
  'self-study': 'Something else',
};

export const CurriculumId = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'curriculum ids are kebab-case slugs');

/**
 * Regional convention differences that a tutor must respect.
 *
 * Not cosmetic: `trapezoid` denotes *different shapes* in US and UK English, and
 * a tutor confidently using the wrong one is worse than one that says nothing.
 */
export const NotationProfile = z.object({
  /** `csc` (US) vs `cosec` (UK/India/Commonwealth). */
  reciprocalTrig: z.enum(['csc-sec-cot', 'cosec-sec-cot']).default('csc-sec-cot'),
  /** US trapezoid = one parallel pair; UK trapezium = the same shape. Opposite names. */
  quadrilateral: z.enum(['us', 'commonwealth']).default('us'),
  decimalSeparator: z.enum(['.', ',']).default('.'),
  /** `100,000` vs the Indian `1,00,000` lakh/crore grouping. */
  digitGrouping: z.enum(['thousands', 'lakh-crore']).default('thousands'),
  units: z.enum(['metric', 'imperial', 'mixed']).default('metric'),
  /** `1.2 × 10^3` vs `1,2 · 10³`, and `,` vs `;` as an argument separator. */
  spelling: z.enum(['en-US', 'en-GB']).default('en-US'),
});
export type NotationProfile = z.infer<typeof NotationProfile>;

export const CurriculumSchema = z.object({
  _id: CurriculumId,
  /** Display name as a learner would recognise it. */
  name: z.string().min(1),
  /** Who sets it — a board, ministry, or international body. */
  authority: z.string().min(1),
  /**
   * Regions where it is offered. `['*']` for genuinely international curricula
   * such as IB or Cambridge International.
   */
  regions: z.array(z.union([Region, z.literal('*')])).min(1),
  kind: CurriculumKind.default('school'),
  /** Subjects it offers, as catalogue ids. Suggested at onboarding — never a limit. */
  subjects: z.array(SubjectId).min(1),
  stageRange: StageRange,
  /** Language of instruction, BCP-47. */
  language: z.string().min(2).default('en'),
  notation: NotationProfile.default({}),
  /** A terminal exam this curriculum leads to, when there is one. */
  exam: z
    .object({ name: z.string(), typicalMonth: z.number().int().min(1).max(12).optional() })
    .nullable()
    .default(null),
  /** False for retired curricula: keep for existing learners, hide from onboarding. */
  active: z.boolean().default(true),
});
export type Curriculum = z.infer<typeof CurriculumSchema>;

/**
 * The join, and where all local truth lives. One row per (curriculum, concept).
 *
 * Absence of a row means "not mapped", which is treated as in-scope-but-unordered
 * rather than out-of-scope — an unmapped concept should degrade to the universal
 * default, not disappear.
 */
export const CurriculumMappingSchema = z.object({
  curriculumId: CurriculumId,
  conceptId: ConceptId,

  /** Local name where it differs from canonical, e.g. `cosec` for `csc`. */
  localName: z.string().optional(),
  /** The curriculum's own reference, e.g. `Ch 8.3` or `AA SL 3.2`. */
  localCode: z.string().optional(),
  /** Teaching order within this curriculum. Drives coursework-mode sequencing. */
  sequenceIndex: z.number().int().min(0),
  /** Some curricula exclude a concept outright. */
  inScope: z.boolean().default(true),
  /** Where the curriculum places it, when it differs from the concept default. */
  stage: Stage.optional(),
  /** Rough share of the terminal exam, 0–1. Drives revision prioritisation. */
  examWeight: z.number().min(0).max(1).optional(),
});
export type CurriculumMapping = z.infer<typeof CurriculumMappingSchema>;

/** Shape of `data/curricula.seed.json`. */
export const CurriculumSeedSchema = z.object({
  curricula: z.array(CurriculumSchema),
  mappings: z
    .array(
      CurriculumMappingSchema.omit({ sequenceIndex: true }).extend({
        sequenceIndex: z.number().int().min(0).optional(),
      }),
    )
    .default([]),
});
export type CurriculumSeed = z.infer<typeof CurriculumSeedSchema>;

/**
 * The always-available fallback. A learner with no matching curriculum is a
 * first-class case, not an error state: they get the universal graph with no
 * `inScope` filtering, which is broader rather than broken.
 */
export const SELF_STUDY_CURRICULUM_ID = 'self-study';

export interface CurriculumCandidate {
  id: string;
  regions: readonly string[];
  stageMin: number;
  stageMax: number;
  kind: CurriculumKind;
}

/**
 * The programmes onboarding offers a learner: their region's and the
 * international ones, that fit their stage (within a year — curricula disagree
 * by a year all the time), regional first. With no stage (not in formal
 * education), everything for the region. Self-study is always there.
 */
export function curriculumCandidates<C extends CurriculumCandidate>(
  all: readonly C[],
  region: string,
  stage: number | null,
): C[] {
  const r = region.toUpperCase();
  const fits = (c: C) =>
    c.kind === 'self-study' ||
    ((c.regions.includes('*') || c.regions.includes(r)) &&
      (stage === null || (stage >= c.stageMin - 1 && stage <= c.stageMax + 1)));
  const rank = (c: C) => (c.kind === 'self-study' ? 2 : c.regions.includes('*') ? 1 : 0);
  return all.filter(fits).sort((a, b) => rank(a) - rank(b));
}
