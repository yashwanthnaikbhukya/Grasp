import type { Concept, ConceptProposal } from '@grasp/schema';
import { collections } from '../db/collections';
import { embed } from '../llm/gateway';
import { generate } from '../llm/gateway';

/**
 * Concept resolution — the mechanism that lets the model author the graph while
 * keeping ids stable enough for evidence to accumulate.
 *
 * See docs/adr/0007-llm-authored-concept-graph.md for why both halves are
 * required. Short version: free-form tags cannot accumulate mastery, because two
 * providers will not agree on a slug and the learner ends up with two half-filled
 * rows for one concept.
 *
 * Hot path (`resolveExisting`) makes **no model call**.
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Cosine on `name + description` embeddings.
 *
 * Both directions of error are bad and they pull opposite ways:
 *   too low  → distinct concepts merge (`mean` swallows `median`)
 *   too high → one concept splits across near-duplicate ids, which is the exact
 *              failure this module exists to prevent
 *
 * So there are two thresholds and an uncertain band between them. Anything in the
 * band is flagged for review rather than auto-decided — silently guessing is how
 * a graph rots. Tune against a golden set, not by feel.
 */
export const MERGE_THRESHOLD = 0.9;
export const REVIEW_THRESHOLD = 0.82;

// ---------------------------------------------------------------------------
// In-memory graph cache
// ---------------------------------------------------------------------------

interface CachedConcept {
  _id: string;
  name: string;
  aliases: string[];
  subject: string;
  prereqIds: string[];
  embedding: number[];
}

let cache: { at: number; concepts: CachedConcept[] } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * The whole graph, in memory.
 *
 * A few hundred nodes at 768 floats is a few megabytes. Deliberately not an Atlas
 * vector index: M0 caps search indexes at a handful and `docChunks` already uses
 * two, exact cosine beats approximate nearest-neighbour on accuracy, and there is
 * no index to keep in sync. Revisit past ~20k concepts.
 */
export async function loadGraph(force = false): Promise<CachedConcept[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.concepts;

  const rows = await collections
    .concepts()
    .find(
      {},
      { projection: { _id: 1, name: 1, aliases: 1, subject: 1, prereqIds: 1, embedding: 1 } },
    )
    .toArray();

  const concepts = rows.map((r) => ({
    _id: String(r._id),
    name: String(r.name ?? ''),
    aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
    subject: String(r.subject ?? ''),
    prereqIds: Array.isArray(r.prereqIds) ? (r.prereqIds as string[]) : [],
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : [],
  }));

  cache = { at: Date.now(), concepts };
  return concepts;
}

export function invalidateGraphCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Pure helpers — unit-tested, no I/O
// ---------------------------------------------------------------------------

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Concept ids are readable slugs on purpose — they appear in traces and prompts. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return base || 'concept';
}

/** Append `-2`, `-3`… only on a genuine collision. */
export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 55)}-${Date.now().toString(36)}`;
}

/** Normalized form for alias matching — the high-precision dedupe fast path. */
export function normalizeAlias(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Would adding `from → to` (to depends on from) create a cycle?
 *
 * Model-generated edges will occasionally be circular. A cycle makes topological
 * depth undefined and sends frontier gating into an infinite walk, so it is
 * rejected at write time — a guarantee hand-authoring never actually provided.
 */
export function wouldCycle(
  edges: ReadonlyMap<string, readonly string[]>,
  child: string,
  newPrereq: string,
): boolean {
  if (child === newPrereq) return true;
  // Walk up from the proposed prerequisite; if we reach the child, it's a cycle.
  const seen = new Set<string>();
  const stack = [newPrereq];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined || seen.has(cur)) continue;
    seen.add(cur);
    if (cur === child) return true;
    for (const p of edges.get(cur) ?? []) stack.push(p);
  }
  return false;
}

/** Longest prerequisite chain. Assumes acyclic — call `wouldCycle` first. */
export function computeDepth(
  edges: ReadonlyMap<string, readonly string[]>,
  id: string,
  memo = new Map<string, number>(),
): number {
  const hit = memo.get(id);
  if (hit !== undefined) return hit;
  memo.set(id, 0); // cycle guard
  const prereqs = edges.get(id) ?? [];
  const d = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map((p) => computeDepth(edges, p, memo)));
  memo.set(id, d);
  return d;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type Match =
  | { kind: 'alias'; conceptId: string; score: 1 }
  | { kind: 'embedding'; conceptId: string; score: number }
  | { kind: 'review'; conceptId: string; score: number }
  | { kind: 'none' };

/**
 * Match a name (plus optional description) against the existing graph.
 * **No model call** — this is the hot path.
 */
export async function resolveExisting(
  name: string,
  descriptionEmbedding?: readonly number[],
  subject?: string,
  /**
   * Aliases the *proposal* supplied. Checking these against the graph is free,
   * high-precision signal that was previously thrown away: a model proposing
   * "Right triangle basics" will often list "right triangles: sides and naming"
   * among its aliases — the exact name of the node already in the graph.
   */
  incomingAliases: readonly string[] = [],
): Promise<Match> {
  const graph = await loadGraph();
  const scoped = subject ? graph.filter((c) => !c.subject || c.subject === subject) : graph;

  // 1. Exact match on any name/alias, in either direction. Higher precision than
  //    any similarity score, so it wins outright and costs nothing.
  const needles = new Set([name, ...incomingAliases].map(normalizeAlias).filter(Boolean));
  for (const c of scoped) {
    const theirs = [c.name, ...c.aliases].map(normalizeAlias);
    if (theirs.some((t) => needles.has(t))) {
      return { kind: 'alias', conceptId: c._id, score: 1 };
    }
  }

  if (!descriptionEmbedding || descriptionEmbedding.length === 0) return { kind: 'none' };

  // 2. Nearest neighbour by cosine.
  //
  // A concept row with no embedding is INVISIBLE here, which silently defeats
  // dedupe and lets a duplicate through. `pnpm concepts:calibrate` reports the
  // count; `pnpm concepts:embed` backfills them.
  let best: { id: string; score: number } | null = null;
  for (const c of scoped) {
    if (c.embedding.length === 0) continue;
    const score = cosine(descriptionEmbedding, c.embedding);
    if (!best || score > best.score) best = { id: c._id, score };
  }
  if (!best) return { kind: 'none' };

  if (best.score >= MERGE_THRESHOLD) {
    return { kind: 'embedding', conceptId: best.id, score: best.score };
  }
  if (best.score >= REVIEW_THRESHOLD) {
    // The uncertain band: too close to ignore, not close enough to merge.
    return { kind: 'review', conceptId: best.id, score: best.score };
  }
  return { kind: 'none' };
}

export interface ResolveResult {
  /** Stable ids for everything in the input, existing or newly created. */
  conceptIds: string[];
  createdIds: string[];
  /** Near-misses worth a human glance. Surfaced by `pnpm concepts:audit`. */
  flagged: { conceptId: string; against: string; score: number }[];
  /** Set when the provider chain was exhausted — retry this passage later. */
  deferred?: string;
}

/**
 * Resolve free text to stable concept ids, proposing and persisting new nodes
 * where the graph has a genuine gap.
 *
 * Intended to run in a **background job** (ingestion, Snap) — never in a
 * learner-facing request path, which should call `resolveExisting` and queue
 * anything unmatched.
 */
export async function resolveOrCreate(args: {
  text: string;
  subject: string;
  /** Where the text came from, recorded on any node created. */
  source?: string;
  /** Guards against a runaway prerequisite chain on one call. */
  maxNewConcepts?: number;
}): Promise<ResolveResult> {
  const maxNew = args.maxNewConcepts ?? 8;
  const out: ResolveResult = { conceptIds: [], createdIds: [], flagged: [] };

  /**
   * Runs in a background job, so an exhausted provider chain is a "try later",
   * not an error to propagate. Throwing here would fail a whole ingestion batch
   * because one passage hit a rate limit.
   */
  let proposal;
  try {
    proposal = await generate<ConceptProposal>({
      task: 'concept.propose',
      input: {
        text: args.text,
        subject: args.subject,
        knownConcepts: await knownNamesFor(args.subject),
      },
    });
  } catch (e) {
    out.deferred = e instanceof Error ? e.message : String(e);
    return out;
  }
  if (!proposal.data) return out;

  const taken = new Set((await loadGraph()).map((c) => c._id));
  const edges = new Map<string, readonly string[]>(
    (await loadGraph()).map((c) => [c._id, c.prereqIds]),
  );
  const pending: Concept[] = [];

  /**
   * A proposal batch routinely contains a concept AND its prerequisite — e.g.
   * "solving quadratics" alongside "the discriminant". Matching prerequisite names
   * only against the persisted graph loses those edges, leaving both as roots and
   * silently breaking frontier gating for the pair.
   */
  const proposedNames = new Map<string, string>(); // normalized name/alias → new id

  /** Resolve one name to an id, creating the node if the graph lacks it. */
  const resolveOne = async (
    name: string,
    body?: ConceptProposal['concepts'][number],
  ): Promise<string | null> => {
    const description = body?.description ?? name;
    const [vector] = (await embed({ texts: [`${name}. ${description}`], purpose: 'query' })).vectors;

    const match = await resolveExisting(name, vector, args.subject, body?.aliases ?? []);
    if (match.kind === 'alias' || match.kind === 'embedding') return match.conceptId;

    // Then against concepts proposed earlier in this same batch.
    const inBatch = proposedNames.get(normalizeAlias(name));
    if (inBatch) return inBatch;

    // No body means this came in as a bare prerequisite name. Don't invent a node
    // from a name alone — a stub with no description poisons future dedupe.
    if (!body) return null;
    if (out.createdIds.length + pending.length >= maxNew) return null;

    const id = uniqueSlug(name, taken);
    taken.add(id);

    const node: Concept = {
      _id: id,
      name,
      aliases: body.aliases,
      subject: body.subject || args.subject,
      domain: body.domain,
      prereqIds: [],
      description: body.description,
      objectives: body.objectives,
      stageRange: { min: Math.min(body.stageMin, body.stageMax), max: Math.max(body.stageMin, body.stageMax) },
      depth: 0,
      embedding: vector ?? [],
      origin: 'llm',
      proposedFrom: (args.source ?? args.text).slice(0, 400),
      generatedBy: {
        task: 'concept.propose',
        promptVersion: proposal.promptVersion,
        model: `${proposal.provider}/${proposal.model}`,
      },
      needsReview: match.kind === 'review',
      reviewNote:
        match.kind === 'review'
          ? `${match.score.toFixed(3)} similar to "${match.conceptId}" — same concept?`
          : '',
    };

    if (match.kind === 'review') {
      out.flagged.push({ conceptId: id, against: match.conceptId, score: match.score });
    }

    pending.push(node);
    edges.set(id, []);
    proposedNames.set(normalizeAlias(name), id);
    for (const alias of body.aliases) proposedNames.set(normalizeAlias(alias), id);
    return id;
  };

  // Two passes. Creating every node first means a prerequisite naming a sibling
  // resolves regardless of the order the model happened to list them in.
  const bodyById = new Map<string, ConceptProposal['concepts'][number]>();
  for (const body of proposal.data.concepts) {
    const id = await resolveOne(body.name, body);
    if (!id) continue;
    if (!out.conceptIds.includes(id)) out.conceptIds.push(id);
    bodyById.set(id, body);
  }

  for (const [id, body] of bodyById) {
    const created = pending.find((p) => p._id === id);
    // Existing concepts keep the edges they already have — a single passage is
    // not evidence enough to rewire the established graph.
    if (!created) continue;

    for (const prereqName of body.prerequisiteNames) {
      // Unmatched names are dropped rather than stubbed: a description-less node
      // corrupts every future dedupe against it, which is worse than a missing edge.
      const prereqId = await resolveOne(prereqName, undefined);
      if (!prereqId || prereqId === id) continue;
      if (wouldCycle(edges, id, prereqId)) continue;
      if (!created.prereqIds.includes(prereqId)) {
        created.prereqIds.push(prereqId);
        edges.set(id, created.prereqIds);
      }
    }
  }

  if (pending.length > 0) {
    for (const node of pending) node.depth = computeDepth(edges, node._id);
    await collections.concepts().insertMany(pending as never[], { ordered: false });
    out.createdIds = pending.map((p) => p._id);
    invalidateGraphCache();
  }

  return out;
}

/** Names + aliases already known, so the model proposes gaps rather than repeats. */
async function knownNamesFor(subject: string): Promise<string> {
  const graph = await loadGraph();
  const scoped = graph.filter((c) => !c.subject || c.subject === subject);
  if (scoped.length === 0) return '(the graph is empty — this is the first pass)';
  return scoped
    .map((c) => (c.aliases.length > 0 ? `${c._id}: ${c.name} (${c.aliases.join(', ')})` : `${c._id}: ${c.name}`))
    .join('\n');
}
