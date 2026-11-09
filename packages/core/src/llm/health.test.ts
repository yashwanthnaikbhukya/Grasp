import { afterEach, describe, expect, it } from 'vitest';
import { ProviderRequestError, ProviderTransientError } from '../errors';
import {
  isHealthFailure,
  noteProviderFailure,
  noteProviderSuccess,
  orderByHealth,
  resetProviderHealth,
} from './gateway';

const chain = [{ name: 'gemini' as const }, { name: 'groq' as const }, { name: 'ollama' as const }];
const names = (xs: readonly { name: string }[]) => xs.map((x) => x.name);

afterEach(() => resetProviderHealth());

describe('provider health ordering', () => {
  it('keeps the configured order when everything is healthy', () => {
    expect(names(orderByHealth(chain, 'mid'))).toEqual(['gemini', 'groq', 'ollama']);
  });

  it('sinks a provider that just failed to the back — never removes it', () => {
    noteProviderFailure('gemini', 'mid');
    expect(names(orderByHealth(chain, 'mid'))).toEqual(['groq', 'ollama', 'gemini']);
  });

  it('is per tier: a cooling mid model does not demote the fast one', () => {
    noteProviderFailure('gemini', 'mid');
    expect(names(orderByHealth(chain, 'fast'))).toEqual(['gemini', 'groq', 'ollama']);
  });

  it('recovers after the cooldown, or immediately on a success', () => {
    const t0 = 1_000_000;
    noteProviderFailure('gemini', 'mid', t0);
    expect(names(orderByHealth(chain, 'mid', t0 + 59_000))[0]).toBe('groq');
    expect(names(orderByHealth(chain, 'mid', t0 + 61_000))[0]).toBe('gemini');

    noteProviderFailure('groq', 'mid');
    noteProviderSuccess('groq', 'mid');
    expect(names(orderByHealth(chain, 'mid'))).toEqual(['gemini', 'groq', 'ollama']);
  });

  it('backs off while a provider keeps failing, capped at 10 minutes', () => {
    const t0 = 5_000_000;
    noteProviderFailure('gemini', 'mid', t0); // 1 min
    noteProviderFailure('gemini', 'mid', t0); // 2 min
    noteProviderFailure('gemini', 'mid', t0); // 4 min
    expect(names(orderByHealth(chain, 'mid', t0 + 3 * 60_000))[0]).toBe('groq');
    expect(names(orderByHealth(chain, 'mid', t0 + 4 * 60_000 + 1))[0]).toBe('gemini');

    for (let i = 0; i < 10; i++) noteProviderFailure('gemini', 'mid', t0);
    expect(names(orderByHealth(chain, 'mid', t0 + 10 * 60_000 + 1))[0]).toBe('gemini');

    // One success resets the streak: the next failure is a 1-minute cooldown again.
    noteProviderSuccess('gemini', 'mid');
    noteProviderFailure('gemini', 'mid', t0);
    expect(names(orderByHealth(chain, 'mid', t0 + 61_000))[0]).toBe('gemini');
  });

  it('only provider-health errors count — not our own bugs, not the gate simulation', () => {
    const transient = (kind: string) => new ProviderTransientError('x', { provider: 'groq', kind });
    expect(isHealthFailure(transient('timeout'))).toBe(true);
    expect(isHealthFailure(transient('rate_limit'))).toBe(true);
    expect(isHealthFailure(transient('server'))).toBe(true);
    expect(isHealthFailure(transient('simulated'))).toBe(false);
    expect(isHealthFailure(new ProviderRequestError('400', { provider: 'groq' }))).toBe(false);
  });
});
