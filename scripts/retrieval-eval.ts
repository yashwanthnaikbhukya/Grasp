/**
 * `pnpm retrieval:eval`
 *
 * Twenty real student questions against the ingested corpus, scored on whether
 * the chunk that answers them lands in the top 5.
 *
 * `recall@5` is the number to move when tuning retrieval, and it should be moved
 * *before* anyone touches a prompt — retrieval quality dominates prompt quality
 * here, and a prompt tuned against bad retrieval bakes in the wrong compensation.
 */
import './load-env';
import { closeMongo, env, retrieve } from '@grasp/core';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

/**
 * Each case names a phrase that MUST appear in a retrieved chunk for the answer
 * to be gettable. Deliberately phrased the way a student would type — including
 * the vague ones, because those are where retrieval actually breaks.
 */
const CASES: { q: string; expect: RegExp; note?: string }[] = [
  { q: 'what is sin cos tan', expect: /opposite|hypotenuse/i },
  { q: 'prove sin^2 + cos^2 = 1', expect: /Divide every term|sin\^2\\?theta \+ \\?cos/i },
  { q: 'why is sine never more than 1', expect: /longest side|between 0 and 1/i },
  { q: 'what does SOH CAH TOA mean', expect: /SOH CAH TOA/i },
  { q: 'value of sin 30', expect: /equilateral|30°|\\tfrac\{1\}\{2\}/i },
  { q: 'difference between cosec and csc', expect: /Commonwealth|cosec/i },
  { q: 'how do I prove a trig identity', expect: /one side only|more complicated side/i },
  { q: 'angle of elevation vs depression', expect: /elevation|depression/i },
  { q: 'tower problem with two angles', expect: /two triangles|40 metres|shared side/i },
  { q: 'what is the hypotenuse', expect: /opposite the right angle/i },
  { q: 'sec and tan identity', expect: /tan\^2|sec\^2/i },
  { q: 'why do opposite and adjacent swap', expect: /swap over|reference angle/i },
  { q: 'sin 45 degrees exact value', expect: /sqrt2|45/i },
  { q: 'cos theta = sin 90 minus theta', expect: /cofunction|read backwards|90° - \\?theta/i },
  { q: 'is sin theta squared the same as sin of theta squared', expect: /genuine error|\(\\?sin\\?theta\)\^2/i },
  { q: 'why can I not square both sides when proving', expect: /circular|both sides/i },
  { q: 'what happens to tan at 90 degrees', expect: /undefined|dividing by zero/i },
  { q: 'similar triangles and trig ratios', expect: /similar|proportion/i },
  { q: 'find cos if sin is 3/5', expect: /3\/5|4\/5|16\/25/i },
  { q: 'reciprocal ratios', expect: /reciprocal/i },
];

if (!env.mongo.uri) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

console.log(`\n${BOLD}Retrieval eval${OFF} ${DIM}${CASES.length} student questions · recall@5${OFF}\n`);

let hits = 0;
let atRank1 = 0;
let totalMs = 0;
const misses: string[] = [];
let legs = { lexical: '', vector: '' };

for (const c of CASES) {
  const r = await retrieve({ query: c.q, topK: 5 });
  totalMs += r.latencyMs;
  legs = r.legs;

  const rank = r.chunks.findIndex((ch) => c.expect.test(ch.text));
  const hit = rank >= 0;
  if (hit) {
    hits++;
    if (rank === 0) atRank1++;
  } else {
    misses.push(c.q);
  }

  const mark = hit ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`;
  const where = hit ? `${DIM}rank ${rank + 1}${OFF}` : `${RED}not in top 5${OFF}`;
  const top = r.chunks[0]?.headingPath.slice(-1)[0] ?? '—';
  console.log(`  ${mark} ${c.q.padEnd(46)} ${where.padEnd(22)} ${DIM}top: ${top}${OFF}`);
}

const recall = hits / CASES.length;
const precision1 = atRank1 / CASES.length;

console.log(`\n${BOLD}recall@5  ${(recall * 100).toFixed(0)}%${OFF}  ${DIM}(${hits}/${CASES.length})${OFF}`);
console.log(`${DIM}rank-1 hit rate ${(precision1 * 100).toFixed(0)}% · ${Math.round(totalMs / CASES.length)} ms avg${OFF}`);
console.log(`${DIM}legs: lexical=${legs.lexical} vector=${legs.vector}${OFF}`);

if (legs.lexical === 'fallback' || legs.vector === 'fallback') {
  console.log(
    `\n${YELLOW}Running on the in-memory fallback.${OFF} ${DIM}Works, and is O(corpus) —\n` +
      `fine now, wrong at scale. Create the Atlas Search indexes to switch legs:\n` +
      `pnpm db:indexes prints the JSON. docs/08-setup.md § 5${OFF}`,
  );
}

if (misses.length > 0) {
  console.log(`\n${DIM}Missed:${OFF}`);
  for (const m of misses) console.log(`  ${DIM}· ${m}${OFF}`);
  console.log(
    `\n${DIM}A miss is usually chunking, not ranking — check whether the answering\n` +
      `passage got split away from the terms the student would use.${OFF}`,
  );
}
console.log('');

await closeMongo();
process.exit(recall >= 0.7 ? 0 : 1);
