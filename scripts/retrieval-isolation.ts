/**
 * `pnpm retrieval:isolation`
 *
 * The Gate H retrieval check (docs/07-phases.md § H.2): with ~1,000 chunks that
 * belong to *another* learner present — exact copies of the global corpus, the
 * strongest possible competitors — a learner's own results must not change.
 *
 *   1. baseline: run the 20-question eval set, record top-5 per question
 *   2. insert copies of every global chunk as another user's uploads
 *   3. re-run: every result must be identical, and no foreign chunk may appear
 *   4. delete the copies (always — even when a check fails)
 *
 * Before the scope filter moved inside the search, the copies would have filled
 * the top-20 candidate slots and the post-search `$match` would have thrown them
 * away, leaving the learner with nothing.
 */
import './load-env';
import { randomBytes } from 'node:crypto';
import { closeMongo, collections, retrieve } from '@grasp/core';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

const QUESTIONS = [
  'why is sin never more than 1',
  'what is the pythagorean identity',
  'sin 45 degrees exact value',
  'angles of elevation and depression',
  'how do I prove a trig identity',
  'reciprocal ratios',
  'find cos if sin is 3/5',
  'height of a tower from two angles',
];

const MARK = 'retrieval-isolation';
/** A 24-hex id, like an ObjectId string — this script never needs the driver. */
const hexId = () => randomBytes(12).toString('hex');
const FOREIGN_USER = hexId();
const LEARNER = { curriculumIds: ['in-cbse-secondary-math'], subjects: ['mathematics'] };
const learnerId = hexId();

async function topFive(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const q of QUESTIONS) {
    const r = await retrieve({ query: q, profile: LEARNER, userId: learnerId, topK: 5 });
    out.set(q, r.chunks.map((c) => c.chunkId));
  }
  return out;
}

const globals = await collections
  .docChunks()
  .find({ ownerScope: 'global' } as never)
  .toArray();
if (globals.length === 0) {
  console.error('No global chunks — ingest something first.');
  process.exit(1);
}

console.log(`\n${BOLD}Retrieval isolation${OFF} ${DIM}${globals.length} global chunks${OFF}\n`);
const before = await topFive();

const copies = Math.ceil(1000 / globals.length);
const foreign = Array.from({ length: copies }).flatMap(() =>
  globals.map((g) => {
    const { _id, ...rest } = g as Record<string, unknown>;
    void _id;
    return { ...rest, ownerScope: 'user', ownerId: FOREIGN_USER, syntheticTest: MARK };
  }),
);

let failed = false;
try {
  await collections.docChunks().insertMany(foreign as never[], { ordered: false });
  console.log(`${DIM}Inserted ${foreign.length} foreign-user copies. Waiting for the search indexes to see them…${OFF}`);
  // Atlas Search is eventually consistent; give it time to index the copies so
  // the test exercises them rather than an index that hasn't caught up.
  await new Promise((r) => setTimeout(r, 20_000));

  const after = await topFive();
  const foreignIds = new Set(
    (
      await collections
        .docChunks()
        .find({ syntheticTest: MARK } as never, { projection: { _id: 1 } })
        .toArray()
    ).map((d) => String(d._id)),
  );

  for (const q of QUESTIONS) {
    const a = before.get(q) ?? [];
    const b = after.get(q) ?? [];
    const leaked = b.filter((id) => foreignIds.has(id));
    const same = a.length === b.length && a.every((id, i) => id === b[i]);
    if (leaked.length > 0 || !same) failed = true;
    console.log(
      `  ${leaked.length === 0 && same ? `${GREEN}✓` : `${RED}✗`}${OFF} ${q.padEnd(40)} ` +
        `${DIM}top-5 ${same ? 'unchanged' : 'CHANGED'} · foreign ${leaked.length}${OFF}`,
    );
  }
} finally {
  const del = await collections.docChunks().deleteMany({ syntheticTest: MARK } as never);
  console.log(`\n${DIM}Cleaned up ${del.deletedCount} synthetic chunks.${OFF}`);
}

console.log(
  failed
    ? `\n${RED}${BOLD}FAIL${OFF} — another learner's chunks changed or entered these results.\n`
    : `\n${GREEN}${BOLD}PASS${OFF} — ${foreign.length} foreign chunks present, every result unchanged, none leaked.\n`,
);
await closeMongo();
process.exit(failed ? 1 : 0);
