import { describe, expect, it } from 'vitest';
import { allocateBudget, BUDGETS, fitItems, type Component } from './budget';

/**
 * The budget allocator is the component most likely to be quietly wrong, because
 * nothing visibly breaks when it is — you just get a slightly worse answer. So it
 * gets property-style tests rather than a couple of examples.
 */

const P = BUDGETS.explain;

describe('allocateBudget', () => {
  it('grants what was asked when everything fits', () => {
    const r = allocateBudget(P, {
      system: 900,
      learnerCard: 300,
      retrieved: 4_000,
      history: 2_000,
      attachments: 0,
    });
    expect(r.shed).toEqual([]);
    expect(r.withinBudget).toBe(true);
    expect(r.granted.retrieved).toBeGreaterThanOrEqual(4_000);
  });

  it('never exceeds the total, whatever is requested', () => {
    // The invariant that matters: overflow here means a truncated prompt or a
    // provider error, both of which surface far from the cause.
    for (const scale of [1, 10, 100, 1_000]) {
      const r = allocateBudget(P, {
        system: 1_000,
        learnerCard: 500 * scale,
        retrieved: 8_000 * scale,
        history: 6_000 * scale,
        attachments: 8_000 * scale,
      });
      expect(r.totalUsed, `scale ${scale}`).toBeLessThanOrEqual(P.total);
    }
  });

  it('always reserves room for the response', () => {
    // An answer with no room to be written is not an answer.
    const r = allocateBudget(P, {
      retrieved: 999_999,
      history: 999_999,
      attachments: 999_999,
    });
    expect(r.granted.response).toBe(P.allocated.response);
  });

  it('sheds in the declared priority order', () => {
    const r = allocateBudget(P, {
      system: 1_000,
      learnerCard: 500,
      retrieved: 8_000,
      history: 6_000,
      attachments: 30_000,
    });
    expect(r.shed[0]).toBe('attachments');
  });

  it('keeps a floor under retrieval rather than shedding it to nothing', () => {
    // Zero retrieval produces a confidently ungrounded answer, which is worse
    // than a partially grounded one.
    const r = allocateBudget(P, {
      system: 1_000,
      learnerCard: 500,
      retrieved: 8_000,
      history: 200_000,
      attachments: 200_000,
    });
    expect(r.granted.retrieved).toBeGreaterThan(0);
  });

  it('lends unclaimed headroom to a component that wants more', () => {
    // A short conversation should not waste its history allocation.
    const r = allocateBudget(P, {
      system: 500,
      learnerCard: 200,
      retrieved: 15_000,
      history: 100,
      attachments: 0,
    });
    expect(r.granted.retrieved).toBeGreaterThan(P.allocated.retrieved);
    expect(r.totalUsed).toBeLessThanOrEqual(P.total);
  });

  it('reports what it shed so a degraded answer is diagnosable', () => {
    const r = allocateBudget(P, { retrieved: 8_000, history: 6_000, attachments: 60_000 });
    expect(r.shed.length).toBeGreaterThan(0);
  });

  it('handles an empty request', () => {
    const r = allocateBudget(P, {});
    expect(r.totalUsed).toBe(P.allocated.response);
    expect(r.shed).toEqual([]);
  });

  it('treats negative requests as zero', () => {
    const r = allocateBudget(P, { retrieved: -500 });
    expect(r.used.retrieved).toBe(0);
  });
});

describe('budget profiles', () => {
  it('every intent has a profile whose parts fit its total', () => {
    for (const [intent, profile] of Object.entries(BUDGETS)) {
      const sum = Object.values(profile.allocated).reduce((a, b) => a + b, 0);
      expect(sum, `${intent} over-allocates`).toBeLessThanOrEqual(profile.total);
    }
  });

  it('every profile can shed every sheddable component', () => {
    const sheddable: Component[] = ['learnerCard', 'retrieved', 'history', 'attachments'];
    for (const [intent, profile] of Object.entries(BUDGETS)) {
      for (const c of sheddable) {
        expect(profile.priority, `${intent} cannot shed ${c}`).toContain(c);
      }
    }
  });

  it('never lists system or response as sheddable', () => {
    for (const [intent, profile] of Object.entries(BUDGETS)) {
      expect(profile.priority, intent).not.toContain('system');
      expect(profile.priority, intent).not.toContain('response');
    }
  });

  it('solve gives attachments more room than explain does', () => {
    // The problem in front of the learner matters more than turn ten.
    expect(BUDGETS.solve.allocated.attachments).toBeGreaterThan(
      BUDGETS.explain.allocated.attachments,
    );
    expect(BUDGETS.solve.allocated.history).toBeLessThan(BUDGETS.explain.allocated.history);
  });

  it('chitchat skips retrieval entirely', () => {
    // Not every message needs the machinery.
    expect(BUDGETS.chitchat.allocated.retrieved).toBe(0);
  });
});

describe('fitItems', () => {
  const items = [
    { id: 'a', tokens: 100 },
    { id: 'b', tokens: 200 },
    { id: 'c', tokens: 300 },
  ];
  const size = (i: { tokens: number }) => i.tokens;

  it('keeps items in order until the grant runs out', () => {
    const r = fitItems(items, 350, size);
    expect(r.kept.map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.dropped).toBe(1);
  });

  it('keeps whole items only', () => {
    // A half-included chunk is worse than an excluded one — the model reads it
    // as complete and answers from a truncated fact.
    const r = fitItems(items, 250, size);
    expect(r.kept.map((i) => i.id)).toEqual(['a']);
  });

  it('skips an over-large item but keeps trying smaller ones', () => {
    const r = fitItems([{ id: 'huge', tokens: 9_999 }, { id: 'small', tokens: 10 }], 100, size);
    expect(r.kept.map((i) => i.id)).toEqual(['small']);
  });

  it('handles a zero grant', () => {
    expect(fitItems(items, 0, size).kept).toEqual([]);
  });
});
