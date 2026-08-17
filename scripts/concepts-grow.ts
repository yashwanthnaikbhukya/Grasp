/**
 * `pnpm concepts:grow "<passage>"`  ·  `pnpm concepts:grow --demo`
 *
 * Feeds a passage through concept resolution: the model proposes what's missing,
 * it's deduped against the existing graph, prerequisites are resolved and
 * cycle-checked, and new nodes are persisted with stable ids.
 *
 * This is the mechanism that replaces hand-authoring — see
 * docs/adr/0007-llm-authored-concept-graph.md. In production this runs inside the
 * ingestion job; here it's the same code path, driven by hand so you can watch it
 * and check its judgement.
 */
import './load-env';
import {
  closeMongo,
  collections,
  env,
  invalidateGraphCache,
  loadGraph,
  MERGE_THRESHOLD,
  REVIEW_THRESHOLD,
  resolveOrCreate,
} from '@grasp/core';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

/**
 * Deliberately chosen so the run exercises both halves of dedupe:
 * passage 1 covers ground the seeded graph already has (should mostly reuse),
 * passage 2 is adjacent-but-new (should mostly create),
 * passage 3 repeats passage 1's subject in different words (should reuse, and is
 * the real test — this is where a naive implementation duplicates).
 */
const DEMO = [
  `Sine and cosine of an acute angle are defined as ratios of sides in a right
   triangle: sine is opposite over hypotenuse, cosine is adjacent over hypotenuse.
   Applying Pythagoras' theorem to these definitions gives sin²θ + cos²θ = 1.`,

  `A quadratic equation ax² + bx + c = 0 can be solved by completing the square,
   which yields the quadratic formula. The discriminant b² − 4ac determines whether
   the roots are real and distinct, real and equal, or complex.`,

  `The fundamental trigonometric identity states that for any angle, the square of
   its sine added to the square of its cosine equals one. It follows directly from
   the Pythagorean theorem applied to the unit circle.`,
];

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const passages = demo ? DEMO : [args.filter((a) => !a.startsWith('--')).join(' ')];

if (!demo && !passages[0]) {
  console.error(
    `\nUsage:\n  pnpm concepts:grow --demo\n  pnpm concepts:grow "a passage of study material"\n`,
  );
  process.exit(1);
}

if (!env.mongo.uri) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

console.log(`\n${BOLD}Concept graph growth${OFF} ${DIM}(model proposes · dedupe decides)${OFF}`);
console.log(
  `${DIM}merge above ${MERGE_THRESHOLD} · flag for review ${REVIEW_THRESHOLD}–${MERGE_THRESHOLD}${OFF}\n`,
);

const before = await loadGraph(true);
console.log(`${DIM}graph before: ${before.length} concepts${OFF}\n`);

let totalCreated = 0;
let totalReused = 0;

/**
 * Free tiers are rate-limited per minute and a batch will hit them. Pausing
 * between passages is cheaper than burning both providers' quota and then having
 * nothing left to fall back to.
 */
const THROTTLE_MS = 2_500;

for (const [i, raw] of passages.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS));
  const text = raw.replace(/\s+/g, ' ').trim();
  console.log(`${BOLD}Passage ${i + 1}${OFF} ${DIM}${text.slice(0, 74)}…${OFF}`);

  const t0 = Date.now();
  const r = await resolveOrCreate({
    text,
    subject: env.seed.subject,
    source: `concepts:grow passage ${i + 1}`,
  });
  const ms = Date.now() - t0;

  if (r.deferred) {
    console.log(`  ${YELLOW}deferred${OFF} ${DIM}${r.deferred}${OFF}`);
    console.log(`  ${DIM}providers exhausted — this passage retries on the next run${OFF}\n`);
    continue;
  }

  const reused = r.conceptIds.filter((id) => !r.createdIds.includes(id));
  totalCreated += r.createdIds.length;
  totalReused += reused.length;

  for (const id of reused) console.log(`  ${CYAN}reused ${OFF} ${id}`);
  for (const id of r.createdIds) {
    const node = await collections.concepts().findOne({ _id: id as never });
    const prereqs = Array.isArray(node?.prereqIds) ? (node.prereqIds as string[]) : [];
    const range = node?.stageRange as { min: number; max: number } | null | undefined;
    console.log(
      `  ${GREEN}created${OFF} ${id}` +
        `${DIM}  stage ${range ? `${range.min}–${range.max}` : '?'}` +
        `  depth ${node?.depth ?? '?'}` +
        `${prereqs.length ? `  ← ${prereqs.join(', ')}` : '  (root)'}${OFF}`,
    );
    if (Array.isArray(node?.aliases) && node.aliases.length > 0) {
      console.log(`          ${DIM}aliases: ${(node.aliases as string[]).join(', ')}${OFF}`);
    }
  }
  for (const f of r.flagged) {
    console.log(
      `  ${YELLOW}review ${OFF} ${f.conceptId} ${DIM}~${f.score.toFixed(3)} vs ${f.against}${OFF}`,
    );
  }
  if (r.conceptIds.length === 0) {
    console.log(`  ${DIM}nothing new — the graph already covers this${OFF}`);
  }
  console.log(`  ${DIM}${ms} ms${OFF}\n`);
}

invalidateGraphCache();
const after = await loadGraph(true);

console.log(`${BOLD}Result${OFF}`);
console.log(`  ${DIM}graph: ${before.length} → ${after.length} concepts${OFF}`);
console.log(`  ${DIM}${totalCreated} created · ${totalReused} reused${OFF}`);

const flagged = await collections.concepts().countDocuments({ needsReview: true });
if (flagged > 0) {
  console.log(
    `  ${YELLOW}${flagged} flagged for review${OFF} ${DIM}— near-duplicates the resolver` +
      ` would not auto-merge${OFF}`,
  );
}

if (demo) {
  console.log(
    `\n${DIM}Passage 3 restated passage 1's concept in different words. If it reused\n` +
      `rather than created, dedupe is doing its job — that reuse is what keeps a\n` +
      `learner's mastery accumulating under one id instead of splitting in half.${OFF}`,
  );
}
console.log('');

await closeMongo();
