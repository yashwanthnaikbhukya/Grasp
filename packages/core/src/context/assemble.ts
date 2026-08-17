import type { Intent, LearnerProfile, QueryUnderstanding } from '@grasp/schema';
import { collections } from '../db/collections';
import { generate } from '../llm/gateway';
import { loadGraph } from '../concepts/resolve';
import { retrieve, type RetrievedChunk } from '../retrieval/retrieve';
import { estimateTokens } from '../ingest/chunk';
import { allocateBudget, BUDGETS, fitItems, type Component } from './budget';
import { buildLearnerCard, type MasteryLine } from './learner-card';

/**
 * The context broker.
 *
 * The only component that knows how to turn a query, a corpus and a learner into
 * a prompt. Six steps, in order, per docs/05-context-broker.md.
 */

export interface AssembleArgs {
  userId: string;
  sessionId?: string;
  query: string;
  profile: LearnerProfile;
  /** Most recent first is NOT expected — pass in chronological order. */
  history?: { role: 'user' | 'assistant'; text: string }[];
  digest?: string;
  surface?: 'ask' | 'snap' | 'reps';
  signal?: AbortSignal;
}

export interface ContextBundle {
  bundleId: string;
  intent: Intent;
  rewrittenQuery: string;
  conceptIds: string[];
  needsClarification: boolean;

  learnerCard: string;
  history: { role: 'user' | 'assistant'; text: string }[];
  digest?: string;
  retrieved: { citeId: string; chunkId: string; headingPath: string[]; text: string }[];

  budget: {
    granted: Record<Component, number>;
    used: Record<Component, number>;
    shed: Component[];
    totalUsed: number;
  };
  /** citeId → chunkId. Used to verify citations after generation. */
  citeMap: Record<string, string>;
  timings: { understand: number; retrieve: number; total: number };
  retrievalLegs: { lexical: string; vector: string };
}

/** Verbatim turns kept before the digest takes over. */
const VERBATIM_TURNS = 6;

export async function assemble(args: AssembleArgs): Promise<ContextBundle> {
  const t0 = Date.now();
  const history = args.history ?? [];

  // --- 1. Understand the query before retrieving anything ------------------
  // The step most RAG systems skip, and the reason they work on turn one and
  // break on turn two. One cheap call: rewrite, tag concepts, classify intent.
  const tUnderstand = Date.now();
  const graph = await loadGraph();
  const catalogue = graph
    .slice(0, 200)
    .map((c) => (c.aliases.length ? `${c._id} (${c.aliases.slice(0, 3).join(', ')})` : c._id))
    .join('\n');

  let understanding: QueryUnderstanding = {
    rewritten: args.query,
    conceptIds: [],
    intent: 'explain',
    needsClarification: false,
  };

  try {
    const res = await generate<QueryUnderstanding>({
      task: 'query.understand',
      input: {
        query: args.query,
        history: history.slice(-4),
        conceptCatalog: catalogue || '(the graph is empty)',
      },
      userId: args.userId,
      signal: args.signal,
    });
    if (res.data) understanding = res.data;
  } catch {
    // A failed rewrite degrades follow-ups but must never block an answer —
    // the raw query is a workable fallback.
  }
  const understandMs = Date.now() - tUnderstand;

  const profile = BUDGETS[understanding.intent] ?? BUDGETS.explain;

  // --- 2 + 4. Retrieve (skipped entirely for chitchat) ---------------------
  const tRetrieve = Date.now();
  let chunks: RetrievedChunk[] = [];
  let legs = { lexical: 'skipped', vector: 'skipped' };

  if (profile.allocated.retrieved > 0) {
    const r = await retrieve({
      query: understanding.rewritten,
      conceptIds: understanding.conceptIds,
      profile: args.profile,
      userId: args.userId,
      sessionId: args.sessionId,
      topK: 6,
    });
    chunks = r.chunks;
    legs = r.legs;
  }
  const retrieveMs = Date.now() - tRetrieve;

  // --- 5. The learner card -------------------------------------------------
  // Only concepts this query touches — never the whole mastery table.
  const relevantConcepts = [
    ...new Set([...understanding.conceptIds, ...chunks.flatMap((c) => c.conceptIds)]),
  ].slice(0, 8);

  const [masteryRows, misconceptionRows, curriculumRows] = await Promise.all([
    relevantConcepts.length > 0
      ? collections
          .mastery()
          .find({ userId: args.userId, conceptId: { $in: relevantConcepts } } as never)
          .toArray()
      : Promise.resolve([]),
    collections
      .misconceptions()
      .find({ userId: args.userId, resolvedAt: null } as never)
      .limit(4)
      .toArray(),
    args.profile.curriculumIds.length > 0
      ? collections
          .curricula()
          .find({ _id: { $in: args.profile.curriculumIds } } as never)
          .toArray()
      : Promise.resolve([]),
  ]);

  const byId = new Map(graph.map((c) => [c._id, c]));
  const masteryById = new Map(masteryRows.map((m) => [String(m.conceptId), m]));

  // A prerequisite the learner is weak on is the most actionable fact the card
  // can carry, so it is computed rather than left for the model to infer.
  const prerequisiteGaps = new Set<string>();
  for (const conceptId of relevantConcepts) {
    for (const prereq of byId.get(conceptId)?.prereqIds ?? []) {
      const m = masteryById.get(prereq);
      if (!m || Number(m.p ?? 0) < 0.5) prerequisiteGaps.add(prereq);
    }
  }

  const masteryLines: MasteryLine[] = [
    ...relevantConcepts,
    ...[...prerequisiteGaps].slice(0, 3),
  ].flatMap((conceptId) => {
    const m = masteryById.get(conceptId);
    const node = byId.get(conceptId);
    if (!m && !prerequisiteGaps.has(conceptId)) return [];
    return [
      {
        conceptId,
        name: node?.name ?? conceptId,
        p: Number(m?.p ?? 0),
        state: (m?.state ?? 'unseen') as MasteryLine['state'],
        lastSeenAt: (m?.lastSeenAt as Date | undefined) ?? null,
        isPrerequisiteGap: prerequisiteGaps.has(conceptId),
      },
    ];
  });

  const notation = (curriculumRows[0] as { notation?: Record<string, string> } | undefined)
    ?.notation;

  const learnerCard = buildLearnerCard({
    profile: args.profile,
    mastery: masteryLines,
    misconceptions: misconceptionRows.map((m) => ({
      statement: String(m.statement),
      evidenceCount: Number(m.evidenceCount ?? 1),
      lastSeenAt: m.lastSeenAt as Date | undefined,
    })),
    curriculumNames: curriculumRows.map((c) => String((c as { name?: unknown }).name ?? '')),
    notation,
  });

  // --- 3. Compact history, then fit everything to budget -------------------
  const verbatim = history.slice(-VERBATIM_TURNS);

  const allocation = allocateBudget(profile, {
    system: 1_000,
    learnerCard: estimateTokens(learnerCard),
    retrieved: chunks.reduce((n, c) => n + c.tokenCount, 0),
    history: verbatim.reduce((n, h) => n + estimateTokens(h.text), 0),
    attachments: 0,
  });

  const keptChunks = fitItems(chunks, allocation.granted.retrieved, (c) => c.tokenCount).kept;
  const keptHistory = fitItems(
    [...verbatim].reverse(),
    allocation.granted.history,
    (h) => estimateTokens(h.text),
  ).kept.reverse();

  // --- 6. Stamp citation ids ----------------------------------------------
  const citeMap: Record<string, string> = {};
  const retrieved = keptChunks.map((c, i) => {
    const citeId = `c${i + 1}`;
    citeMap[citeId] = c.chunkId;
    return { citeId, chunkId: c.chunkId, headingPath: c.headingPath, text: c.text };
  });

  return {
    bundleId: `b_${Date.now().toString(36)}`,
    intent: understanding.intent,
    rewrittenQuery: understanding.rewritten,
    conceptIds: understanding.conceptIds,
    needsClarification: understanding.needsClarification,
    learnerCard,
    history: keptHistory,
    digest: args.digest,
    retrieved,
    budget: {
      granted: allocation.granted,
      used: allocation.used,
      shed: allocation.shed,
      totalUsed: allocation.totalUsed,
    },
    citeMap,
    timings: { understand: understandMs, retrieve: retrieveMs, total: Date.now() - t0 },
    retrievalLegs: legs,
  };
}

/**
 * Check the citations a response actually made.
 *
 * Two flags, and their combined rate is the hallucination metric — it costs
 * nothing and it is the only way to know whether retrieval is working.
 */
export function verifyCitations(
  text: string,
  citeMap: Record<string, string>,
): { cited: string[]; fabricated: string[]; ungrounded: boolean } {
  const found = [...text.matchAll(/\[(c\d+)\]/g)].map((m) => m[1] ?? '');
  const unique = [...new Set(found)];

  const cited = unique.filter((id) => id in citeMap);
  const fabricated = unique.filter((id) => !(id in citeMap));

  // Only counts as ungrounded if there was something to cite in the first place.
  const ungrounded = cited.length === 0 && Object.keys(citeMap).length > 0 && text.length > 200;

  return { cited, fabricated, ungrounded };
}
