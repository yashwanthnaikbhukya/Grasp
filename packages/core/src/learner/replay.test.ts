import { describe, expect, it } from 'vitest';
import { initialMastery, updateMastery } from './mastery';
import { diffMastery, replayMastery, type ReplayAttempt } from './replay';

const t = (min: number) => new Date(Date.UTC(2026, 10, 8, 10, min));
const attempt = (seq: number, correct: boolean, min: number, conceptIds = ['trig-ratios']): ReplayAttempt => ({
  seq,
  ts: t(min),
  questionId: 'q1',
  conceptIds,
  correct,
  latencyMs: 6_000,
  hintsUsed: 0,
});

describe('replayMastery', () => {
  it('equals folding the same attempts one by one, in seq order', () => {
    const events = [attempt(2, true, 5), attempt(1, false, 0)]; // out of order on purpose
    const rebuilt = replayMastery(events, () => 0.5).get('trig-ratios');

    const first = updateMastery(initialMastery(t(0)), { correct: false, latencyMs: 6_000, hintsUsed: 0, itemDifficulty: 0.5 }, t(0));
    const second = updateMastery(first, { correct: true, latencyMs: 6_000, hintsUsed: 0, itemDifficulty: 0.5 }, t(5));

    expect(rebuilt).toEqual({ ...second, updatedFromEventSeq: 2 });
  });

  it('folds an attempt into every concept it touches', () => {
    const m = replayMastery([attempt(1, true, 0, ['a', 'b'])], () => 0);
    expect([...m.keys()]).toEqual(['a', 'b']);
  });
});

describe('diffMastery', () => {
  const rebuilt = replayMastery([attempt(1, true, 0)], () => 0);
  const exact = new Map([...rebuilt].map(([k, v]) => [k, { ...v }]));

  it('reports nothing when stored matches the replay', () => {
    expect(diffMastery(exact, rebuilt)).toEqual([]);
  });

  it('reports a fold that has no event behind it (the bug rule 4 forbids)', () => {
    const drifted = new Map([...exact].map(([k, v]) => [k, { ...v, attempts: v.attempts + 1 }]));
    expect(diffMastery(drifted, rebuilt).map((d) => d.field)).toContain('attempts');
  });

  it('reports concepts present on only one side', () => {
    const base = exact.get('trig-ratios');
    if (!base) throw new Error('fixture missing');
    const extra = new Map(exact);
    extra.set('orphan', base);
    expect(diffMastery(extra, rebuilt)).toContainEqual(
      expect.objectContaining({ conceptId: 'orphan', field: 'missing from events' }),
    );
  });
});
