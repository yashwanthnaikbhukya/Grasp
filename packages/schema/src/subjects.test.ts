import { describe, expect, it } from 'vitest';
import { SUBJECTS, SubjectId, customSubjectId, subjectFitsStage, subjectInfo, subjectName } from './subjects';

describe('subject catalogue', () => {
  it('has unique, well-formed ids', () => {
    const ids = SUBJECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(SubjectId.safeParse(id).success, id).toBe(true);
  });

  it('keeps the id existing learners and content already use', () => {
    expect(subjectInfo('mathematics')?.name).toBe('Mathematics');
  });

  it('spans school to university', () => {
    expect(SUBJECTS.some((s) => s.stage.min <= 3)).toBe(true);
    expect(SUBJECTS.filter((s) => s.stage.min >= 13).length).toBeGreaterThan(10);
  });

  it('names custom subjects and turns typed text into a stable id', () => {
    expect(subjectName('marine-biology')).toBe('Marine Biology');
    expect(customSubjectId('  Marine Biology! ')).toBe('marine-biology');
    expect(customSubjectId('Física')).toBe('fisica');
    expect(customSubjectId('Accounting')).toBe('accountancy');
    expect(customSubjectId('?')).toBeNull();
  });

  it('fits subjects to a stage loosely, and fits everything without one', () => {
    const calculus = subjectInfo('calculus');
    if (!calculus) throw new Error('calculus missing');
    expect(subjectFitsStage(calculus, 4)).toBe(false);
    expect(subjectFitsStage(calculus, 12)).toBe(true);
    expect(subjectFitsStage(calculus, null)).toBe(true);
  });
});
