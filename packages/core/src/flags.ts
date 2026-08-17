/**
 * Per-surface feature flags, so half-built work ships to yourself without
 * branching. Default off; flip in `.env.local`.
 */

function on(key: string, dflt = false): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return dflt;
  return v === '1' || v.toLowerCase() === 'true';
}

export const flags = {
  ask: on('FLAG_ASK', true),
  reps: on('FLAG_REPS'),
  snap: on('FLAG_SNAP'),
  duel: on('FLAG_DUEL'),
  map: on('FLAG_MAP'),
  slips: on('FLAG_SLIPS'),

  /** Show token/cost readout in the UI. */
  devMetrics: on('FLAG_DEV_METRICS', true),
} as const;

export type FlagName = keyof typeof flags;
