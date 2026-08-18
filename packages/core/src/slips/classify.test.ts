import { describe, expect, it } from 'vitest';
import { reconcile, signalPrior, summarise, ROOT_CAUSE_LABEL, type Prior, type SlipSignals } from './classify';

/**
 * Root-cause labels are written into the learner graph and drive what someone
 * practises for weeks. A wrong label is worse than no label, so the prior is
 * tested against the cases it exists to separate.
 */

function signals(over: Partial<SlipSignals> = {}): SlipSignals {
  return {
    correct: false,
    latencyMs: 15_000,
    hintsUsed: 0,
    positionInSession: 2,
    sessionLength: 10,
    conceptP: 0.5,
    conceptAttempts: 5,
    prereqs: [],
    ...over,
  };
}

describe('signalPrior', () => {
  it('blames a weak prerequisite above everything else', () => {
    // The most actionable thing we can say, and the model cannot see it.
    const p = signalPrior(
      signals({ prereqs: [{ conceptId: 'radian-measure', p: 0.15, attempts: 4 }] }),
    );
    expect(p.rootCause).toBe('prerequisite-gap');
    expect(p.upstreamConceptId).toBe('radian-measure');
  });

  it('ignores a prerequisite with no evidence either way', () => {
    // An untouched prerequisite is not proof of a gap.
    const p = signalPrior(
      signals({ prereqs: [{ conceptId: 'never-tried', p: 0, attempts: 0 }] }),
    );
    expect(p.rootCause).not.toBe('prerequisite-gap');
  });

  it('ignores a prerequisite the learner actually holds', () => {
    const p = signalPrior(
      signals({ prereqs: [{ conceptId: 'solid', p: 0.85, attempts: 9 }] }),
    );
    expect(p.rootCause).not.toBe('prerequisite-gap');
  });

  it('reads an answer faster than reading time as careless', () => {
    expect(signalPrior(signals({ latencyMs: 1_500 })).rootCause).toBe('careless-arithmetic');
  });

  it('reads sustained effort with repeated failure as a misconception', () => {
    // Engaged and still wrong, repeatedly — systematic, not a slip.
    const p = signalPrior(signals({ latencyMs: 60_000, conceptAttempts: 8, conceptP: 0.3 }));
    expect(p.rootCause).toBe('misconception');
  });

  it('reads a late-session failure on a held concept as fatigue', () => {
    const p = signalPrior(
      signals({ positionInSession: 9, sessionLength: 12, conceptP: 0.75 }),
    );
    expect(p.rootCause).toBe('time-pressure');
  });

  it('does not blame fatigue in a short session', () => {
    const p = signalPrior(signals({ positionInSession: 2, sessionLength: 3, conceptP: 0.75 }));
    expect(p.rootCause).not.toBe('time-pressure');
  });

  it('reads little history as simply not learned yet', () => {
    const p = signalPrior(signals({ conceptAttempts: 1, conceptP: 0.1, latencyMs: 20_000 }));
    expect(p.rootCause).toBe('knowledge-gap');
  });

  it('always returns a usable label with a confidence in range', () => {
    const p = signalPrior(signals());
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(1);
    expect(p.reason.length).toBeGreaterThan(0);
  });
});

describe('reconcile', () => {
  const prior: Prior = { rootCause: 'knowledge-gap', confidence: 0.5, reason: 'prior' };

  it('returns the prior when the model is unavailable', () => {
    // A rate-limited provider must degrade to a defensible label, not no label.
    expect(reconcile(prior, null)).toBe(prior);
  });

  it('raises confidence when both routes agree', () => {
    const model: Prior = { rootCause: 'knowledge-gap', confidence: 0.6, reason: 'model' };
    const out = reconcile(prior, model);
    expect(out.rootCause).toBe('knowledge-gap');
    expect(out.confidence).toBeGreaterThan(0.6);
  });

  it('never lets confidence exceed 1', () => {
    const model: Prior = { rootCause: 'knowledge-gap', confidence: 0.95, reason: 'model' };
    expect(reconcile(prior, model).confidence).toBeLessThanOrEqual(1);
  });

  it('refuses an unsubstantiated prerequisite-gap from the model', () => {
    // The model cannot see upstream mastery, and this is a tempting-sounding
    // answer, so it is only accepted when the signals found a weak prerequisite.
    const model: Prior = { rootCause: 'prerequisite-gap', confidence: 0.9, reason: 'model' };
    expect(reconcile(prior, model).rootCause).toBe('knowledge-gap');
  });

  it('accepts prerequisite-gap when the signals substantiate it', () => {
    const grounded: Prior = {
      rootCause: 'prerequisite-gap',
      confidence: 0.7,
      reason: 'prior',
      upstreamConceptId: 'radian-measure',
    };
    const model: Prior = { rootCause: 'prerequisite-gap', confidence: 0.8, reason: 'model' };
    const out = reconcile(grounded, model);
    expect(out.rootCause).toBe('prerequisite-gap');
    expect(out.upstreamConceptId).toBe('radian-measure');
  });

  it('lets a confident prior beat a hesitant model', () => {
    const confident: Prior = { rootCause: 'time-pressure', confidence: 0.8, reason: 'prior' };
    const hesitant: Prior = { rootCause: 'misread-question', confidence: 0.4, reason: 'model' };
    expect(reconcile(confident, hesitant).rootCause).toBe('time-pressure');
  });

  it('discounts a disagreement rather than pretending to certainty', () => {
    const model: Prior = { rootCause: 'misread-question', confidence: 0.7, reason: 'model' };
    const out = reconcile(prior, model);
    expect(out.rootCause).toBe('misread-question');
    expect(out.confidence).toBeLessThan(0.7);
  });
});

describe('summarise', () => {
  it('ranks causes by frequency with shares that sum to 1', () => {
    const out = summarise([
      { rootCause: 'careless-arithmetic', conceptId: 'a' },
      { rootCause: 'careless-arithmetic', conceptId: 'b' },
      { rootCause: 'knowledge-gap', conceptId: 'c' },
    ]);
    expect(out[0]?.rootCause).toBe('careless-arithmetic');
    expect(out[0]?.count).toBe(2);
    expect(out.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 6);
  });

  it('collects the distinct concepts behind each cause', () => {
    const out = summarise([
      { rootCause: 'careless-arithmetic', conceptId: 'a' },
      { rootCause: 'careless-arithmetic', conceptId: 'a' },
      { rootCause: 'careless-arithmetic', conceptId: 'b' },
    ]);
    expect(out[0]?.concepts.sort()).toEqual(['a', 'b']);
  });

  it('handles no slips', () => {
    expect(summarise([])).toEqual([]);
  });
});

describe('labels', () => {
  it('never shows a learner the raw enum', () => {
    for (const [key, label] of Object.entries(ROOT_CAUSE_LABEL)) {
      expect(label, key).not.toContain('-');
      expect(label.length).toBeGreaterThan(8);
    }
  });
});
