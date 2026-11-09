import { initialMastery, type MasteryStateRecord, updateMastery } from './mastery';

/**
 * Rebuild mastery from the event log — the property ADR 0003 promises.
 *
 * Pure: the same `attempt.recorded` events in `seq` order produce the same
 * mastery, because `updateMastery` takes `now` from the event (`ts`) rather than
 * the clock. `recordAttempt()` folds with that same timestamp, so a learner
 * whose every fold came from a persisted event rebuilds exactly.
 */

export interface ReplayAttempt {
  seq: number;
  ts: Date;
  questionId: string;
  conceptIds: readonly string[];
  correct: boolean;
  latencyMs: number;
  hintsUsed: number;
}

export type RebuiltMastery = MasteryStateRecord & { updatedFromEventSeq: number };

export function replayMastery(
  attempts: readonly ReplayAttempt[],
  difficultyOf: (questionId: string) => number,
): Map<string, RebuiltMastery> {
  const out = new Map<string, RebuiltMastery>();
  for (const a of [...attempts].sort((x, y) => x.seq - y.seq)) {
    for (const conceptId of a.conceptIds) {
      const prev = out.get(conceptId) ?? initialMastery(a.ts);
      const next = updateMastery(
        prev,
        {
          correct: a.correct,
          latencyMs: a.latencyMs,
          hintsUsed: a.hintsUsed,
          itemDifficulty: difficultyOf(a.questionId),
        },
        a.ts,
      );
      out.set(conceptId, { ...next, updatedFromEventSeq: a.seq });
    }
  }
  return out;
}

export interface MasteryDiff {
  conceptId: string;
  field: string;
  stored: unknown;
  rebuilt: unknown;
}

const NUMERIC = ['p', 'elo', 'stability', 'difficulty'] as const;
const EXACT = ['attempts', 'correct', 'state'] as const;

/**
 * Field-level differences between stored and rebuilt mastery. Counts and state
 * must match exactly; continuous values within `tolerance` (floating point, and
 * a few ms of clock skew on rows folded before 2026-11-08).
 */
export function diffMastery(
  stored: ReadonlyMap<string, Partial<MasteryStateRecord>>,
  rebuilt: ReadonlyMap<string, RebuiltMastery>,
  tolerance = 1e-3,
): MasteryDiff[] {
  const diffs: MasteryDiff[] = [];
  const ids = new Set([...stored.keys(), ...rebuilt.keys()]);
  for (const conceptId of ids) {
    const s = stored.get(conceptId);
    const r = rebuilt.get(conceptId);
    if (!s || !r) {
      diffs.push({ conceptId, field: s ? 'missing from events' : 'missing from mastery', stored: !!s, rebuilt: !!r });
      continue;
    }
    for (const f of EXACT) {
      if (s[f] !== r[f]) diffs.push({ conceptId, field: f, stored: s[f], rebuilt: r[f] });
    }
    for (const f of NUMERIC) {
      const a = Number(s[f]);
      const b = Number(r[f]);
      if (!(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)))) {
        diffs.push({ conceptId, field: f, stored: a, rebuilt: b });
      }
    }
  }
  return diffs;
}
