import { describe, expect, it } from 'vitest';
import {
  STAGE_MAX,
  stageFits,
  stageFromAge,
  stageLabel,
  stageOptions,
  supportedRegions,
  typicalAgeForStage,
} from './stage';

/**
 * The stage ladder is the piece that has to be right. "Class 10" is not a global
 * concept, and the bug class this replaced was storing a local label in a field
 * named `grade`. See docs/adr/0006-curriculum-agnostic-concepts.md.
 */
describe('stage ladder', () => {
  it('anchors the same age band across every naming system', () => {
    // Age 15–16 is the single most important alignment — it's the terminal
    // secondary exam year in a lot of the world, and the one people get wrong.
    expect(stageLabel(10, 'IN')).toBe('Class 10');
    expect(stageLabel(10, 'US')).toBe('Grade 10');
    expect(stageLabel(10, 'GB')).toBe('Year 11'); // NOT Year 10
    expect(stageLabel(10, 'AU')).toBe('Year 10'); // AU Year N == US Grade N
    expect(typicalAgeForStage(10)).toEqual({ min: 15, max: 16 });
  });

  it('does not confuse UK years with US grades', () => {
    // The classic off-by-one. UK Year N begins a year earlier than US Grade N.
    for (let s = 1; s <= 12; s++) {
      expect(stageLabel(s, 'GB')).toBe(`Year ${s + 1}`);
      expect(stageLabel(s, 'US')).toBe(`Grade ${s}`);
    }
  });

  it('renumbers split ladders at the right boundary', () => {
    expect(stageLabel(6, 'SG')).toBe('Primary 6');
    expect(stageLabel(7, 'SG')).toBe('Secondary 1');
    expect(stageLabel(9, 'NG')).toBe('JSS 3');
    expect(stageLabel(10, 'NG')).toBe('SSS 1');
    expect(stageLabel(9, 'BR')).toBe('9º ano (EF)');
    expect(stageLabel(10, 'BR')).toBe('1º ano (EM)');
    expect(stageLabel(9, 'JP')).toBe('中学3年');
    expect(stageLabel(10, 'JP')).toBe('高校1年');
  });

  it('renumbers the Spanish and Korean ladders at their school boundaries', () => {
    expect(stageLabel(7, 'ES')).toBe('1º ESO');
    expect(stageLabel(11, 'ES')).toBe('1º Bachillerato');
    expect(stageLabel(10, 'KR')).toBe('고등학교 1학년');
  });

  it('names the French ladder rather than numbering it', () => {
    expect(stageLabel(9, 'FR')).toBe('Troisième');
    expect(stageLabel(10, 'FR')).toBe('Seconde');
    expect(stageLabel(12, 'FR')).toBe('Terminale');
  });

  it('falls back to Grade N for regions with no hand-checked ladder', () => {
    expect(stageLabel(8, 'ZZ')).toBe('Grade 8');
    expect(stageLabel(8, undefined)).toBe('Grade 8');
    expect(stageLabel(8, 'XX')).toBe('Grade 8');
  });

  it('handles the ends of the ladder without producing "Grade 0"', () => {
    expect(stageLabel(0, 'US')).toBe('Pre-primary');
    expect(stageLabel(STAGE_MAX, 'GB')).toBe('Doctorate (PhD)');
    expect(stageLabel(17, 'IN')).toBe("Master's");
  });

  it('carries on through college and university, named the local way', () => {
    expect(stageLabel(13, 'US')).toBe('College freshman');
    expect(stageLabel(16, 'US')).toBe('College senior');
    expect(stageLabel(13, 'IN')).toBe('College year 1 (UG)');
    expect(stageLabel(14, 'GB')).toBe('University year 2');
    expect(stageLabel(15, 'ZZ')).toBe('University year 3');
    expect(typicalAgeForStage(13)).toEqual({ min: 18, max: 19 });
  });

  it('gives every supported region a full, non-empty, uniquely-labelled picker', () => {
    for (const region of supportedRegions()) {
      const opts = stageOptions(region);
      expect(opts.length, region).toBe(STAGE_MAX);
      expect(opts.filter((o) => o.band === 'school').length, region).toBe(12);
      expect(opts.every((o) => o.label.length > 0), region).toBe(true);
      // Duplicate labels in a picker are unusable — two rows reading the same.
      const labels = new Set(opts.map((o) => o.label));
      expect(labels.size, `${region} has duplicate stage labels`).toBe(opts.length);
    }
  });

  it('round-trips age → stage → age band', () => {
    for (let age = 6; age <= 17; age++) {
      const stage = stageFromAge(age);
      const band = typicalAgeForStage(stage);
      expect(age, `age ${age} → stage ${stage}`).toBeGreaterThanOrEqual(band.min);
      expect(age).toBeLessThanOrEqual(band.max);
    }
    // Outside the ladder in both directions.
    expect(stageFromAge(4)).toBe(0);
    expect(stageFromAge(30)).toBe(13);
  });
});

describe('stageFits', () => {
  it('is tolerant by one stage in each direction', () => {
    // Curricula disagree by a year all the time; a hard band would fight reality.
    const range = { min: 9, max: 11 };
    expect(stageFits(range, 8)).toBe(true);
    expect(stageFits(range, 12)).toBe(true);
    expect(stageFits(range, 7)).toBe(false);
    expect(stageFits(range, 13)).toBe(false);
  });

  it('treats an absent range as universally eligible', () => {
    expect(stageFits(null, 1)).toBe(true);
    expect(stageFits(undefined, 14)).toBe(true);
  });
});
