import { afterEach, describe, expect, it } from 'vitest';
import { resetRateLimits, takeToken } from './limits';
import { tierWithinBudget } from './llm/budget';

afterEach(() => resetRateLimits());

describe('takeToken', () => {
  it('allows up to the limit inside the window, then refuses with a retry time', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(takeToken('chat:a', 3, 60_000, t0 + i).ok).toBe(true);
    const refused = takeToken('chat:a', 3, 60_000, t0 + 10);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBe(60_000 - 10);
  });

  it('frees a slot once the oldest request leaves the window', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) takeToken('chat:b', 3, 60_000, t0);
    expect(takeToken('chat:b', 3, 60_000, t0 + 60_001).ok).toBe(true);
  });

  it('keys are independent — one learner cannot exhaust another', () => {
    for (let i = 0; i < 3; i++) takeToken('chat:c', 3, 60_000, 0);
    expect(takeToken('chat:d', 3, 60_000, 0).ok).toBe(true);
  });
});

describe('tierWithinBudget', () => {
  it('keeps the tier under budget and drops to fast at or over it', () => {
    expect(tierWithinBudget('mid', 199_999, 200_000)).toBe('mid');
    expect(tierWithinBudget('mid', 200_000, 200_000)).toBe('fast');
    expect(tierWithinBudget('best', 900_000, 200_000)).toBe('fast');
  });

  it('a budget of 0 means no ceiling', () => {
    expect(tierWithinBudget('mid', 10_000_000, 0)).toBe('mid');
  });
});
