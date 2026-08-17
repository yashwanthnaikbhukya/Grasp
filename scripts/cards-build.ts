/**
 * `pnpm cards:build [--per-chunk=2] [--limit=4]`
 *
 * Generates practice questions from ingested chunks and runs each through
 * verification. Only `verified` items are ever served, so this is the step that
 * decides how much of Reps actually works.
 *
 * Slow on free tiers — three model calls per question (one generate, two
 * independent solves) plus throttling. That is the cost of not shipping broken
 * questions, and it runs offline as a background job in production.
 */
import './load-env';
import { closeMongo, collections, env, generateAndVerify } from '@grasp/core';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

const args = process.argv.slice(2);
const num = (name: string, dflt: number) =>
  Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt);

const perChunk = num('per-chunk', 2);
const limit = num('limit', 4);
const THROTTLE_MS = 2_000;

if (!env.mongo.uri) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

// Chunks that carry a concept tag — an untagged chunk would produce questions
// that cannot reach the feed, since the scheduler works in concept space.
const chunks = await collections
  .docChunks()
  .find({ ownerScope: 'global', conceptIds: { $exists: true, $ne: [] } } as never)
  .limit(limit)
  .toArray();

if (chunks.length === 0) {
  console.error('\nNo tagged chunks. Run `pnpm ingest --all` first.\n');
  process.exit(1);
}

console.log(
  `\n${BOLD}Building question bank${OFF} ${DIM}${chunks.length} chunks × ${perChunk} questions${OFF}`,
);
console.log(`${DIM}generate → structural check → solve twice independently → judge${OFF}\n`);

const totals = { generated: 0, verified: 0, quarantined: 0, rejected: 0, deferred: 0 };

for (const [i, chunk] of chunks.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS));

  const heading = Array.isArray(chunk.headingPath)
    ? (chunk.headingPath as string[]).slice(-1)[0]
    : '';
  console.log(`${BOLD}${heading || `chunk ${i + 1}`}${OFF}`);

  const r = await generateAndVerify({
    text: String(chunk.text),
    conceptIds: (chunk.conceptIds as string[]) ?? [],
    stageRange: (chunk.stageRange as { min: number; max: number } | null) ?? null,
    curriculumIds: (chunk.curriculumIds as string[]) ?? [],
    subject: String(chunk.subject ?? env.seed.subject),
    sourceId: chunk.sourceId ? String(chunk.sourceId) : undefined,
    count: perChunk,
    onProgress: (m) => console.log(`${DIM}${m}${OFF}`),
  });

  totals.generated += r.generated;
  totals.verified += r.verified;
  totals.quarantined += r.quarantined;
  totals.rejected += r.rejected;
  if (r.deferred) totals.deferred++;

  if (r.deferred) console.log(`  ${YELLOW}deferred — providers exhausted${OFF}`);
  console.log('');
}

const servable = await collections
  .questions()
  .countDocuments({ verificationStatus: 'verified' } as never);

console.log(`${BOLD}Result${OFF}`);
console.log(`  ${GREEN}${totals.verified} verified${OFF} ${DIM}(servable)${OFF}`);
console.log(`  ${YELLOW}${totals.quarantined} quarantined${OFF} ${DIM}(disputed — needs a human)${OFF}`);
console.log(`  ${RED}${totals.rejected} rejected${OFF} ${DIM}(structurally broken)${OFF}`);
if (totals.deferred > 0) console.log(`  ${DIM}${totals.deferred} chunks deferred on rate limits${OFF}`);

const rate = totals.generated > 0 ? totals.verified / totals.generated : 0;
console.log(`\n  ${DIM}pass rate ${(rate * 100).toFixed(0)}% · ${servable} verified questions in the bank${OFF}`);

if (rate < 0.5 && totals.generated > 2) {
  console.log(
    `\n${YELLOW}Under half are passing.${OFF} ${DIM}That is the generator, not the checker —\n` +
      `read the quarantine reasons and tighten card.generate rather than loosening\n` +
      `the bar. A false verify reaches a learner; a false quarantine costs one question.${OFF}`,
  );
}
console.log('');

await closeMongo();
