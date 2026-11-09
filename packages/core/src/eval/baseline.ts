/**
 * The regression gate — pure, unit-tested (baseline.test.ts).
 *
 * A baseline records, per task, how many golden cases passed and under which
 * prompt version. `pnpm eval --compare` fails when a task regresses, and when a
 * task's prompt version changed while its golden set is still under 10 cases
 * (docs/07-phases.md § 0.4: no prompt bump without a set to measure it).
 */

export interface TaskResult {
  task: string;
  prompt: string;
  passed: number;
  /** Scored cases only — inconclusive ones (provider outages) are excluded. */
  total: number;
  inconclusive?: number;
  /** Case id → passed. */
  cases: Record<string, boolean>;
}

export interface Baseline {
  updatedAt: string;
  tasks: Record<string, Omit<TaskResult, 'task'>>;
}

/** Model output varies run to run; one flipped case is noise, two is a signal. */
export const NOISE_CASES = 1;
export const MIN_CASES_FOR_PROMPT_BUMP = 10;

export interface Regression {
  task: string;
  reason: string;
}

export function compareToBaseline(current: readonly TaskResult[], baseline: Baseline): Regression[] {
  const out: Regression[] = [];
  for (const r of current) {
    const b = baseline.tasks[r.task];
    if (!b) continue; // a new task has nothing to regress from

    // The set's size, not this run's scored count — an outage must not make a
    // full set look too small to allow a prompt bump.
    const setSize = r.total + (r.inconclusive ?? 0);
    if (r.prompt !== b.prompt && setSize < MIN_CASES_FOR_PROMPT_BUMP) {
      out.push({
        task: r.task,
        reason: `prompt changed ${b.prompt} → ${r.prompt} with only ${setSize} golden cases (need ${MIN_CASES_FOR_PROMPT_BUMP})`,
      });
    }

    // Compare on the cases both runs share, so adding cases is never a regression.
    const shared = Object.keys(r.cases).filter((id) => id in b.cases);
    const was = shared.filter((id) => b.cases[id]).length;
    const now = shared.filter((id) => r.cases[id]).length;
    if (now < was - NOISE_CASES) {
      const lost = shared.filter((id) => b.cases[id] && !r.cases[id]);
      out.push({
        task: r.task,
        reason: `${was} → ${now} of ${shared.length} shared cases pass (lost: ${lost.join(', ')})`,
      });
    }
  }
  return out;
}

export function toBaseline(results: readonly TaskResult[], now = new Date()): Baseline {
  return {
    updatedAt: now.toISOString(),
    tasks: Object.fromEntries(
      results.map((r) => [r.task, { prompt: r.prompt, passed: r.passed, total: r.total, cases: r.cases }]),
    ),
  };
}
