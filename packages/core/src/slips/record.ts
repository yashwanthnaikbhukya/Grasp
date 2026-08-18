import type { RootCause, SlipClassification } from '@grasp/schema';
import { collections } from '../db/collections';
import { generate } from '../llm/gateway';
import { loadGraph } from '../concepts/resolve';
import { currentP } from '../learner/mastery';
import { reconcile, signalPrior, type Prior, type SlipSignals } from './classify';

/**
 * Classify one wrong attempt and record it.
 *
 * Runs *after* the learner has their answer, never in front of it — a slip label
 * is worth nothing if it costs a second of feedback latency. Failures here are
 * logged and dropped: a missing label degrades the weekly digest, it does not
 * break practice.
 */

export interface RecordSlipArgs {
  userId: string;
  attemptId: string;
  questionId: string;
  conceptIds: string[];
  stem: string;
  correctAnswer: unknown;
  studentAnswer: unknown;
  latencyMs: number;
  hintsUsed: number;
  positionInSession?: number;
  sessionLength?: number;
}

export async function recordSlip(args: RecordSlipArgs): Promise<Prior | null> {
  const conceptId = args.conceptIds[0];
  if (!conceptId) return null;

  const now = new Date();
  const graph = await loadGraph();
  const node = graph.find((c) => c._id === conceptId);
  const prereqIds = node?.prereqIds ?? [];

  // Mastery of the concept and of everything it depends on. The prerequisite
  // half is what separates `prerequisite-gap` from `knowledge-gap`, and no
  // amount of reading the question can substitute for it.
  const relevant = [conceptId, ...prereqIds];
  const masteryDocs = await collections
    .mastery()
    .find({ userId: args.userId, conceptId: { $in: relevant } } as never)
    .toArray();
  const byConcept = new Map(masteryDocs.map((m) => [String(m.conceptId), m]));

  const pOf = (id: string): { p: number; attempts: number } => {
    const m = byConcept.get(id);
    if (!m) return { p: 0, attempts: 0 };
    return {
      p: currentP(
        {
          p: Number(m.p ?? 0),
          attempts: Number(m.attempts ?? 0),
          correct: Number(m.correct ?? 0),
          elo: Number(m.elo ?? 1200),
          stability: Number(m.stability ?? 1),
          difficulty: Number(m.difficulty ?? 0),
          lastSeenAt: (m.lastSeenAt as Date | null) ?? null,
          nextDueAt: (m.nextDueAt as Date) ?? now,
          state: 'learning',
        },
        now,
      ),
      attempts: Number(m.attempts ?? 0),
    };
  };

  const self = pOf(conceptId);
  const signals: SlipSignals = {
    correct: false,
    latencyMs: args.latencyMs,
    hintsUsed: args.hintsUsed,
    positionInSession: args.positionInSession ?? 0,
    sessionLength: args.sessionLength ?? 1,
    conceptP: self.p,
    conceptAttempts: self.attempts,
    prereqs: prereqIds.map((id) => ({ conceptId: id, ...pOf(id) })),
  };

  const prior = signalPrior(signals);

  /**
   * Which causes the model may choose from.
   *
   * `prerequisite-gap` is withheld unless the signals actually found a weak
   * prerequisite. Observed on a real run: the model reached for it on every
   * single wrong answer, because it explains anything and commits to nothing.
   * The reconcile guard already rejected those, but removing the option is
   * better than rejecting the answer — it spends the model's attention on
   * distinctions it can actually make from the question and the response.
   */
  const hasWeakPrereq = signals.prereqs.some((p) => p.attempts > 0 && p.p < 0.5);
  const availableCauses = [
    'careless-arithmetic',
    'misread-question',
    ...(hasWeakPrereq ? ['prerequisite-gap'] : []),
    'misconception',
    'knowledge-gap',
    'time-pressure',
  ].join(', ');

  // The model reads the question and the actual answer, which the signals
  // cannot. If it is unavailable the prior stands.
  let fromModel: Prior | null = null;
  try {
    const res = await generate<SlipClassification>({
      task: 'slip.classify',
      input: {
        availableCauses,
        stem: args.stem,
        correctAnswer: args.correctAnswer,
        studentAnswer: args.studentAnswer,
        latencyMs: args.latencyMs,
        hintsUsed: args.hintsUsed,
        positionInSession: `${signals.positionInSession + 1} of ${signals.sessionLength}`,
        conceptId,
        conceptMastery: `${self.p.toFixed(2)} over ${self.attempts} attempts`,
        prereqMastery:
          signals.prereqs.length > 0
            ? signals.prereqs
                .map((p) => `${p.conceptId}: ${p.p.toFixed(2)} (${p.attempts} attempts)`)
                .join('\n')
            : '(no prerequisites recorded)',
      },
      userId: args.userId,
    });
    if (res.data) {
      fromModel = {
        rootCause: res.data.rootCause,
        confidence: res.data.confidence,
        reason: res.data.note,
        upstreamConceptId: res.data.upstreamConceptId,
      };
    }
  } catch {
    // Provider exhausted. The prior is a defensible label on its own.
  }

  const final = reconcile(prior, fromModel);

  await collections.slips().updateOne(
    { attemptId: args.attemptId } as never,
    {
      $set: {
        userId: args.userId,
        attemptId: args.attemptId,
        conceptId,
        rootCause: final.rootCause as RootCause,
        note: final.reason.slice(0, 240),
        confidence: final.confidence,
        upstreamConceptId: final.upstreamConceptId,
        createdAt: now,
        resolvedAt: null,
      },
    },
    { upsert: true },
  );

  return final;
}
