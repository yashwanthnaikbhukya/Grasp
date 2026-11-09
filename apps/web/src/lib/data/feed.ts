import {
  collections,
  composeFeed,
  currentP,
  DEFAULT_FEED,
  loadGraph,
  masteryFromDoc,
  RESERVE_AFTER_MS,
  type CandidateCard,
  type ConceptState,
} from '@grasp/core';
import type { FeedCard, FeedResponse } from '@grasp/schema';
import { conceptLabel } from '@/lib/labels';
import type { Session } from '@/lib/session';

/**
 * Compose a Reps feed — shared by the Reps page (first cards, in the same
 * response) and `GET /api/feed` (every set after). No model call on this path
 * (CLAUDE.md rule 5); the answer key never leaves the server.
 */
export async function loadFeed(session: Session, { count, concept }: { count: number; concept?: string }): Promise<FeedResponse> {
  // Everything below the session is independent, so it goes in one round trip.
  // On the free Atlas tier a query takes 35–380 ms; three of them in a row was
  // most of the Reps page's wait (2026-11-09).
  const now = new Date();
  const [questionDocs, graph, masteryDocs, recentAttempts] = await Promise.all([
    // Only verified questions are servable — enforced in the query, not by
    // convention, so no call site can forget.
    collections
      .questions()
      .find(
        {
          verificationStatus: 'verified',
          // The Reps UI answers by picking one option. Any other type would be
          // graded wrong every time (multi) or render with nothing to tap
          // (numeric, orderSteps) — widen this as each type gets its UI.
          type: 'mcq',
          // A card with no concept is evidence about nothing — it can't be
          // scheduled or folded into mastery.
          'conceptIds.0': { $exists: true },
          ...(concept ? { conceptIds: concept } : {}),
          ...(session.profile.subjects.length > 0
            ? { subject: { $in: session.profile.subjects } }
            : {}),
        } as never,
        // The card body (stem, options) comes too, so no second query is needed
        // to show the chosen cards. The answer key and solution never leave here.
        { projection: { solution: 0, answer: 0, verification: 0 } },
      )
      // Sort before the cap, or which come back is whatever order Mongo happens
      // to scan — and a newer card past the cap is never served.
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray(),
    loadGraph(),
    session.scope.mastery().find({}).toArray(),
    session.scope
      .attempts()
      .find({ ts: { $gte: new Date(now.getTime() - RESERVE_AFTER_MS) } } as never)
      .project({ questionId: 1 })
      .toArray(),
  ]);

  if (questionDocs.length === 0) {
    return {
      cards: [],
      empty: 'no-questions',
      message: concept
        ? 'No practice questions for that idea yet — try practicing everything.'
        : 'No practice questions are ready for your subjects yet. Check back soon.',
    } satisfies FeedResponse;
  }

  const graphById = new Map(graph.map((c) => [c._id, c]));
  const masteryById = new Map(masteryDocs.map((m) => [String(m.conceptId), m]));

  // RESERVE_AFTER_MS: the identical item waits; its concept still comes back on
  // schedule. Found in the 2026-11-09 test pass, when the end of a set
  // re-served the cards just answered.
  const recentlySeen = new Set(recentAttempts.map((a) => String(a.questionId)));
  const fresh = questionDocs.filter((q) => !recentlySeen.has(String(q._id)));
  if (fresh.length === 0) {
    return {
      cards: [],
      empty: 'caught-up',
      message: concept
        ? 'You have answered every card for this idea today. It comes back when it is due.'
        : 'You have answered every card that is ready today. What you started comes back for review when it is due.',
    } satisfies FeedResponse;
  }

  // A concept the learner has never touched still needs a state row for the
  // scheduler, or the frontier pool would always be empty on day one.
  const conceptIds = [...new Set(fresh.flatMap((q) => (q.conceptIds as string[]) ?? []))];

  const states: ConceptState[] = conceptIds.map((conceptId) => {
    const m = masteryById.get(conceptId);
    const node = graphById.get(conceptId);
    if (!m) {
      return {
        conceptId,
        state: 'unseen',
        p: 0,
        nextDueAt: now,
        prereqIds: node?.prereqIds ?? [],
      };
    }
    return {
      conceptId,
      state: (m.state as ConceptState['state']) ?? 'learning',
      p: currentP(masteryFromDoc(m, now), now),
      nextDueAt: (m.nextDueAt as Date) ?? now,
      prereqIds: node?.prereqIds ?? [],
    };
  });

  const candidates: CandidateCard[] = fresh.flatMap((q) => {
    const conceptId = ((q.conceptIds as string[]) ?? [])[0];
    if (!conceptId) return [];
    return [
      {
        questionId: String(q._id),
        conceptId,
        difficulty: Number(q.difficulty ?? 0),
        type: q.type as CandidateCard['type'],
      },
    ];
  });

  const scheduled = composeFeed(candidates, states, now, { ...DEFAULT_FEED, count });

  // Already loaded with the candidates. Only what the client may see is copied
  // out below — the answer key (`isCorrect`) stays on the server. Keys are
  // `String(_id)`: the scheduler works in strings and `_id` is an ObjectId.
  const byId = new Map(questionDocs.map((q) => [String(q._id), q]));

  const cards: FeedCard[] = scheduled.flatMap((s) => {
      const q = byId.get(s.questionId);
      if (!q) return [];
      return [
        {
          id: s.questionId,
          type: s.type,
          stem: String(q.stem),
          options: ((q.options as { id: string; text: string }[]) ?? []).map((o) => ({
            id: o.id,
            text: o.text,
          })),
          conceptId: s.conceptId,
          conceptName: conceptLabel(graphById.get(s.conceptId)?.name ?? s.conceptId),
          pool: s.pool,
        },
      ];
    });

  return { cards } satisfies FeedResponse;
}
