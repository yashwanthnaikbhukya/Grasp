import { NextResponse } from 'next/server';
import {
  collections,
  composeFeed,
  currentP,
  DEFAULT_FEED,
  loadGraph,
  oid,
  type CandidateCard,
  type ConceptState,
} from '@grasp/core';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The Reps feed.
 *
 * **No model call on this path.** Cards are pre-generated and verified offline;
 * this only selects and orders them. If a swipe ever waits on a model, that is a
 * bug — see CLAUDE.md rule 5.
 *
 * Answers are deliberately withheld: the client receives options but never which
 * one is correct, so a learner reading the network tab cannot cheat and, more
 * usefully, grading stays server-side where the attempt can be recorded honestly.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const count = Math.min(Number(new URL(req.url).searchParams.get('count') ?? 12), 30);

  // Only verified questions are servable — enforced in the query, not by
  // convention, so no call site can forget.
  const questionDocs = await collections
    .questions()
    .find(
      {
        verificationStatus: 'verified',
        ...(session.profile.subjects.length > 0
          ? { subject: { $in: session.profile.subjects } }
          : {}),
      } as never,
      { projection: { stem: 0, solution: 0, answer: 0 } },
    )
    .limit(500)
    .toArray();

  if (questionDocs.length === 0) {
    return NextResponse.json({
      cards: [],
      empty: 'no-questions',
      message:
        'No practice questions have been built for your subjects yet. Run `pnpm cards:build`.',
    });
  }

  const graph = await loadGraph();
  const graphById = new Map(graph.map((c) => [c._id, c]));

  const masteryDocs = await session.scope.mastery().find({}).toArray();
  const masteryById = new Map(masteryDocs.map((m) => [String(m.conceptId), m]));

  const now = new Date();

  // A concept the learner has never touched still needs a state row for the
  // scheduler, or the frontier pool would always be empty on day one.
  const conceptIds = [
    ...new Set(questionDocs.flatMap((q) => (q.conceptIds as string[]) ?? [])),
  ];

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
          state: (m.state as ConceptState['state']) ?? 'learning',
        },
        now,
      ),
      nextDueAt: (m.nextDueAt as Date) ?? now,
      prereqIds: node?.prereqIds ?? [],
    };
  });

  const candidates: CandidateCard[] = questionDocs.flatMap((q) => {
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

  // Hydrate only what the client may see. The answer key stays on the server.
  //
  // `_id` is an ObjectId and the scheduler works in strings, so the conversion
  // is required — a `$in` of strings against ObjectIds matches nothing and
  // silently returns an empty feed while every layer above looks healthy.
  const full = await collections
    .questions()
    .find({ _id: { $in: scheduled.flatMap((s) => oid(s.questionId) ?? []) } } as never)
    .toArray();
  const byId = new Map(full.map((q) => [String(q._id), q]));

  return NextResponse.json({
    cards: scheduled.flatMap((s) => {
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
          conceptName: graphById.get(s.conceptId)?.name ?? s.conceptId,
          pool: s.pool,
        },
      ];
    }),
  });
}
