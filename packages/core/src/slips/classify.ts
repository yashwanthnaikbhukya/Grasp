import type { RootCause } from '@grasp/schema';

/**
 * Root-cause classification of mistakes.
 *
 * Every competitor can show a topic-wise accuracy breakdown. Almost none say
 * *why* you are getting things wrong. That is what this is for, and it is nearly
 * free because the evidence already exists by the time Reps is running.
 *
 * The taxonomy is fixed and never free text. Aggregation is the entire product
 * value — "you lose 40% of your marks to sign errors under time pressure" only
 * exists if the labels are enumerable. See docs/06-learner-model.md.
 */

export interface SlipSignals {
  correct: boolean;
  latencyMs: number;
  hintsUsed: number;
  /** Position in the current session, 0-indexed. Late + wrong hints at fatigue. */
  positionInSession: number;
  sessionLength: number;
  /** Mastery of the concept the question tests. */
  conceptP: number;
  conceptAttempts: number;
  /** Mastery of that concept's prerequisites, weakest first. */
  prereqs: { conceptId: string; p: number; attempts: number }[];
}

export interface Prior {
  rootCause: RootCause;
  confidence: number;
  reason: string;
  upstreamConceptId?: string;
}

/**
 * A cheap prior from the signals alone, before any model call.
 *
 * Two reasons this exists rather than going straight to the model. It gives the
 * classifier a starting point that is grounded in measurements the model cannot
 * see — mastery history, session position — and it means a rate-limited or
 * unavailable provider degrades to a defensible label instead of no label.
 *
 * The prerequisite check is the important one: `prerequisite-gap` and
 * `knowledge-gap` are indistinguishable from the question alone, and only
 * upstream mastery separates them.
 */
export function signalPrior(s: SlipSignals): Prior {
  const seconds = s.latencyMs / 1000;

  // A weak prerequisite outranks everything else — it is the most actionable
  // thing we can tell a learner, and it explains the failure upstream.
  const weakest = [...s.prereqs]
    .filter((p) => p.attempts > 0)
    .sort((a, b) => a.p - b.p)[0];

  if (weakest && weakest.p < 0.4) {
    return {
      rootCause: 'prerequisite-gap',
      confidence: 0.7,
      reason: `upstream ${weakest.conceptId} sits at ${weakest.p.toFixed(2)}`,
      upstreamConceptId: weakest.conceptId,
    };
  }

  // Late in a long session, after doing fine earlier.
  const lateInSession =
    s.sessionLength >= 8 && s.positionInSession >= s.sessionLength * 0.7;
  if (lateInSession && s.conceptP > 0.55) {
    return {
      rootCause: 'time-pressure',
      confidence: 0.5,
      reason: 'late in a long session on a concept they usually hold',
    };
  }

  // Answered faster than the question can be read.
  if (seconds < 3) {
    return {
      rootCause: 'careless-arithmetic',
      confidence: 0.55,
      reason: `answered in ${seconds.toFixed(1)}s — too fast to have worked it through`,
    };
  }

  // Engaged with it and still could not do it, on something they have practised.
  if (seconds > 30 && s.conceptAttempts >= 3 && s.conceptP < 0.5) {
    return {
      rootCause: 'misconception',
      confidence: 0.45,
      reason: 'sustained effort, repeated failure — looks systematic rather than careless',
    };
  }

  // Never really learned yet.
  if (s.conceptAttempts <= 2 || s.conceptP < 0.3) {
    return {
      rootCause: 'knowledge-gap',
      confidence: 0.5,
      reason: 'little or no successful history on this concept',
    };
  }

  return {
    rootCause: 'careless-arithmetic',
    confidence: 0.3,
    reason: 'no strong signal either way',
  };
}

/**
 * Reconcile the model's label with the signal prior.
 *
 * The model reads the question and the learner's actual answer, which the
 * signals cannot. The signals carry mastery history, which the model cannot see.
 * Neither dominates:
 *
 *   · agreement raises confidence — two independent routes to the same label
 *   · `prerequisite-gap` is only accepted from the model when the signals agree
 *     there is a weak prerequisite, because the model cannot verify one exists
 *     and it is a tempting-sounding answer
 *   · a low-confidence model label loses to a high-confidence prior
 */
export function reconcile(prior: Prior, model: Prior | null): Prior {
  if (!model) return prior;

  if (model.rootCause === prior.rootCause) {
    return {
      ...model,
      confidence: Math.min(0.95, Math.max(model.confidence, prior.confidence) + 0.2),
      upstreamConceptId: model.upstreamConceptId ?? prior.upstreamConceptId,
      reason: model.reason,
    };
  }

  // The model cannot see upstream mastery, so it cannot substantiate this one.
  if (model.rootCause === 'prerequisite-gap' && !prior.upstreamConceptId) {
    return { ...prior, confidence: Math.max(0.3, prior.confidence - 0.1) };
  }

  // A confident prior beats a hesitant model.
  if (prior.confidence >= 0.65 && model.confidence < 0.6) return prior;

  return { ...model, confidence: Math.max(0.25, model.confidence - 0.15) };
}

/** Learner-facing summary of a set of slips. The thing nobody else builds. */
export function summarise(
  slips: readonly { rootCause: RootCause; conceptId: string }[],
): { rootCause: RootCause; count: number; share: number; concepts: string[] }[] {
  if (slips.length === 0) return [];

  const byCause = new Map<RootCause, { count: number; concepts: Set<string> }>();
  for (const s of slips) {
    const entry = byCause.get(s.rootCause) ?? { count: 0, concepts: new Set<string>() };
    entry.count++;
    entry.concepts.add(s.conceptId);
    byCause.set(s.rootCause, entry);
  }

  return [...byCause.entries()]
    .map(([rootCause, e]) => ({
      rootCause,
      count: e.count,
      share: e.count / slips.length,
      concepts: [...e.concepts],
    }))
    .sort((a, b) => b.count - a.count);
}

/** How the taxonomy reads to a learner. Never the raw enum. */
export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  'careless-arithmetic': 'Slipped in the working',
  'misread-question': 'Answered a different question',
  'prerequisite-gap': 'Missing something earlier',
  misconception: 'A rule being applied that does not hold',
  'knowledge-gap': 'Not learned yet',
  'time-pressure': 'Accuracy fell under time pressure',
};

export const ROOT_CAUSE_HINT: Record<RootCause, string> = {
  'careless-arithmetic': 'The method was right. Slow down on the last step.',
  'misread-question': 'Read the stem twice before choosing — the answer was right for a different question.',
  'prerequisite-gap': 'This is not really about this topic. Go back one step.',
  misconception: 'Something you believe here is consistently wrong — worth unpicking directly.',
  'knowledge-gap': 'You have not covered this properly yet. That is fine — it is next.',
  'time-pressure': 'You know this when you are fresh. It is stamina, not understanding.',
};
