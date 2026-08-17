import type { MasteryState } from '@grasp/schema';

/**
 * The mastery engine.
 *
 * Pure. No I/O, no clock of its own — `now` is always passed in. That is what
 * makes replay work: rebuilding a learner's state from the event log has to
 * produce byte-identical output, and a function that reads `Date.now()` cannot.
 * See docs/adr/0003-event-sourced-learner-state.md.
 *
 * Elo, not Bayesian Knowledge Tracing, and deliberately so. BKT's extra
 * parameters need fitting, and fitting needs attempt data that only exists once
 * this is already running. Ship the interpretable thing, collect evidence, then
 * fit something better against the calibration metric — the interface here does
 * not change when that happens. See docs/06-learner-model.md.
 */

export interface MasteryStateRecord {
  p: number;
  attempts: number;
  correct: number;
  elo: number;
  stability: number;
  difficulty: number;
  lastSeenAt: Date | null;
  nextDueAt: Date;
  state: MasteryState;
}

export interface AttemptSignal {
  correct: boolean;
  /**
   * Distinguishes failure modes a boolean cannot: fast+wrong reads as careless
   * or guessed, slow+wrong as a genuine conceptual gap. Free signal that almost
   * nobody uses.
   */
  latencyMs: number;
  hintsUsed: number;
  /** IRT-style difficulty of the item, roughly -3 (easy) to +3 (hard). */
  itemDifficulty: number;
}

const START_ELO = 1200;
/** b = 0 sits at START_ELO; each difficulty point is ~200 Elo. */
const ELO_PER_DIFFICULTY = 200;

/** A day, in ms. Stability is expressed in days throughout. */
const DAY = 86_400_000;

export function initialMastery(now: Date): MasteryStateRecord {
  return {
    p: 0,
    attempts: 0,
    correct: 0,
    elo: START_ELO,
    stability: 1,
    difficulty: 0,
    lastSeenAt: null,
    nextDueAt: now,
    state: 'unseen',
  };
}

/**
 * K decays with experience: early attempts should move the estimate a long way,
 * established ones should not be overturned by a single unlucky question.
 */
export function kFactor(attempts: number): number {
  if (attempts < 3) return 32;
  if (attempts < 10) return 16;
  return 8;
}

/** Probability of answering an item of this difficulty correctly, from ability alone. */
export function expectedScore(elo: number, itemDifficulty: number): number {
  const itemElo = START_ELO + itemDifficulty * ELO_PER_DIFFICULTY;
  return 1 / (1 + 10 ** ((itemElo - elo) / 400));
}

/**
 * How much of what they knew is still retrievable.
 *
 * An exponential forgetting curve. Without decay the model claims people never
 * forget, which makes the entire due-queue meaningless — everything would look
 * mastered forever and nothing would ever be scheduled for review.
 */
export function retention(daysSince: number, stability: number): number {
  if (daysSince <= 0) return 1;
  return Math.exp(-daysSince / Math.max(stability, 0.1));
}

/**
 * Probability they would get this right if asked now.
 *
 * Two sources, blended by how much evidence there is, then discounted by what
 * has faded since they last saw it. This is the number the learner card shows
 * and the scheduler ranks on.
 *
 * Elo alone is not enough here, and the reason is worth stating: Elo is built
 * for zero-sum competition, where twelve wins against equal opponents genuinely
 * *is* a modest rating gain. For mastery it is strong evidence — a learner who
 * has answered twelve of twelve correctly should not read as 0.64. So the
 * observed hit rate carries increasing weight as attempts accumulate, while Elo
 * carries the early estimate when there is too little data to trust a raw
 * proportion.
 *
 * The hit rate is Laplace-smoothed, so one correct answer does not read as
 * certainty and one wrong answer does not read as hopeless.
 */
export function currentP(m: MasteryStateRecord, now: Date): number {
  if (m.attempts === 0) return 0;

  const ability = expectedScore(m.elo, m.difficulty);
  const observed = (m.correct + 1) / (m.attempts + 2);
  // Reaches 0.5 at 5 attempts, 0.7 at 12 — the point where a proportion starts
  // being more informative than a prior.
  const confidence = m.attempts / (m.attempts + 5);
  const base = ability * (1 - confidence) + observed * confidence;

  if (!m.lastSeenAt) return base;
  const days = (now.getTime() - m.lastSeenAt.getTime()) / DAY;
  return base * retention(days, m.stability);
}

/**
 * How informative an answer is about ability.
 *
 * A very fast wrong answer is weak evidence of *not knowing* — it usually means
 * they guessed or misread rather than that they lack the concept — so it moves
 * the estimate less. Hints work the same way in the other direction: a correct
 * answer that needed three hints says less than an unaided one.
 */
export function evidenceWeight(signal: AttemptSignal): number {
  let w = 1;
  const seconds = signal.latencyMs / 1000;

  if (!signal.correct && seconds < 3) w *= 0.5;
  if (signal.correct && signal.hintsUsed > 0) w *= Math.max(0.35, 1 - 0.3 * signal.hintsUsed);
  // An implausibly long answer usually means they walked away mid-question.
  if (seconds > 300) w *= 0.6;

  return w;
}

/**
 * State machine over the mastery lifecycle.
 *
 * The `mastered` threshold sits at 0.8, not 0.9, because Laplace smoothing caps
 * what `p` can reach: a perfect 12-for-12 lands near 0.84, so a higher bar would
 * be unreachable in practice and nothing would ever leave `review`. Thresholds
 * have to match the range the model can actually produce.
 *
 * The accuracy and attempt floors do the real work — they stop one lucky answer,
 * or a high `p` sitting on a poor hit rate, from reading as mastery.
 */
export function nextState(p: number, attempts: number, correct: number): MasteryState {
  if (attempts === 0) return 'unseen';
  if (p >= 0.8 && attempts >= 4 && correct / attempts >= 0.75) return 'mastered';
  if (p >= 0.55 && attempts >= 2) return 'review';
  return 'learning';
}

/**
 * Fold one attempt into a learner's state for one concept.
 *
 * The signature is the whole contract: previous state plus an event plus the
 * item, in, new state out. Nothing read, nothing written. When the algorithm
 * changes, only this body changes and the event log is replayed through it.
 */
export function updateMastery(
  prev: MasteryStateRecord,
  signal: AttemptSignal,
  now: Date,
): MasteryStateRecord {
  const expected = expectedScore(prev.elo, signal.itemDifficulty);
  const actual = signal.correct ? 1 : 0;
  const weight = evidenceWeight(signal);

  const elo = prev.elo + kFactor(prev.attempts) * weight * (actual - expected);

  // Stability: how long this should hold before it needs revisiting.
  //
  // Correct answers stretch the interval, and stretch it further when the item
  // was hard relative to ability — being right about something difficult is
  // stronger evidence of durable knowledge than being right about something easy.
  // A wrong answer collapses it, but not to zero: dropping straight back to a
  // one-day interval on a single slip over-drills.
  let stability = prev.stability;
  if (signal.correct) {
    const surprise = 1 + Math.max(0, expected < 0.5 ? 0.6 : 0.2);
    const effortPenalty = signal.latencyMs / 1000 > 45 ? 0.75 : 1;
    stability = Math.min(365, stability * (1.6 * surprise * effortPenalty));
  } else {
    stability = Math.max(1, stability * 0.4);
  }

  const attempts = prev.attempts + 1;
  const correct = prev.correct + (signal.correct ? 1 : 0);

  // Per-learner item difficulty, nudged toward what they actually find hard.
  const difficulty =
    prev.attempts === 0
      ? signal.itemDifficulty
      : prev.difficulty * 0.8 + signal.itemDifficulty * 0.2;

  const nextDueAt = new Date(now.getTime() + stability * DAY);

  const candidate: MasteryStateRecord = {
    p: 0,
    attempts,
    correct,
    elo,
    stability,
    difficulty,
    lastSeenAt: now,
    nextDueAt,
    state: 'learning',
  };

  const p = currentP(candidate, now);
  return { ...candidate, p, state: nextState(p, attempts, correct) };
}

/**
 * Brier score — the honest measure of whether any of the personalization is real.
 *
 * Accuracy going up can just mean easier questions; retention going up can just
 * mean better UI. Calibration going up means the model actually knows something
 * about the learner. Lower is better; compare against a constant baseline.
 * See docs/06-learner-model.md#the-calibration-metric.
 */
export function brierScore(predictions: readonly { p: number; correct: boolean }[]): number {
  if (predictions.length === 0) return Number.NaN;
  const total = predictions.reduce((sum, x) => sum + (x.p - (x.correct ? 1 : 0)) ** 2, 0);
  return total / predictions.length;
}
