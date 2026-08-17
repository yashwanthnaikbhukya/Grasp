import { describe, expect, it } from 'vitest';
import { LearnerProfileSchema, nextProfileGap, profileCompleteness } from './profile';

/**
 * Onboarding is progressive and skippable, so the profile must be useful when
 * half-empty. For real users it often will be. See docs/10-onboarding.md.
 */
describe('learner profile', () => {
  it('parses from nothing at all', () => {
    const p = LearnerProfileSchema.parse({});
    expect(p.region).toBe('XX');
    expect(p.stage).toBeNull();
    expect(p.age).toBeNull();
    expect(p.language.instruction).toBe('en');
    expect(p.language.codeSwitch).toBeNull();
    expect(p.depth).toBe('balanced');
    expect(p.goal.kind).toBe('self-study');
    expect(p.consent.basis).toBe('unknown');
  });

  it('scores an empty profile at zero and a full one at one', () => {
    expect(profileCompleteness(LearnerProfileSchema.parse({}))).toBe(0);

    const full = LearnerProfileSchema.parse({
      region: 'IN',
      age: 15,
      stage: 10,
      curriculumIds: ['in-cbse-secondary-math'],
      subjects: ['mathematics'],
      goal: { kind: 'exam', label: 'CBSE Board' },
      language: { instruction: 'en', codeSwitch: 'hi' },
      completedSteps: ['language'],
    });
    expect(profileCompleteness(full)).toBe(1);
  });

  it('points at the highest-value gap first', () => {
    const p = LearnerProfileSchema.parse({});
    expect(nextProfileGap(p)).toBe('region');

    const withRegion = LearnerProfileSchema.parse({ region: 'NG' });
    expect(nextProfileGap(withRegion)).toBe('age');

    const enough = LearnerProfileSchema.parse({
      region: 'NG',
      age: 16,
      stage: 11,
      curriculumIds: ['ng-waec-math'],
      subjects: ['mathematics'],
      goal: { kind: 'exam', label: 'WASSCE' },
      completedSteps: ['language'],
    });
    expect(nextProfileGap(enough)).toBeNull();
  });

  it('supports the adult self-learner with no stage at all', () => {
    const p = LearnerProfileSchema.parse({
      region: 'BR',
      age: 34,
      inFormalEducation: false,
      subjects: ['mathematics'],
      curriculumIds: ['self-study'],
    });
    expect(p.stage).toBeNull();
    expect(p.inFormalEducation).toBe(false);
    // A partial profile still scores usefully rather than reading as broken.
    expect(profileCompleteness(p)).toBeGreaterThan(0.5);
  });

  it('captures a code-switching pair', () => {
    // How a large share of the world actually studies. One field, real value.
    const p = LearnerProfileSchema.parse({
      language: { instruction: 'en', codeSwitch: 'hi' },
    });
    expect(p.language.codeSwitch).toBe('hi');
  });

  it('rejects an age outside plausible bounds', () => {
    expect(LearnerProfileSchema.safeParse({ age: 2 }).success).toBe(false);
    expect(LearnerProfileSchema.safeParse({ age: 200 }).success).toBe(false);
  });

  it('normalizes region to uppercase so filters cannot silently miss', () => {
    expect(LearnerProfileSchema.parse({ region: 'in' }).region).toBe('IN');
  });
});
