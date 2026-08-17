import type { Intent } from '@grasp/schema';

/**
 * Token budgeting.
 *
 * Not "stuff it until it fits". A declared budget per surface and intent, so an
 * overflow is a decision you made rather than a truncation you discover in a
 * confusing answer. See docs/05-context-broker.md § 2.
 *
 * Pure — no I/O — so the allocation logic is exhaustively testable. It is also
 * the component most likely to be quietly wrong, because nothing visibly breaks
 * when it is: you just get a slightly worse answer.
 */

export type Component =
  | 'system'
  | 'learnerCard'
  | 'retrieved'
  | 'history'
  | 'attachments'
  | 'response';

export interface BudgetProfile {
  total: number;
  /** Hard reservation per component. */
  allocated: Record<Component, number>;
  /** Shed order when over budget — first listed goes first. */
  priority: Component[];
}

/**
 * Profiles per intent.
 *
 * `explain` is the balanced default. `solve` moves budget from history into
 * attachments, because the problem in front of the learner matters more than
 * what was said ten turns ago. `quiz` cuts the learner card to a single line.
 * `chitchat` skips the machinery entirely — not every message needs retrieval.
 */
export const BUDGETS: Record<Intent, BudgetProfile> = {
  explain: {
    total: 32_000,
    allocated: {
      system: 1_000,
      learnerCard: 500,
      retrieved: 8_000,
      history: 6_000,
      attachments: 8_000,
      response: 4_000,
    },
    priority: ['attachments', 'history', 'retrieved', 'learnerCard'],
  },
  solve: {
    total: 32_000,
    allocated: {
      system: 1_000,
      learnerCard: 400,
      retrieved: 6_000,
      history: 3_000,
      attachments: 12_000,
      response: 4_000,
    },
    priority: ['history', 'retrieved', 'attachments', 'learnerCard'],
  },
  quiz: {
    total: 16_000,
    allocated: {
      system: 800,
      learnerCard: 150,
      retrieved: 5_000,
      history: 2_000,
      attachments: 2_000,
      response: 3_000,
    },
    priority: ['attachments', 'history', 'retrieved', 'learnerCard'],
  },
  meta: {
    total: 12_000,
    allocated: {
      system: 800,
      learnerCard: 1_200,
      retrieved: 1_000,
      history: 4_000,
      attachments: 0,
      response: 2_000,
    },
    priority: ['retrieved', 'attachments', 'history', 'learnerCard'],
  },
  chitchat: {
    total: 4_000,
    allocated: {
      system: 600,
      learnerCard: 100,
      retrieved: 0,
      history: 1_500,
      attachments: 0,
      response: 1_000,
    },
    priority: ['retrieved', 'attachments', 'history', 'learnerCard'],
  },
};

export interface AllocationResult {
  /** Tokens each component may use. */
  granted: Record<Component, number>;
  /** Tokens each component asked for. */
  used: Record<Component, number>;
  /**
   * Components that got less than they asked for, worst-affected first.
   *
   * Note what this means: **not** "the total overflowed" — a well-formed profile
   * never lets that happen — but "this component was cut". That is the
   * diagnostically useful signal, and it is what makes a thin answer traceable
   * to a budget decision instead of looking like a model failure.
   */
  shed: Component[];
  totalUsed: number;
  /** False only if a profile over-allocates against its own total. */
  withinBudget: boolean;
}

/**
 * Fit requested sizes into the profile.
 *
 * Three passes:
 *   1. Everyone gets `min(requested, allocated)`.
 *   2. Unclaimed headroom is lent to whoever wants more, largest need first —
 *      no reason to waste a short conversation's history allocation.
 *   3. Anything still short is recorded as shed, in priority order.
 *
 * Retrieval keeps a floor. Cutting it to nothing produces a confidently
 * ungrounded answer, which is worse than a partially grounded one.
 */
export function allocateBudget(
  profile: BudgetProfile,
  requested: Partial<Record<Component, number>>,
): AllocationResult {
  const components = Object.keys(profile.allocated) as Component[];
  const granted = {} as Record<Component, number>;
  const used = {} as Record<Component, number>;

  for (const c of components) {
    used[c] = Math.max(0, requested[c] ?? 0);
    granted[c] = Math.min(used[c], profile.allocated[c]);
  }

  // The response reservation is never negotiable — an answer with no room to be
  // written is not an answer.
  granted.response = profile.allocated.response;

  const spent = () => components.reduce((n, c) => n + granted[c], 0);

  // Lend unclaimed headroom, largest unmet need first.
  let slack = profile.total - spent();
  if (slack > 0) {
    const hungry = components
      .filter((c) => c !== 'response' && used[c] > granted[c])
      .sort((a, b) => used[b] - granted[b] - (used[a] - granted[a]));

    for (const c of hungry) {
      const extra = Math.min(used[c] - granted[c], slack);
      granted[c] += extra;
      slack -= extra;
      if (slack <= 0) break;
    }
  }

  // A profile that over-allocates against its own total still has to fit.
  let overflow = spent() - profile.total;
  for (const c of profile.priority) {
    if (overflow <= 0) break;
    const floor = c === 'retrieved' ? Math.min(1_500, granted[c]) : 0;
    const canShed = Math.max(0, granted[c] - floor);
    if (canShed <= 0) continue;
    const take = Math.min(canShed, overflow);
    granted[c] -= take;
    overflow -= take;
  }

  const shed = profile.priority.filter((c) => granted[c] < used[c]);

  return { granted, used, shed, totalUsed: spent(), withinBudget: overflow <= 0 };
}

/**
 * Trim a list of items to fit a token grant, keeping the highest-ranked.
 *
 * Whole items only. A half-included chunk is worse than an excluded one: the
 * model reads it as complete and answers from a truncated fact.
 */
export function fitItems<T>(
  items: readonly T[],
  grant: number,
  sizeOf: (item: T) => number,
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let spent = 0;

  for (const item of items) {
    const size = sizeOf(item);
    if (spent + size > grant) continue;
    kept.push(item);
    spent += size;
  }

  return { kept, dropped: items.length - kept.length };
}
