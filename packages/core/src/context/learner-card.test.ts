import { describe, expect, it } from 'vitest';
import { LearnerProfileSchema } from '@grasp/schema';
import { buildLearnerCard } from './learner-card';

/**
 * The learner card is the whole differentiator, so its failure modes are tested
 * directly — especially the ones that would be invisible in a demo: leaked PII,
 * an internal id shown to the model, a misconception phrased as a correction.
 */

const NOW = new Date('2026-08-17T00:00:00Z');

const indianStudent = LearnerProfileSchema.parse({
  region: 'IN',
  age: 15,
  stage: 10,
  curriculumIds: ['in-cbse-secondary-math'],
  subjects: ['mathematics'],
  goal: { kind: 'exam', label: 'CBSE Board', examDate: '2027-02-14' },
  language: { instruction: 'en', codeSwitch: 'hi' },
  minutesPerDay: 40,
});

describe('buildLearnerCard', () => {
  it('uses the local stage label, never the internal number', () => {
    // "stage: 10" is meaningless to a model reasoning about a student.
    const card = buildLearnerCard({ profile: indianStudent, now: NOW });
    expect(card).toContain('Class 10');
    expect(card).not.toMatch(/stage['":\s]*10/i);
  });

  it('localizes the same stage differently by region', () => {
    const uk = LearnerProfileSchema.parse({ region: 'GB', stage: 10, subjects: ['mathematics'] });
    const ng = LearnerProfileSchema.parse({ region: 'NG', stage: 10, subjects: ['mathematics'] });
    expect(buildLearnerCard({ profile: uk, now: NOW })).toContain('Year 11');
    expect(buildLearnerCard({ profile: ng, now: NOW })).toContain('SSS 1');
  });

  it('counts days to the exam rather than printing a raw date', () => {
    const card = buildLearnerCard({ profile: indianStudent, now: NOW });
    expect(card).toMatch(/CBSE Board, \d+ days away/);
  });

  it('notices an exam date that has already passed', () => {
    const stale = LearnerProfileSchema.parse({
      ...indianStudent,
      goal: { kind: 'exam', label: 'Mock', examDate: '2020-01-01' },
    });
    expect(buildLearnerCard({ profile: stale, now: NOW })).toMatch(/has passed/i);
  });

  it('spells out the code-switching instruction', () => {
    // How a large share of the world studies. Must be an instruction, not a flag.
    const card = buildLearnerCard({ profile: indianStudent, now: NOW });
    expect(card).toContain('mixing in hi');
    expect(card).toMatch(/keep technical terms in en/i);
  });

  it('states notation conventions explicitly', () => {
    // `trapezoid` and `trapezium` name different shapes in US and UK English —
    // getting this wrong is worse than saying nothing.
    const card = buildLearnerCard({
      profile: indianStudent,
      notation: {
        reciprocalTrig: 'cosec-sec-cot',
        quadrilateral: 'commonwealth',
        digitGrouping: 'lakh-crore',
      },
      now: NOW,
    });
    expect(card).toContain('cosec');
    expect(card).toContain('trapezium');
    expect(card).toContain('lakh/crore');
  });

  it('shows mastery with its state word, not just a number', () => {
    const card = buildLearnerCard({
      profile: indianStudent,
      mastery: [{ conceptId: 'trig-ratios', p: 0.34, state: 'learning' }],
      now: NOW,
    });
    expect(card).toContain('learning');
    expect(card).toContain('0.34');
  });

  it('flags a prerequisite gap loudly', () => {
    // The single most actionable fact in the block.
    const card = buildLearnerCard({
      profile: indianStudent,
      mastery: [
        { conceptId: 'trig-ratios', p: 0.34, state: 'learning' },
        { conceptId: 'radian-measure', p: 0.19, state: 'learning', isPrerequisiteGap: true },
      ],
      now: NOW,
    });
    expect(card).toContain('PREREQUISITE GAP');
  });

  it('states a misconception as the belief, not as a correction', () => {
    // The model decides how to address it; the card only reports.
    const card = buildLearnerCard({
      profile: indianStudent,
      misconceptions: [
        { statement: 'treats degrees and radians interchangeably', evidenceCount: 4 },
      ],
      now: NOW,
    });
    expect(card).toContain('treats degrees and radians interchangeably');
    expect(card).not.toMatch(/incorrect|wrong|should be told/i);
  });

  it('renders recency in human terms', () => {
    const card = buildLearnerCard({
      profile: indianStudent,
      mastery: [
        {
          conceptId: 'trig-ratios',
          p: 0.5,
          state: 'review',
          lastSeenAt: new Date('2026-08-15T00:00:00Z'),
        },
      ],
      now: NOW,
    });
    expect(card).toContain('2 days ago');
  });

  it('never contains PII', () => {
    // The card addresses the learner in the second person and carries no
    // identity, so a prompt leak is not a PII leak.
    const card = buildLearnerCard({
      profile: LearnerProfileSchema.parse({ ...indianStudent, region: 'IN' }),
      now: NOW,
    });
    expect(card).not.toMatch(/@|email|phone|school|\bname\b/i);
  });

  it('caps its own length so it cannot crowd out retrieval', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      conceptId: `concept-${i}`,
      p: 0.5,
      state: 'learning' as const,
    }));
    const card = buildLearnerCard({
      profile: indianStudent,
      mastery: many,
      misconceptions: Array.from({ length: 20 }, (_, i) => ({
        statement: `belief ${i}`,
        evidenceCount: 1,
      })),
      now: NOW,
    });
    expect(card.split('\n').filter((l) => l.startsWith('  ')).length).toBeLessThan(16);
  });

  it('says so plainly when it knows nothing', () => {
    // An empty block reads as "no context available" and invites hedging.
    const card = buildLearnerCard({ profile: LearnerProfileSchema.parse({}), now: NOW });
    expect(card).toMatch(/No profile details yet/i);
  });

  it('handles a self-studying adult with no stage', () => {
    const adult = LearnerProfileSchema.parse({
      region: 'BR',
      age: 34,
      inFormalEducation: false,
      subjects: ['mathematics'],
    });
    const card = buildLearnerCard({ profile: adult, now: NOW });
    expect(card).toMatch(/not in formal education/i);
    expect(card).not.toMatch(/Grade|Class|Year/);
  });
});
