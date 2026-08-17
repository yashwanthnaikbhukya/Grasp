import { describe, expect, it } from 'vitest';
import {
  brierScore,
  currentP,
  evidenceWeight,
  expectedScore,
  initialMastery,
  kFactor,
  nextState,
  retention,
  updateMastery,
  type AttemptSignal,
} from './mastery';

/**
 * The mastery engine decides what every learner practises next, and it fails
 * silently — a subtly wrong update produces a plausible number and a worse
 * schedule, with nothing to point at. So it gets tested on invariants, not
 * examples.
 */

const NOW = new Date('2026-08-17T12:00:00Z');
const DAY = 86_400_000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY);

function attempt(over: Partial<AttemptSignal> = {}): AttemptSignal {
  return { correct: true, latencyMs: 12_000, hintsUsed: 0, itemDifficulty: 0, ...over };
}

describe('expectedScore', () => {
  it('is 0.5 when ability matches item difficulty', () => {
    expect(expectedScore(1200, 0)).toBeCloseTo(0.5, 5);
  });

  it('rises with ability and falls with difficulty', () => {
    expect(expectedScore(1600, 0)).toBeGreaterThan(0.5);
    expect(expectedScore(1200, 2)).toBeLessThan(0.5);
  });

  it('stays inside (0, 1) at extremes', () => {
    for (const [elo, d] of [[0, 3], [4000, -3], [1200, 0]] as const) {
      const s = expectedScore(elo, d);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
  });
});

describe('kFactor', () => {
  it('decays with experience so one unlucky question cannot overturn an estimate', () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(5));
    expect(kFactor(5)).toBeGreaterThan(kFactor(50));
  });
});

describe('retention', () => {
  it('is 1 immediately and decays toward 0', () => {
    expect(retention(0, 10)).toBe(1);
    expect(retention(10, 10)).toBeCloseTo(Math.exp(-1), 5);
    expect(retention(1000, 10)).toBeLessThan(0.001);
  });

  it('decays more slowly with higher stability', () => {
    expect(retention(7, 30)).toBeGreaterThan(retention(7, 3));
  });

  it('never divides by zero on a degenerate stability', () => {
    expect(Number.isFinite(retention(5, 0))).toBe(true);
  });
});

describe('evidenceWeight', () => {
  it('discounts a very fast wrong answer', () => {
    // Usually a guess or a misread, not evidence of not knowing the concept.
    expect(evidenceWeight(attempt({ correct: false, latencyMs: 1_200 }))).toBeLessThan(
      evidenceWeight(attempt({ correct: false, latencyMs: 30_000 })),
    );
  });

  it('discounts a correct answer that needed hints', () => {
    expect(evidenceWeight(attempt({ hintsUsed: 2 }))).toBeLessThan(evidenceWeight(attempt()));
  });

  it('discounts an implausibly long attempt', () => {
    // They walked away mid-question; the elapsed time is not thinking time.
    expect(evidenceWeight(attempt({ latencyMs: 900_000 }))).toBeLessThan(1);
  });

  it('never reaches zero — every attempt carries some information', () => {
    expect(evidenceWeight(attempt({ correct: false, latencyMs: 1, hintsUsed: 9 }))).toBeGreaterThan(0);
  });
});

describe('updateMastery', () => {
  it('raises ability on a correct answer and lowers it on a wrong one', () => {
    const start = initialMastery(NOW);
    expect(updateMastery(start, attempt({ correct: true }), NOW).elo).toBeGreaterThan(start.elo);
    expect(updateMastery(start, attempt({ correct: false }), NOW).elo).toBeLessThan(start.elo);
  });

  it('rewards a hard win more than an easy one', () => {
    const start = initialMastery(NOW);
    const hard = updateMastery(start, attempt({ itemDifficulty: 2 }), NOW);
    const easy = updateMastery(start, attempt({ itemDifficulty: -2 }), NOW);
    expect(hard.elo).toBeGreaterThan(easy.elo);
  });

  it('punishes an easy loss more than a hard one', () => {
    const start = initialMastery(NOW);
    const lostEasy = updateMastery(start, attempt({ correct: false, itemDifficulty: -2 }), NOW);
    const lostHard = updateMastery(start, attempt({ correct: false, itemDifficulty: 2 }), NOW);
    expect(lostEasy.elo).toBeLessThan(lostHard.elo);
  });

  it('stretches the review interval on success and collapses it on failure', () => {
    const start = { ...initialMastery(NOW), stability: 10, attempts: 3 };
    expect(updateMastery(start, attempt({ correct: true }), NOW).stability).toBeGreaterThan(10);
    expect(updateMastery(start, attempt({ correct: false }), NOW).stability).toBeLessThan(10);
  });

  it('never collapses the interval below a day', () => {
    // Dropping straight back to same-day on one slip over-drills.
    const start = { ...initialMastery(NOW), stability: 1 };
    expect(updateMastery(start, attempt({ correct: false }), NOW).stability).toBeGreaterThanOrEqual(1);
  });

  it('caps stability so nothing is scheduled beyond a year out', () => {
    let m = { ...initialMastery(NOW), stability: 300, attempts: 20 };
    for (let i = 0; i < 10; i++) m = updateMastery(m, attempt({ correct: true }), NOW);
    expect(m.stability).toBeLessThanOrEqual(365);
  });

  it('gives a slow correct answer less interval growth than a fast one', () => {
    const start = { ...initialMastery(NOW), stability: 5, attempts: 3 };
    const fluent = updateMastery(start, attempt({ latencyMs: 5_000 }), NOW);
    const effortful = updateMastery(start, attempt({ latencyMs: 90_000 }), NOW);
    expect(effortful.stability).toBeLessThan(fluent.stability);
  });

  it('sets the next due date from stability', () => {
    const m = updateMastery(initialMastery(NOW), attempt(), NOW);
    const days = (m.nextDueAt.getTime() - NOW.getTime()) / DAY;
    expect(days).toBeCloseTo(m.stability, 5);
  });

  it('counts attempts and correct answers', () => {
    let m = initialMastery(NOW);
    m = updateMastery(m, attempt({ correct: true }), NOW);
    m = updateMastery(m, attempt({ correct: false }), NOW);
    m = updateMastery(m, attempt({ correct: true }), NOW);
    expect(m.attempts).toBe(3);
    expect(m.correct).toBe(2);
  });

  it('is pure — same inputs, same output', () => {
    // The property replay depends on. A clock read inside would break this.
    const start = initialMastery(NOW);
    const a = updateMastery(start, attempt(), NOW);
    const b = updateMastery(start, attempt(), NOW);
    expect(a).toEqual(b);
  });

  it('does not mutate its input', () => {
    const start = initialMastery(NOW);
    const snapshot = { ...start };
    updateMastery(start, attempt(), NOW);
    expect(start).toEqual(snapshot);
  });

  it('converges upward under sustained success', () => {
    let m = initialMastery(NOW);
    for (let i = 0; i < 12; i++) m = updateMastery(m, attempt({ correct: true }), NOW);
    expect(m.p).toBeGreaterThan(0.8);
    expect(m.state).toBe('mastered');
  });

  it('converges downward under sustained failure', () => {
    let m = initialMastery(NOW);
    for (let i = 0; i < 12; i++) m = updateMastery(m, attempt({ correct: false }), NOW);
    expect(m.p).toBeLessThan(0.35);
    expect(m.state).toBe('learning');
  });
});

describe('currentP', () => {
  it('is 0 before any attempt', () => {
    expect(currentP(initialMastery(NOW), NOW)).toBe(0);
  });

  it('decays with time away, so nothing stays mastered forever', () => {
    // Without decay the due queue is meaningless — everything looks mastered.
    let m = initialMastery(NOW);
    for (let i = 0; i < 6; i++) m = updateMastery(m, attempt({ correct: true }), NOW);

    const fresh = currentP(m, NOW);
    const stale = currentP(m, later(400));
    expect(stale).toBeLessThan(fresh);
  });

  it('decays more slowly once the interval has been stretched', () => {
    const weak = { ...initialMastery(NOW), attempts: 3, elo: 1500, stability: 2, lastSeenAt: NOW };
    const strong = { ...weak, stability: 60 };
    expect(currentP(strong, later(20))).toBeGreaterThan(currentP(weak, later(20)));
  });
});

describe('nextState', () => {
  it('walks unseen → learning → review → mastered', () => {
    expect(nextState(0, 0, 0)).toBe('unseen');
    expect(nextState(0.3, 2, 1)).toBe('learning');
    expect(nextState(0.7, 3, 2)).toBe('review');
    expect(nextState(0.9, 6, 5)).toBe('mastered');
  });

  it('will not call something mastered on a single lucky answer', () => {
    expect(nextState(0.95, 1, 1)).not.toBe('mastered');
  });

  it('will not call something mastered with a poor hit rate', () => {
    expect(nextState(0.9, 10, 4)).not.toBe('mastered');
  });
});

describe('brierScore', () => {
  it('is 0 for perfect prediction and 1 for perfectly wrong', () => {
    expect(brierScore([{ p: 1, correct: true }, { p: 0, correct: false }])).toBe(0);
    expect(brierScore([{ p: 0, correct: true }, { p: 1, correct: false }])).toBe(1);
  });

  it('is 0.25 for a coin-flip prediction', () => {
    expect(brierScore([{ p: 0.5, correct: true }, { p: 0.5, correct: false }])).toBe(0.25);
  });

  it('rewards a model that beats the constant baseline', () => {
    // The Phase 2 gate. If the model cannot beat a constant, the
    // personalization is theatre.
    const outcomes = [
      { correct: true }, { correct: true }, { correct: true }, { correct: false },
    ];
    const baseRate = 0.75;
    const constant = brierScore(outcomes.map((o) => ({ p: baseRate, ...o })));
    const informed = brierScore([
      { p: 0.95, correct: true },
      { p: 0.9, correct: true },
      { p: 0.85, correct: true },
      { p: 0.2, correct: false },
    ]);
    expect(informed).toBeLessThan(constant);
  });

  it('returns NaN rather than 0 for no predictions', () => {
    // 0 would read as "perfectly calibrated" on an empty week.
    expect(Number.isNaN(brierScore([]))).toBe(true);
  });
});
