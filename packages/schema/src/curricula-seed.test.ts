import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CurriculumSeedSchema, SELF_STUDY_CURRICULUM_ID, curriculumCandidates } from './curriculum';
import { LAST_SCHOOL_STAGE, STAGE_MAX, supportedRegions } from './stage';
import { SUBJECTS, subjectInfo } from './subjects';

/**
 * The programme catalogue (data/curricula.seed.json) is data a learner meets at
 * onboarding — so it is held to the same bar as code. ADR 0008.
 */
const seed = CurriculumSeedSchema.parse(
  JSON.parse(readFileSync(new URL('../../../data/curricula.seed.json', import.meta.url), 'utf8')),
);
const candidates = seed.curricula.map((c) => ({
  id: c._id,
  regions: c.regions,
  stageMin: c.stageRange.min,
  stageMax: c.stageRange.max,
  kind: c.kind,
}));

describe('programme catalogue', () => {
  it('only offers subjects from the catalogue, each once', () => {
    for (const c of seed.curricula) {
      const unknown = c.subjects.filter((s) => !subjectInfo(s));
      expect(unknown, `${c._id} lists unknown subjects`).toEqual([]);
      expect(new Set(c.subjects).size, `${c._id} repeats a subject`).toBe(c.subjects.length);
    }
  });

  it('keeps self-study as the always-there fallback', () => {
    const self = seed.curricula.find((c) => c._id === SELF_STUDY_CURRICULUM_ID);
    expect(self?.kind).toBe('self-study');
    expect(self?.stageRange).toEqual({ min: 1, max: STAGE_MAX });
  });

  it('gives every hand-checked region a real programme at every school stage', () => {
    for (const region of supportedRegions()) {
      for (let stage = 1; stage <= LAST_SCHOOL_STAGE; stage++) {
        const real = curriculumCandidates(candidates, region, stage).filter((c) => c.kind !== 'self-study');
        expect(real.length, `${region} stage ${stage}`).toBeGreaterThan(0);
      }
    }
  });

  it('has something past school, everywhere: university coursework and exams', () => {
    for (const region of ['IN', 'US', 'GB', 'NG', 'BR', 'XX']) {
      for (let stage = LAST_SCHOOL_STAGE + 1; stage <= STAGE_MAX; stage++) {
        const kinds = new Set(curriculumCandidates(candidates, region, stage).map((c) => c.kind));
        expect(kinds.has('university'), `${region} stage ${stage}`).toBe(true);
      }
    }
  });

  it("lists the region's own programmes before international ones, self-study last", () => {
    const list = curriculumCandidates(candidates, 'IN', 10);
    const firstIntl = list.findIndex((c) => c.regions.includes('*') && c.kind !== 'self-study');
    const lastIndian = list.map((c) => c.regions.includes('IN')).lastIndexOf(true);
    expect(lastIndian).toBeLessThan(firstIntl);
    expect(list.at(-1)?.id).toBe(SELF_STUDY_CURRICULUM_ID);
  });

  it('covers every subject group somewhere', () => {
    const offered = new Set(seed.curricula.flatMap((c) => c.subjects));
    const groups = new Set(SUBJECTS.filter((s) => offered.has(s.id)).map((s) => s.group));
    expect([...groups].sort()).toEqual([...new Set(SUBJECTS.map((s) => s.group))].sort());
  });
});
