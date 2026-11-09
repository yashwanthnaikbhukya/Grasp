import { z } from 'zod';

/**
 * The normalized education stage ladder.
 *
 * `stage` is an integer anchored on **nominal years of schooling completed**,
 * which aligns with the US grade number. Local labels are presentation only.
 *
 *   stage 10  →  Class 10 (IN) · Grade 10 (US) · Year 11 (GB) · MYP 5 (IB)
 *
 * Past school the count keeps going (ADR 0008): 13–16 are the years of a first
 * degree or diploma, 17 a master's, 18 a doctorate. Advisory like every stage —
 * a 3-year degree, a gap year or a career change all land "wrong" by a year,
 * and that is fine.
 *
 * The rule that prevents the whole category of bug this replaced:
 * **never store a local label in a field, and never name a field `grade`.**
 * `stage` is the number; `stageLabel(stage, region)` is the string.
 *
 * See docs/adr/0006-curriculum-agnostic-concepts.md.
 */

export const Stage = z.number().int().min(0).max(18);
export type Stage = z.infer<typeof Stage>;

export const STAGE_MIN = 0;
export const STAGE_MAX = 18;
/** The last school stage; above it is college and university. */
export const LAST_SCHOOL_STAGE = 12;

/** ISO 3166-1 alpha-2, or 'XX' when the learner declines to say. */
export const Region = z.string().length(2).toUpperCase();
export type Region = z.infer<typeof Region>;

/**
 * Typical age at the *start* of a stage. The reliable anchor: it works for a
 * learner in school, one repeating a year, and an adult outside any ladder.
 */
export function typicalAgeForStage(stage: Stage): { min: number; max: number } {
  if (stage <= 0) return { min: 4, max: 6 };
  if (stage >= 18) return { min: 24, max: 99 };
  if (stage === 17) return { min: 22, max: 99 };
  return { min: stage + 5, max: stage + 6 };
}

/** Inverse, for the "not in formal education" branch where stage is unknown. */
export function stageFromAge(age: number): Stage {
  if (age < 6) return 0;
  if (age >= 18) return 13;
  return Math.max(1, Math.min(12, age - 5));
}

// ---------------------------------------------------------------------------
// Local labels
// ---------------------------------------------------------------------------

type Labeller = (stage: Stage) => string;

/** UK-style: Year N begins a year earlier than US Grade N. Year 11 ≈ Grade 10. */
const ukYear: Labeller = (s) => `Year ${s + 1}`;

/**
 * College and university, by region. US/Canada name the years; South Asia says
 * "college" for the undergraduate years; most of the world says "university".
 */
const usCollege = ['College freshman', 'College sophomore', 'College junior', 'College senior'];
function tertiaryLabel(stage: Stage, region?: string): string {
  if (stage >= 18) return 'Doctorate (PhD)';
  if (stage === 17) return "Master's";
  const year = stage - 12;
  const r = region?.toUpperCase() ?? '';
  if (r === 'US' || r === 'CA') return usCollege[year - 1] ?? `College year ${year}`;
  if (['IN', 'PK', 'BD', 'NP', 'LK'].includes(r)) return `College year ${year} (UG)`;
  return `University year ${year}`;
}

/** AU/NZ-style: Year N aligns with US Grade N. */
const plainYear: Labeller = (s) => `Year ${s}`;

const grade: Labeller = (s) => `Grade ${s}`;
const klass: Labeller = (s) => `Class ${s}`;

/** Split ladders: one label below the boundary, another above. */
function split(
  boundary: Stage,
  lower: (s: Stage) => string,
  upper: (s: Stage) => string,
): Labeller {
  return (s) => (s <= boundary ? lower(s) : upper(s));
}

/**
 * Region → labeller. Deliberately covers the largest student populations rather
 * than every country; anything absent falls back to `Grade N`, which is
 * understood widely enough to be a safe default.
 *
 * This is data, not logic — extending it is adding a row.
 */
const LABELLERS: Record<string, Labeller> = {
  // South Asia — "Class N"
  IN: klass,
  PK: klass,
  BD: klass,
  NP: klass,
  LK: klass,

  // US-style — "Grade N"
  US: grade,
  CA: grade,
  PH: grade,
  ZA: grade,
  KE: grade,
  EG: grade,
  AE: grade,
  SA: grade,
  QA: grade,
  KW: grade,
  OM: grade,
  TR: grade,
  CN: grade,
  TW: grade,
  SL: grade,
  GM: grade,
  LR: grade,

  // UK-style — "Year N+1"
  GB: ukYear,
  IE: ukYear,
  HK: ukYear,

  // AU/NZ-style — "Year N"
  AU: plainYear,
  NZ: plainYear,

  // Singapore / Malaysia — Primary then Secondary, renumbered
  SG: split(6, (s) => `Primary ${s}`, (s) => `Secondary ${s - 6}`),
  MY: split(6, (s) => `Standard ${s}`, (s) => `Form ${s - 6}`),

  // Nigeria / Ghana — Primary, Junior Secondary, Senior Secondary
  NG: (s) => (s <= 6 ? `Primary ${s}` : s <= 9 ? `JSS ${s - 6}` : `SSS ${s - 9}`),
  GH: (s) => (s <= 6 ? `Primary ${s}` : s <= 9 ? `JHS ${s - 6}` : `SHS ${s - 9}`),

  // Indonesia — SD / SMP / SMA, all labelled "Kelas N"
  ID: klass,

  // Brazil — Ensino Fundamental then Ensino Médio
  BR: split(9, (s) => `${s}º ano (EF)`, (s) => `${s - 9}º ano (EM)`),

  // Spanish-speaking LatAm — Primaria / Secundaria / Bachillerato
  MX: (s) =>
    s <= 6 ? `Primaria ${s}` : s <= 9 ? `Secundaria ${s - 6}` : `Bachillerato ${s - 9}`,
  CO: (s) => `Grado ${s}`,
  AR: (s) => `${s}º año`,

  // Spain — Primaria, then ESO (4 years), then Bachillerato (2)
  ES: (s) => (s <= 6 ? `${s}º Primaria` : s <= 10 ? `${s - 6}º ESO` : `${s - 10}º Bachillerato`),

  // Korea — elementary / middle / high, each renumbered
  KR: (s) => (s <= 6 ? `초등학교 ${s}학년` : s <= 9 ? `중학교 ${s - 6}학년` : `고등학교 ${s - 9}학년`),

  // Vietnam
  VN: (s) => `Lớp ${s}`,

  // Germany
  DE: (s) => `Klasse ${s}`,

  // Japan — elementary / junior high / high school, each renumbered
  JP: (s) => (s <= 6 ? `小学${s}年` : s <= 9 ? `中学${s - 6}年` : `高校${s - 9}年`),

  // France — the ladder counts down, then is named
  FR: (s) => {
    const named: Record<number, string> = {
      6: 'Sixième',
      7: 'Cinquième',
      8: 'Quatrième',
      9: 'Troisième',
      10: 'Seconde',
      11: 'Première',
      12: 'Terminale',
    };
    return named[s] ?? `CM/CP ${s}`;
  },
};

export function stageLabel(stage: Stage, region?: string): string {
  if (stage <= 0) return 'Pre-primary';
  if (stage > LAST_SCHOOL_STAGE) return tertiaryLabel(stage, region);

  const labeller = region ? LABELLERS[region.toUpperCase()] : undefined;
  return (labeller ?? grade)(stage);
}

export type StageBand = 'school' | 'university';

/** Every option the stage picker should show for a region, in ladder order. */
export function stageOptions(
  region?: string,
): { stage: Stage; label: string; age: string; band: StageBand }[] {
  const out: { stage: Stage; label: string; age: string; band: StageBand }[] = [];
  for (let s = 1; s <= STAGE_MAX; s++) {
    const { min, max } = typicalAgeForStage(s);
    out.push({
      stage: s,
      label: stageLabel(s, region),
      age: max >= 99 ? `${min}+` : `${min}–${max}`,
      band: s > LAST_SCHOOL_STAGE ? 'university' : 'school',
    });
  }
  return out;
}

/** Regions with a hand-checked ladder. Others still work via the `Grade N` default. */
export function supportedRegions(): string[] {
  return Object.keys(LABELLERS).sort();
}

/** Advisory band on a concept or content atom — never a hard gate. */
export const StageRange = z
  .object({ min: Stage, max: Stage })
  .refine((r) => r.min <= r.max, { message: 'stageRange.min must be <= max' });
export type StageRange = z.infer<typeof StageRange>;

/**
 * Whether content is a reasonable fit for a learner's stage.
 *
 * Tolerant by one stage in each direction on purpose: curricula disagree by a
 * year all the time, and a learner reaching ahead is the best signal they can
 * send. Used to rank and to caveat — never to refuse.
 */
export function stageFits(range: StageRange | null | undefined, learnerStage: Stage): boolean {
  if (!range) return true;
  return learnerStage >= range.min - 1 && learnerStage <= range.max + 1;
}
