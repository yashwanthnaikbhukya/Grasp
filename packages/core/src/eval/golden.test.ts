import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CardSolveExpectSchema,
  QueryUnderstandExpectSchema,
  SlipExpectSchema,
  TutorExpectSchema,
} from '@grasp/schema';
import { describe, expect, it } from 'vitest';
import { MIN_CASES_FOR_PROMPT_BUMP } from './baseline';
import { EVAL_TASKS, loadGoldenSet } from './run';

/**
 * The golden sets themselves, checked without a single model call: every line
 * parses, every `expect` matches its task's schema, ids are unique, and every
 * task meets the 10-case floor that allows its prompt to be bumped.
 */

const goldenDir = join(fileURLToPath(new URL('.', import.meta.url)), 'golden');

const EXPECT = {
  'query.understand': QueryUnderstandExpectSchema,
  'slip.classify': SlipExpectSchema,
  'card.solve': CardSolveExpectSchema,
  'tutor.answer': TutorExpectSchema,
  'tutor.teach': TutorExpectSchema,
  'tutor.coach': TutorExpectSchema,
} as const;

describe.each(EVAL_TASKS)('golden set: %s', (task) => {
  const cases = loadGoldenSet(goldenDir, task);

  it(`has at least ${MIN_CASES_FOR_PROMPT_BUMP} cases`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES_FOR_PROMPT_BUMP);
  });

  it('has unique ids', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every expectation matches the task schema', () => {
    for (const c of cases) {
      const r = EXPECT[task].safeParse(c.expect);
      expect(r.success, `${c.id}: ${r.success ? '' : r.error.message}`).toBe(true);
    }
  });
});
