import { describe, expect, it } from 'vitest';
import type { CardSolve, GeneratedCard } from '@grasp/schema';
import {
  answersAgree,
  expectedAnswer,
  judge,
  numericallyEqual,
  parseNumeric,
  structuralFaults,
} from './verify';

/**
 * Verification decides what reaches a learner. Failure is asymmetric: too strict
 * quarantines a good question (visible, harmless), too loose ships a broken one
 * (invisible, and it costs trust the first time someone hits it). These tests
 * lean on the loose direction.
 */

function card(over: Partial<GeneratedCard> = {}): GeneratedCard {
  return {
    type: 'mcq',
    stem: 'What is $\\sin 30°$?',
    options: [
      { id: 'a', text: '1/2', isCorrect: true },
      { id: 'b', text: '√3/2', isCorrect: false },
      { id: 'c', text: '1', isCorrect: false },
    ],
    answer: 'a',
    solution: 'From the 30-60-90 triangle, the opposite side is half the hypotenuse.',
    difficultyGuess: 0,
    conceptIds: ['trig-ratios'],
    ...over,
  };
}

const solve = (over: Partial<CardSolve> = {}): CardSolve => ({
  answer: 'a',
  reasoning: 'half the hypotenuse',
  flaw: 'none',
  ...over,
});

describe('parseNumeric', () => {
  it('reads plain numbers', () => {
    expect(parseNumeric(0.5)).toBe(0.5);
    expect(parseNumeric('0.5')).toBe(0.5);
    expect(parseNumeric('-3')).toBe(-3);
  });

  it('reads fractions in both notations', () => {
    expect(parseNumeric('1/2')).toBe(0.5);
    expect(parseNumeric('\\frac{1}{2}')).toBe(0.5);
    expect(parseNumeric('\\dfrac{3}{4}')).toBe(0.75);
  });

  it('reads percentages', () => {
    expect(parseNumeric('50%')).toBe(0.5);
  });

  it('reads square roots with and without a coefficient', () => {
    expect(parseNumeric('\\sqrt{2}')).toBeCloseTo(Math.SQRT2, 6);
    expect(parseNumeric('sqrt(9)')).toBeCloseTo(3, 6);
    expect(parseNumeric('2\\sqrt{3}')).toBeCloseTo(2 * Math.sqrt(3), 6);
  });

  it('strips LaTeX wrapping and thousands separators', () => {
    expect(parseNumeric('$1,250$')).toBe(1250);
  });

  it('returns null rather than NaN for things that are not numbers', () => {
    // null is checkable; NaN silently poisons every comparison downstream.
    for (const v of ['', 'the hypotenuse', '1/0', null, undefined, {}]) {
      expect(parseNumeric(v), String(v)).toBeNull();
    }
  });
});

describe('numericallyEqual', () => {
  it('treats the same value written differently as equal', () => {
    expect(numericallyEqual('1/2', 0.5)).toBe(true);
    expect(numericallyEqual('50%', '0.5')).toBe(true);
    expect(numericallyEqual('\\sqrt{4}', 2)).toBe(true);
  });

  it('tolerates rounding', () => {
    expect(numericallyEqual('0.333', '1/3')).toBe(true);
  });

  it('scales tolerance rather than using a fixed epsilon', () => {
    // 1000 and 1001 must not agree just because large numbers are involved.
    expect(numericallyEqual(1000, 1001)).toBe(false);
    expect(numericallyEqual(0.001, 0.002)).toBe(false);
  });

  it('accepts a rounded irrational', () => {
    // 20√3 = 34.641…, and a student writing 34.6 has the right answer.
    expect(numericallyEqual(34.6, 34.641)).toBe(true);
    expect(numericallyEqual('20.78', '12\\sqrt{3}')).toBe(true);
  });

  it('is false when either side is unparseable', () => {
    expect(numericallyEqual('about half', 0.5)).toBe(false);
  });
});

describe('answersAgree', () => {
  it('matches option ids case- and format-insensitively', () => {
    expect(answersAgree('mcq', 'A', 'a')).toBe(true);
    expect(answersAgree('mcq', ' b ', 'b')).toBe(true);
  });

  it('does not match different options', () => {
    expect(answersAgree('mcq', 'a', 'b')).toBe(false);
  });

  it('ignores order for multi-select but not for ordered steps', () => {
    // The selection is the answer in one; the sequence is the answer in the other.
    expect(answersAgree('multi', ['a', 'b'], ['b', 'a'])).toBe(true);
    expect(answersAgree('orderSteps', ['a', 'b'], ['b', 'a'])).toBe(false);
    expect(answersAgree('orderSteps', ['a', 'b'], ['a', 'b'])).toBe(true);
  });

  it('parses a comma-separated string as a list', () => {
    expect(answersAgree('multi', 'a, b', ['b', 'a'])).toBe(true);
  });

  it('uses numeric equivalence for numeric questions', () => {
    expect(answersAgree('numeric', '1/2', 0.5)).toBe(true);
    expect(answersAgree('numeric', '0.5', '0.6')).toBe(false);
  });

  it('is false when either answer is missing', () => {
    expect(answersAgree('mcq', undefined, 'a')).toBe(false);
    expect(answersAgree('mcq', 'a', null)).toBe(false);
  });

  it('does not let short strings match by containment', () => {
    // 'a' inside 'answer' must not count as agreement.
    expect(answersAgree('mcq', 'a', 'answer is a')).toBe(false);
  });
});

describe('structuralFaults', () => {
  it('passes a well-formed card', () => {
    expect(structuralFaults(card())).toEqual([]);
  });

  it('catches an MCQ with two keyed options', () => {
    const bad = card({
      options: [
        { id: 'a', text: '1/2', isCorrect: true },
        { id: 'b', text: '0.5', isCorrect: true },
        { id: 'c', text: '1', isCorrect: false },
      ],
    });
    expect(structuralFaults(bad).join(' ')).toMatch(/2 correct/);
  });

  it('catches an MCQ with no keyed option', () => {
    const bad = card({ options: card().options?.map((o) => ({ ...o, isCorrect: false })) });
    expect(structuralFaults(bad).length).toBeGreaterThan(0);
  });

  it('catches too few options', () => {
    const bad = card({ options: [{ id: 'a', text: 'x', isCorrect: true }] });
    expect(structuralFaults(bad).join(' ')).toMatch(/three options/);
  });

  it('catches duplicate and blank options', () => {
    expect(
      structuralFaults(
        card({
          options: [
            { id: 'a', text: '1/2', isCorrect: true },
            { id: 'b', text: '1/2', isCorrect: false },
            { id: 'c', text: '1', isCorrect: false },
          ],
        }),
      ).join(' '),
    ).toMatch(/duplicate/);

    expect(
      structuralFaults(
        card({
          options: [
            { id: 'a', text: '1/2', isCorrect: true },
            { id: 'b', text: '  ', isCorrect: false },
            { id: 'c', text: '1', isCorrect: false },
          ],
        }),
      ).join(' '),
    ).toMatch(/blank option/);
  });

  it('rejects a card that leans on a passage the learner never sees', () => {
    const stem = 'According to the passage, why are the ratios invariant?';
    expect(structuralFaults(card({ stem })).join(' ')).toMatch(/never sees/);
    const solution = 'The passage states that similar triangles have proportional sides.';
    expect(structuralFaults(card({ solution })).join(' ')).toMatch(/passage/);
  });

  it('rejects a card that leans on a figure or worked example the learner never sees', () => {
    for (const stem of [
      'In the worked example, how is the denominator transformed?',
      'In the right triangle shown, which side is longest?',
      'In the figure, what is angle B?',
    ]) {
      expect(structuralFaults(card({ stem })).join(' ')).toMatch(/never sees/);
    }
  });

  it('does not mistake ordinary wording for a passage reference', () => {
    const stem =
      'A text message costs 5p. The given triangle has sides 3, 4, 5. Sketch the graph of y = x^2, for example at x = 2.';
    expect(structuralFaults(card({ stem }))).toEqual([]);
  });

  it('catches a numeric question with no parseable answer', () => {
    const bad = card({ type: 'numeric', options: undefined, answer: 'roughly a half' });
    expect(structuralFaults(bad).join(' ')).toMatch(/no parseable answer/);
  });

  it('requires a worked solution', () => {
    expect(structuralFaults(card({ solution: '' })).join(' ')).toMatch(/worked solution/);
  });

  it('needs no model call', () => {
    // Deterministic, so it runs before any tokens are spent on solving.
    expect(structuralFaults(card())).toEqual(structuralFaults(card()));
  });
});

describe('judge', () => {
  it('verifies when two independent solves match each other and the key', () => {
    const outcome = judge(card(), [solve(), solve()]);
    expect(outcome.status).toBe('verified');
    expect(outcome.agreement).toBe(true);
  });

  it('rejects outright when a solver reports a structural flaw', () => {
    // No amount of human review saves an ambiguous item — it is broken.
    const outcome = judge(card(), [solve(), solve({ flaw: 'multiple-correct' })]);
    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toMatch(/multiple-correct/);
  });

  it('rejects on an unanswerable item even if the other solver was happy', () => {
    expect(judge(card(), [solve(), solve({ flaw: 'unanswerable' })]).status).toBe('rejected');
  });

  it('quarantines when the two solvers disagree with each other', () => {
    const outcome = judge(card(), [solve({ answer: 'a' }), solve({ answer: 'b' })]);
    expect(outcome.status).toBe('quarantined');
    expect(outcome.reason).toMatch(/disagreed/);
  });

  it('quarantines when both solvers agree but contradict the stated key', () => {
    // The interesting case: the question may be fine and the *key* wrong.
    const outcome = judge(card(), [solve({ answer: 'b' }), solve({ answer: 'b' })]);
    expect(outcome.status).toBe('quarantined');
    expect(outcome.reason).toMatch(/not with the stated answer/);
  });

  it('never verifies on a single solve', () => {
    // One solve is not independent corroboration.
    expect(judge(card(), [solve()]).status).toBe('quarantined');
    expect(judge(card(), []).status).toBe('quarantined');
  });

  it('verifies a numeric card whose solvers wrote the answer differently', () => {
    const numeric = card({ type: 'numeric', options: undefined, answer: '1/2' });
    const outcome = judge(numeric, [solve({ answer: 0.5 }), solve({ answer: '50%' })]);
    expect(outcome.status).toBe('verified');
  });
});

describe('expectedAnswer', () => {
  it('reads the keyed option for a multiple choice', () => {
    expect(expectedAnswer(card())).toBe('a');
  });

  it('reads every keyed option for multi-select', () => {
    const multi = card({
      type: 'multi',
      options: [
        { id: 'a', text: 'x', isCorrect: true },
        { id: 'b', text: 'y', isCorrect: true },
        { id: 'c', text: 'z', isCorrect: false },
      ],
    });
    expect(expectedAnswer(multi)).toEqual(['a', 'b']);
  });

  it('falls back to the answer field when there are no options', () => {
    expect(expectedAnswer(card({ type: 'numeric', options: undefined, answer: 42 }))).toBe(42);
  });
});
