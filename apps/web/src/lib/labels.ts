import { subjectName, type LearnerProfile } from '@grasp/schema';

/**
 * Learner-facing words for stored codes. A learner screen never shows `IN`,
 * `coursework` or `en` (docs/11-experience.md — Principles §2).
 */

const display = (type: 'region' | 'language', code: string): string => {
  try {
    return new Intl.DisplayNames(['en'], { type }).of(code) ?? code;
  } catch {
    return code;
  }
};

export const regionName = (code: string | null | undefined): string =>
  code ? display('region', code) : 'Not set';

export const languageName = (code: string | null | undefined): string =>
  code ? display('language', code) : 'Not set';

const GOALS: Record<LearnerProfile['goal']['kind'], string> = {
  exam: 'An exam coming up',
  coursework: 'Keeping up with my classes',
  'self-study': 'Learning on my own',
  competition: 'A competition or olympiad',
  career: 'Skills for work or a career',
};

export const goalLabel = (goal: LearnerProfile['goal']): string =>
  goal.label || GOALS[goal.kind] || 'Learning';

/** "Data Structures & Algorithms", not "data-structures-algorithms"; custom subjects as typed. */
export const subjectLabel = (s: string): string => subjectName(s);

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ', '-': '⁻',
};

/**
 * A model-authored concept name as a learner reads it: sentence case, and
 * plain-text powers set as superscripts — "the identity sin^2 + cos^2 = 1"
 * showed on the Map with its carets (2026-11-09). Display only: the stored name
 * and id never change (rule 13). Every screen that shows a concept uses this.
 */
export function conceptLabel(name: string): string {
  const s = name
    .trim()
    .replace(/\^\{?(-?[0-9n]+)\}?/g, (_, p: string) => [...p].map((c) => SUPERSCRIPT[c] ?? c).join(''));
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Up to two initials for the avatar. */
export const initials = (name: string, email: string): string => {
  const words = (name || email.split('@')[0] || '?').trim().split(/\s+/);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
};
