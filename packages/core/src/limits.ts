/**
 * Per-key rate limiting — a sliding window of timestamps.
 *
 * In-memory and per-instance: right for a single server today, and the reason
 * Upstash is on the plan for a multi-instance deploy (docs/07-phases.md §1.7).
 * A limiter that is per-instance under-limits by the instance count; it never
 * blocks a request it shouldn't, which is the safe direction to be wrong in.
 */

const windows = new Map<string, number[]>();

export interface RateDecision {
  ok: boolean;
  /** How long until the next request would be allowed; 0 when `ok`. */
  retryAfterMs: number;
}

export function takeToken(key: string, limit: number, windowMs: number, now = Date.now()): RateDecision {
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
  }
  recent.push(now);
  windows.set(key, recent);
  // Keep the map from growing without bound across many learners.
  if (windows.size > 10_000) {
    for (const [k, ts] of windows) if (ts.every((t) => now - t >= windowMs)) windows.delete(k);
  }
  return { ok: true, retryAfterMs: 0 };
}

/** Test seam. */
export function resetRateLimits(): void {
  windows.clear();
}
