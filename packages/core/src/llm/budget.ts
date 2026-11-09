import type { ModelTier } from '@grasp/schema';
import { collections } from '../db/collections';
import { env } from '../env';

/**
 * The per-learner cost guard (docs/04-llm-gateway.md — cost control).
 *
 * `GRASP_DAILY_TOKEN_BUDGET` is a ceiling on *output* tokens per learner per UTC
 * day. Past it, tutor replies drop to the `fast` tier: the learner keeps a tutor,
 * the bill stops climbing. Applied to the streamed tutor tasks only — they are
 * where per-learner spend lives, and background tasks that write durable labels
 * (slips, concepts) must never silently degrade to a weaker model.
 *
 * Spend is read from `llmCalls` (every call is traced there) and cached for a
 * minute per learner, so the guard costs one aggregate query per learner per
 * minute, not one per call.
 */

const CACHE_MS = 60_000;
const spentCache = new Map<string, { at: number; tokens: number }>();

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Pure: over budget ⇒ the cheapest tier. A budget of 0 means "no ceiling". */
export function tierWithinBudget(tier: ModelTier, spentTokens: number, budget: number): ModelTier {
  return budget > 0 && spentTokens >= budget ? 'fast' : tier;
}

export async function outputTokensToday(userId: string, now = new Date()): Promise<number> {
  const hit = spentCache.get(userId);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.tokens;

  const rows = await collections
    .llmCalls()
    .aggregate<{ tokens: number }>([
      { $match: { userId, createdAt: { $gte: startOfUtcDay(now) } } },
      { $group: { _id: null, tokens: { $sum: '$outputTokens' } } },
    ])
    .toArray();
  const tokens = Number(rows[0]?.tokens ?? 0);
  spentCache.set(userId, { at: now.getTime(), tokens });
  return tokens;
}

/** The tier a learner's call actually runs on. Never throws — a guard outage is not an outage. */
export async function tierForLearner(tier: ModelTier, userId: string | undefined): Promise<ModelTier> {
  if (!userId || env.dailyTokenBudget <= 0) return tier;
  try {
    return tierWithinBudget(tier, await outputTokensToday(userId), env.dailyTokenBudget);
  } catch {
    return tier;
  }
}

/** Test seam. */
export function resetBudgetCache(): void {
  spentCache.clear();
}
