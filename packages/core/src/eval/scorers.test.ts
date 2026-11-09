import { describe, expect, it } from 'vitest';
import { compareToBaseline, toBaseline, type TaskResult } from './baseline';
import {
  alignScores,
  countQuestions,
  endsWithQuestion,
  scoreCardSolve,
  scoreQueryUnderstand,
  scoreRubric,
  scoreSlip,
  scoreTutorChecks,
} from './scorers';

const qu = (over: Partial<Parameters<typeof scoreQueryUnderstand>[0]> = {}) => ({
  rewritten: 'Explain why sin squared plus cos squared equals 1',
  conceptIds: ['pythagorean-identity'],
  intent: 'explain' as const,
  needsClarification: false,
  ...over,
});
const quExpect = (over = {}) => ({
  conceptsInclude: [],
  conceptsAnyOf: [],
  conceptsExclude: [],
  rewriteMentions: [],
  ...over,
});

describe('scoreQueryUnderstand', () => {
  it('passes when intent, tags and rewrite all match', () => {
    const s = scoreQueryUnderstand(
      qu(),
      quExpect({ intent: ['explain'], conceptsInclude: ['pythagorean-identity'], rewriteMentions: [['sin'], ['cos', 'cosine']] }),
    );
    expect(s).toEqual({ pass: true, failures: [] });
  });

  it('names every failed check', () => {
    const s = scoreQueryUnderstand(
      qu({ intent: 'quiz', conceptIds: ['trig-ratios'] }),
      quExpect({ intent: ['explain'], conceptsAnyOf: ['pythagorean-identity'], conceptsExclude: ['trig-ratios'], rewriteMentions: [['tangent']] }),
    );
    expect(s.pass).toBe(false);
    expect(s.failures).toHaveLength(4);
  });

  it('checks an empty tag list for chitchat', () => {
    expect(scoreQueryUnderstand(qu({ conceptIds: [] }), quExpect({ conceptsEmpty: true })).pass).toBe(true);
    expect(scoreQueryUnderstand(qu(), quExpect({ conceptsEmpty: true })).pass).toBe(false);
  });
});

describe('scoreSlip / scoreCardSolve', () => {
  it('accepts any listed root cause', () => {
    const out = { rootCause: 'misread-question' as const, confidence: 0.8, note: 'x' };
    expect(scoreSlip(out, { rootCause: ['misread-question', 'careless-arithmetic'] }).pass).toBe(true);
    expect(scoreSlip(out, { rootCause: ['misconception'] }).pass).toBe(false);
  });

  it('compares numeric answers by value and accepts a flaw as the answer', () => {
    expect(
      scoreCardSolve({ answer: '0.8', reasoning: '', flaw: 'none' }, { type: 'numeric', answer: '4/5', flaw: ['none'] }).pass,
    ).toBe(true);
    expect(
      scoreCardSolve({ answer: null, reasoning: '', flaw: 'multiple-correct' }, { type: 'mcq', flaw: ['multiple-correct'] }).pass,
    ).toBe(true);
    expect(
      scoreCardSolve({ answer: 'b', reasoning: '', flaw: 'none' }, { type: 'mcq', answer: 'c', flaw: ['none'] }).pass,
    ).toBe(false);
  });
});

describe('tutor checks', () => {
  it('counts questions in prose only — not inside maths or code', () => {
    expect(countQuestions('Why? Is $f(x)?$ defined? ```a?```')).toBe(2);
  });

  it('sees the final check question past citations and formatting', () => {
    expect(endsWithQuestion('So $\\sin 30° = 1/2$. **What is $\\cos 60°$?** [c2]')).toBe(true);
    expect(endsWithQuestion('That is the full proof.')).toBe(false);
    // Other models' marker styles and grouped markers are citations too.
    expect(endsWithQuestion('What is $\\cos 60°$? 【c2】')).toBe(true);
    expect(endsWithQuestion('What is $\\cos 60°$? [c2, c3]')).toBe(true);
  });

  it('flags a repeated question and too many questions', () => {
    const prior = 'which side is opposite the right angle';
    const s = scoreTutorChecks('In a right triangle, which side is opposite the right angle? And why?', {
      maxQuestions: 1,
      mustNotContain: [prior],
      mustMention: [],
      rubric: [],
    });
    expect(s.failures).toEqual(['2 questions, at most 1 allowed', `contains "${prior}"`]);
  });

  it('a MUST rubric item needs 0.75; others only lower the score', () => {
    const rubric = [
      { id: 'explains', must: true },
      { id: 'warm', must: false },
    ];
    expect(scoreRubric(rubric, { explains: 1, warm: 0 }).pass).toBe(true);
    expect(scoreRubric(rubric, { explains: 0.5, warm: 1 }).pass).toBe(false);
  });
});

describe('alignScores', () => {
  const rubric = [{ id: 'brief' }, { id: 'no-quiz' }];
  it('keeps exact ids', () => {
    expect(alignScores(rubric, { brief: 1, 'no-quiz': 0.5 })).toEqual({ brief: 1, 'no-quiz': 0.5 });
  });
  it('accepts the display form the judge sometimes echoes', () => {
    expect(alignScores(rubric, { 'brief (MUST)': 1, 'no-quiz (MUST)': 1 })).toEqual({ brief: 1, 'no-quiz': 1 });
  });
  it('falls back to position when the counts match', () => {
    expect(alignScores(rubric, { '1': 1, '2': 0 })).toEqual({ brief: 1, 'no-quiz': 0 });
  });
  it('leaves a criterion unscored rather than guessing when it cannot match', () => {
    expect(alignScores(rubric, { something: 1 })).toEqual({});
  });
});

describe('compareToBaseline', () => {
  const res = (task: string, prompt: string, cases: Record<string, boolean>): TaskResult => ({
    task,
    prompt,
    passed: Object.values(cases).filter(Boolean).length,
    total: Object.keys(cases).length,
    cases,
  });
  const base = toBaseline([res('t', 't@1', { a: true, b: true, c: true, d: false })], new Date(0));

  it('tolerates one flipped case and flags two', () => {
    expect(compareToBaseline([res('t', 't@1', { a: false, b: true, c: true, d: false })], base)).toEqual([]);
    const r = compareToBaseline([res('t', 't@1', { a: false, b: false, c: true, d: false })], base);
    expect(r[0]?.reason).toContain('lost: a, b');
  });

  it('adding cases is never a regression', () => {
    expect(
      compareToBaseline([res('t', 't@1', { a: true, b: true, c: true, d: false, e: false, f: false })], base),
    ).toEqual([]);
  });

  it('blocks a prompt bump on a task with fewer than 10 cases', () => {
    const r = compareToBaseline([res('t', 't@2', { a: true, b: true, c: true, d: false })], base);
    expect(r[0]?.reason).toMatch(/prompt changed t@1 → t@2 with only 4 golden cases/);
  });
});
