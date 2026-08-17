import type { MasteryState, QuestionType } from '@grasp/schema';

/**
 * The feed scheduler.
 *
 * Composes each Reps session from four pools, then diversifies. Pure — the
 * candidates are fetched by the caller and passed in, so what a learner sees
 * next is fully testable without a database.
 *
 * **No model call is ever made from this path.** Cards come pre-generated; if a
 * swipe ever waits on a model, that is a bug. See CLAUDE.md rule 5.
 */

export interface CandidateCard {
  questionId: string;
  conceptId: string;
  /** IRT difficulty, roughly -3 (easy) to +3 (hard). */
  difficulty: number;
  type: QuestionType;
}

export interface ConceptState {
  conceptId: string;
  state: MasteryState;
  p: number;
  nextDueAt: Date;
  /** Prerequisites, from the universal concept graph. */
  prereqIds: readonly string[];
}

export type Pool = 'due' | 'weak' | 'frontier' | 'interleave';

export interface ScheduledCard extends CandidateCard {
  pool: Pool;
}

export interface FeedConfig {
  count: number;
  /** Shares per pool. Config, not constants — these are the first thing to tune. */
  shares: Record<Pool, number>;
  /** Target success rate. Too easy is boring; too hard, they quit. */
  targetSuccess: number;
  /** A learner should not see one concept over and over in a single sitting. */
  maxPerConcept: number;
  /** Prerequisite mastery required before a new concept is unlocked. */
  frontierThreshold: number;
}

export const DEFAULT_FEED: FeedConfig = {
  count: 20,
  shares: { due: 0.4, weak: 0.3, frontier: 0.2, interleave: 0.1 },
  targetSuccess: 0.8,
  maxPerConcept: 3,
  frontierThreshold: 0.6,
};

/**
 * Which concepts are eligible for each pool.
 *
 * Frontier gating is the payoff for authoring prerequisite edges: a learner is
 * only shown something new once the things it depends on are actually held. It
 * prevents the worst experience in adaptive learning — being drilled on
 * something you cannot possibly do because an upstream concept is missing.
 */
export function poolsFor(
  states: readonly ConceptState[],
  now: Date,
  config: FeedConfig = DEFAULT_FEED,
): Record<Pool, string[]> {
  const byId = new Map(states.map((s) => [s.conceptId, s]));

  const due = states
    .filter((s) => s.state !== 'unseen' && s.nextDueAt.getTime() <= now.getTime())
    .sort((a, b) => a.nextDueAt.getTime() - b.nextDueAt.getTime())
    .map((s) => s.conceptId);

  const weak = states
    .filter((s) => s.state === 'learning' || (s.state !== 'unseen' && s.p < 0.5))
    .sort((a, b) => a.p - b.p)
    .map((s) => s.conceptId);

  const frontier = states
    .filter((s) => s.state === 'unseen')
    .filter((s) =>
      s.prereqIds.every((id) => {
        const prereq = byId.get(id);
        // An unknown prerequisite is treated as satisfied rather than blocking:
        // a graph gap should not lock a learner out of a whole branch.
        return !prereq || prereq.p >= config.frontierThreshold;
      }),
    )
    .map((s) => s.conceptId);

  const interleave = states
    .filter((s) => s.state === 'mastered')
    .sort((a, b) => b.p - a.p)
    .map((s) => s.conceptId);

  return { due, weak, frontier, interleave };
}

/** How close an item's difficulty sits to where the learner should be succeeding ~80%. */
function difficultyFit(difficulty: number, p: number, target: number): number {
  // A learner at p succeeds on a b=0 item about p of the time. To hit the target
  // success rate, aim slightly below their current level when they are shaky and
  // slightly above when they are fluent.
  const ideal = (p - target) * 3;
  return -Math.abs(difficulty - ideal);
}

/**
 * Compose the feed.
 *
 * Order of operations matters: pools decide *what*, difficulty banding decides
 * *which item*, and diversification decides *the order*. Doing diversification
 * first would let it undo the banding.
 */
export function composeFeed(
  candidates: readonly CandidateCard[],
  states: readonly ConceptState[],
  now: Date,
  config: FeedConfig = DEFAULT_FEED,
): ScheduledCard[] {
  if (candidates.length === 0) return [];

  const pools = poolsFor(states, now, config);
  const pById = new Map(states.map((s) => [s.conceptId, s.p]));
  const byConcept = new Map<string, CandidateCard[]>();
  for (const c of candidates) {
    const list = byConcept.get(c.conceptId) ?? [];
    list.push(c);
    byConcept.set(c.conceptId, list);
  }

  const used = new Set<string>();
  const perConcept = new Map<string, number>();
  const picked: ScheduledCard[] = [];

  /**
   * Round-robin across the pool's concepts, one card per concept per pass.
   *
   * Not one pass through the concept list: a pool with two concepts could then
   * never contribute more than two cards, and a learner early on — when almost
   * everything is `unseen` and the frontier is the only non-empty pool — would
   * get a session of three cards instead of twenty.
   *
   * Round-robin also spreads concepts through the session for free, which makes
   * the diversify pass afterwards mostly a formality.
   */
  const take = (pool: Pool, want: number) => {
    let taken = 0;
    let progressed = true;

    while (taken < want && progressed) {
      progressed = false;

      for (const conceptId of pools[pool]) {
        if (taken >= want) break;
        if ((perConcept.get(conceptId) ?? 0) >= config.maxPerConcept) continue;

        const p = pById.get(conceptId) ?? 0;
        const best = (byConcept.get(conceptId) ?? [])
          .filter((c) => !used.has(c.questionId))
          .sort(
            (a, b) =>
              difficultyFit(b.difficulty, p, config.targetSuccess) -
              difficultyFit(a.difficulty, p, config.targetSuccess),
          )[0];

        if (!best) continue;
        used.add(best.questionId);
        perConcept.set(conceptId, (perConcept.get(conceptId) ?? 0) + 1);
        picked.push({ ...best, pool });
        taken++;
        progressed = true;
      }
    }
    return taken;
  };

  // Pools in priority order, so a shortfall in one is absorbed by the next
  // rather than leaving the session short.
  const order: Pool[] = ['due', 'weak', 'frontier', 'interleave'];
  for (const pool of order) {
    take(pool, Math.round(config.count * config.shares[pool]));
  }
  for (const pool of order) {
    if (picked.length >= config.count) break;
    take(pool, config.count - picked.length);
  }

  return diversify(picked.slice(0, config.count));
}

/**
 * Reorder so consecutive cards differ in concept and type.
 *
 * Three MCQs in a row is what makes a feed feel like a quiz instead of a feed,
 * and consecutive cards on one concept read as being stuck. Greedy: at each
 * step take the highest-ranked remaining card that differs from the last one,
 * falling back to the next in line when nothing differs.
 */
export function diversify(cards: readonly ScheduledCard[]): ScheduledCard[] {
  const remaining = [...cards];
  const out: ScheduledCard[] = [];

  while (remaining.length > 0) {
    const last = out[out.length - 1];
    let index = 0;

    if (last) {
      const differsInBoth = remaining.findIndex(
        (c) => c.conceptId !== last.conceptId && c.type !== last.type,
      );
      const differsInConcept = remaining.findIndex((c) => c.conceptId !== last.conceptId);
      index = differsInBoth >= 0 ? differsInBoth : differsInConcept >= 0 ? differsInConcept : 0;
    }

    const [next] = remaining.splice(index, 1);
    if (next) out.push(next);
  }

  return out;
}

/**
 * The cold-start placement.
 *
 * Eight questions, binary search over the graph's topological depth: correct
 * goes deeper, wrong goes shallower. Eight is enough over a few hundred concepts
 * because prerequisite structure propagates each answer — knowing they can do
 * something at depth 6 implies a lot about depths 1–5.
 *
 * Delivered in the normal card format so it reads as trying the product rather
 * than sitting a test.
 */
export function placementNext(
  candidates: readonly (CandidateCard & { depth: number })[],
  answered: readonly { depth: number; correct: boolean }[],
  maxDepth: number,
): (CandidateCard & { depth: number }) | null {
  let low = 0;
  let high = maxDepth;

  for (const a of answered) {
    if (a.correct) low = Math.max(low, a.depth);
    else high = Math.min(high, Math.max(0, a.depth - 1));
  }
  if (low > high) low = high;

  const target = Math.round((low + high) / 2);
  const seen = new Set(answered.map((_, i) => i));

  return (
    [...candidates]
      .filter((_, i) => !seen.has(i))
      .sort((a, b) => Math.abs(a.depth - target) - Math.abs(b.depth - target))[0] ?? null
  );
}
