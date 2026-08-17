import type { CardSolve, GeneratedCard, QuestionType } from '@grasp/schema';

/**
 * Answer comparison for the verification pipeline.
 *
 * Pure and separately tested, because getting this wrong fails in the worst
 * direction: a comparison that is too strict quarantines good questions (visible,
 * annoying, harmless) while one that is too loose marks a broken question
 * `verified` and ships it to a learner (invisible, and it destroys trust the
 * first time they hit one).
 *
 * So: strict by default, with only the equivalences that are genuinely the same
 * answer written differently.
 */

/** `1/2`, `0.5`, `50%` and `2⁻¹` are one answer. Handled without a CAS. */
export function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const raw = value
    .trim()
    .replace(/\s+/g, '')
    .replace(/^\$|\$$/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/,/g, '');

  if (!raw) return null;

  // Percentage.
  const pct = /^(-?\d*\.?\d+)%$/.exec(raw);
  if (pct?.[1]) return Number(pct[1]) / 100;

  // LaTeX fractions, plain fractions.
  const frac =
    /^\\[dt]?frac\{(-?[\d.]+)\}\{(-?[\d.]+)\}$/.exec(raw) ?? /^(-?[\d.]+)\/(-?[\d.]+)$/.exec(raw);
  if (frac?.[1] && frac[2]) {
    const denominator = Number(frac[2]);
    return denominator === 0 ? null : Number(frac[1]) / denominator;
  }

  // Square roots, with or without a coefficient: 2\sqrt{3}, sqrt(2), √2
  const root = /^(-?[\d.]*)(?:\\sqrt\{([\d.]+)\}|sqrt\(([\d.]+)\)|√([\d.]+))$/.exec(raw);
  if (root) {
    const coefficient = root[1] === '' || root[1] === undefined ? 1 : root[1] === '-' ? -1 : Number(root[1]);
    const radicand = Number(root[2] ?? root[3] ?? root[4]);
    if (Number.isFinite(coefficient) && Number.isFinite(radicand)) {
      return coefficient * Math.sqrt(radicand);
    }
  }

  const plain = Number(raw);
  return Number.isFinite(plain) ? plain : null;
}

/**
 * Numeric agreement.
 *
 * Two regimes, because "close enough" means different things:
 *
 *   Integers are exact. A count, a number of solutions, an angle in degrees —
 *   1000 and 1001 are different answers, and any relative tolerance wide enough
 *   to accept a rounded irrational would wrongly accept them.
 *
 *   Everything else gets a relative tolerance, so a student writing 34.6 for
 *   $20\sqrt{3}$ agrees with 34.641. Relative rather than absolute, so the same
 *   rule works at 0.001 and at 10,000.
 */
export function numericallyEqual(a: unknown, b: unknown, tolerance = 0.005): boolean {
  const x = parseNumeric(a);
  const y = parseNumeric(b);
  if (x === null || y === null) return false;
  if (x === y) return true;

  const bothIntegral = Number.isInteger(x) && Number.isInteger(y);
  if (bothIntegral) return false;

  // Scale by the actual magnitude, with no floor. Flooring at 1 would make
  // small numbers compare *absolutely* — 0.001 and 0.002 differ by 100% and
  // must not agree, even though they are 0.001 apart.
  const scale = Math.max(Math.abs(x), Math.abs(y));
  if (scale === 0) return true;
  return Math.abs(x - y) / scale <= tolerance;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\$/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => normalizeText(v));
  if (typeof value === 'string') {
    return value
      .split(/[,;]/)
      .map((s) => normalizeText(s))
      .filter(Boolean);
  }
  return [];
}

/**
 * Do two answers to the same question agree?
 *
 * Comparison depends on the type, because "the same answer" means different
 * things: order matters for `orderSteps` and must not for `multi`.
 */
export function answersAgree(type: QuestionType, a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;

  switch (type) {
    case 'numeric':
      return numericallyEqual(a, b);

    case 'multi': {
      // Set equality — the selection is the answer, its order is not.
      const left = [...new Set(asList(a))].sort();
      const right = [...new Set(asList(b))].sort();
      return left.length > 0 && left.length === right.length && left.every((v, i) => v === right[i]);
    }

    case 'orderSteps': {
      // Sequence equality — here the order *is* the answer.
      const left = asList(a);
      const right = asList(b);
      return left.length > 0 && left.length === right.length && left.every((v, i) => v === right[i]);
    }

    case 'mcq':
    case 'tapError':
    case 'label':
    default: {
      const left = normalizeText(a);
      const right = normalizeText(b);
      if (!left || !right) return false;
      if (left === right) return true;
      // A solver may answer with the option's text where the key is its id, or
      // the reverse. Containment in either direction covers that without
      // matching genuinely different answers.
      return left.length > 2 && right.length > 2 && (left.includes(right) || right.includes(left));
    }
  }
}

export type Verdict = 'verified' | 'quarantined' | 'rejected';

export interface VerificationOutcome {
  status: Verdict;
  agreement: boolean;
  reason: string;
}

/**
 * Decide a question's fate from two independent solves.
 *
 * Three outcomes, and the split matters:
 *   verified     both solvers agree with each other AND with the author's key
 *   rejected     a solver found a structural flaw — ambiguous, multiple-correct.
 *                No amount of human review saves these; the item is broken.
 *   quarantined  solvable but disputed. Worth a human glance, not worth binning.
 *
 * The bar is deliberately high. A false quarantine costs one question out of
 * many; a false `verified` reaches a learner.
 */
export function judge(card: GeneratedCard, solves: readonly CardSolve[]): VerificationOutcome {
  if (solves.length < 2) {
    return { status: 'quarantined', agreement: false, reason: 'fewer than two independent solves' };
  }

  const flaws = solves.filter((s) => s.flaw !== 'none');
  if (flaws.length > 0) {
    const kinds = [...new Set(flaws.map((f) => f.flaw))].join(', ');
    // Structural defects are not a disagreement to adjudicate — the item is bad.
    return { status: 'rejected', agreement: false, reason: `solver reported ${kinds}` };
  }

  const [first, second] = solves;
  if (!first || !second) {
    return { status: 'quarantined', agreement: false, reason: 'missing solve' };
  }

  const solversAgree = answersAgree(card.type, first.answer, second.answer);
  if (!solversAgree) {
    return {
      status: 'quarantined',
      agreement: false,
      reason: 'independent solvers disagreed with each other',
    };
  }

  const matchesKey = answersAgree(card.type, first.answer, expectedAnswer(card));
  if (!matchesKey) {
    return {
      status: 'quarantined',
      agreement: true,
      reason: 'solvers agreed with each other but not with the stated answer',
    };
  }

  return { status: 'verified', agreement: true, reason: 'two independent solves matched the key' };
}

/** The author's intended answer, however the card expressed it. */
export function expectedAnswer(card: GeneratedCard): unknown {
  if (card.options && card.options.length > 0) {
    const correct = card.options.filter((o) => o.isCorrect);
    if (correct.length === 0) return card.answer;
    return card.type === 'multi' ? correct.map((o) => o.id) : correct[0]?.id;
  }
  return card.answer;
}

/**
 * Structural checks that need no model call.
 *
 * Cheap, deterministic, and they catch the defects a solver might talk itself
 * past — an MCQ with two keyed options, a numeric question with no number.
 * Run before spending tokens on solving.
 */
export function structuralFaults(card: GeneratedCard): string[] {
  const faults: string[] = [];
  const options = card.options ?? [];
  const keyed = options.filter((o) => o.isCorrect);

  if (card.type === 'mcq') {
    if (options.length < 3) faults.push('multiple choice needs at least three options');
    if (keyed.length !== 1) faults.push(`multiple choice has ${keyed.length} correct options`);
  }
  if (card.type === 'multi' && keyed.length < 2) {
    faults.push('multi-select needs at least two correct options');
  }
  if (card.type === 'numeric' && parseNumeric(card.answer) === null) {
    faults.push('numeric question has no parseable answer');
  }

  const texts = options.map((o) => normalizeText(o.text));
  if (new Set(texts).size !== texts.length) faults.push('duplicate options');
  if (options.some((o) => !o.text.trim())) faults.push('blank option');
  if (!card.stem.trim()) faults.push('blank stem');
  if (!card.solution.trim()) faults.push('no worked solution');

  return faults;
}
