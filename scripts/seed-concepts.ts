/**
 * `pnpm db:seed:concepts`
 *
 * Loads `data/concepts.seed.json` into the `concepts` collection, validates the
 * prerequisite graph, and computes topological depth.
 *
 * The concept graph is authored by hand from the syllabus — see
 * docs/07-phases.md § 0.2. Two days of work that pays for itself for the rest of
 * the project: it drives retrieval scoping, frontier gating, gap detection, and
 * the Map surface.
 */
import './load-env';
import { readFile } from 'node:fs/promises';
import { ConceptSeedSchema } from '@grasp/schema';
import { closeMongo, collections, env } from '@grasp/core';

const SEED_PATH = new URL('../data/concepts.seed.json', import.meta.url);

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

let raw: string;
try {
  raw = await readFile(SEED_PATH, 'utf8');
} catch {
  console.error(
    `${RED}No data/concepts.seed.json.${OFF}\n\n` +
      `This file is the Phase 0 deliverable — 150–300 concept nodes with prereqIds,\n` +
      `authored from your syllabus. A starter template is committed at\n` +
      `data/concepts.seed.example.json — copy it and fill it in.\n\n` +
      `See docs/07-phases.md § 0.2\n`,
  );
  process.exit(1);
}

const seed = ConceptSeedSchema.parse(JSON.parse(raw));
const ids = new Set(seed.concepts.map((c) => c._id));

// ---- Validate the graph before writing anything ---------------------------

const dangling: string[] = [];
for (const c of seed.concepts) {
  for (const p of c.prereqIds) {
    if (!ids.has(p)) dangling.push(`${c._id} → ${p}`);
  }
}
if (dangling.length > 0) {
  console.error(`${RED}Dangling prerequisite references:${OFF}`);
  for (const d of dangling) console.error(`  ${d}`);
  process.exit(1);
}

/** Depth = longest prerequisite chain. Also detects cycles. */
function computeDepths(): Map<string, number> {
  const byId = new Map(seed.concepts.map((c) => [c._id, c]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const walk = (id: string, trail: string[]): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;

    if (visiting.has(id)) {
      console.error(`${RED}Prerequisite cycle:${OFF} ${[...trail, id].join(' → ')}`);
      process.exit(1);
    }
    visiting.add(id);

    const node = byId.get(id);
    const prereqs = node?.prereqIds ?? [];
    const d = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map((p) => walk(p, [...trail, id])));

    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  for (const c of seed.concepts) walk(c._id, []);
  return depth;
}

const depths = computeDepths();

// ---- Write ---------------------------------------------------------------

const scope = seed.scope;
if (
  scope.board !== env.scope.board ||
  scope.grade !== env.scope.grade ||
  scope.subject !== env.scope.subject
) {
  console.log(
    `${DIM}note: seed scope (${scope.board}/${scope.grade}/${scope.subject}) differs from ` +
      `env scope (${env.scope.board}/${env.scope.grade}/${env.scope.subject}). Using the seed's.${OFF}\n`,
  );
}

const ops = seed.concepts.map((c) => ({
  updateOne: {
    filter: { _id: c._id },
    update: {
      $set: {
        ...c,
        board: scope.board,
        grade: scope.grade,
        subject: scope.subject,
        depth: c.depth ?? depths.get(c._id) ?? 0,
      },
    },
    upsert: true,
  },
}));

const res = await collections.concepts().bulkWrite(ops as never);

const roots = seed.concepts.filter((c) => c.prereqIds.length === 0).length;
const maxDepth = Math.max(...depths.values());

console.log(`${GREEN}✓${OFF} ${BOLD}${seed.concepts.length} concepts${OFF} loaded`);
console.log(`  ${DIM}upserted ${res.upsertedCount} · modified ${res.modifiedCount}${OFF}`);
console.log(`  ${DIM}${roots} root concepts (no prerequisites) · max chain depth ${maxDepth}${OFF}`);

if (seed.concepts.length < 100) {
  console.log(
    `\n${DIM}Target for the POC is 150–300 nodes. Fewer than ~100 and the frontier\n` +
      `gating and gap detection have too little structure to be useful.${OFF}`,
  );
}

await closeMongo();
