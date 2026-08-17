/**
 * `pnpm concepts:calibrate`
 *
 * Measures the real cosine distribution between concept pairs in the live graph,
 * so MERGE_THRESHOLD / REVIEW_THRESHOLD come from data rather than from a guess.
 *
 * Reports the near-duplicate pairs the current thresholds are LETTING THROUGH —
 * which is the failure mode that silently splits a learner's mastery.
 */
import './load-env';
import { closeMongo, cosine, loadGraph, MERGE_THRESHOLD, REVIEW_THRESHOLD } from '@grasp/core';

const DIM='\x1b[2m'; const BOLD='\x1b[1m'; const YELLOW='\x1b[33m'; const RED='\x1b[31m'; const OFF='\x1b[0m';

const g = (await loadGraph(true)).filter((c) => c.embedding.length > 0);
console.log(`\n${BOLD}Concept similarity calibration${OFF} ${DIM}${g.length} concepts with embeddings${OFF}`);
console.log(`${DIM}current: merge ≥ ${MERGE_THRESHOLD} · review ${REVIEW_THRESHOLD}–${MERGE_THRESHOLD}${OFF}\n`);

const pairs: { a: string; b: string; score: number }[] = [];
for (let i = 0; i < g.length; i++) {
  for (let j = i + 1; j < g.length; j++) {
    const x = g[i]!, y = g[j]!;
    pairs.push({ a: x._id, b: y._id, score: cosine(x.embedding, y.embedding) });
  }
}
pairs.sort((p, q) => q.score - p.score);

// A `-N` suffixed id is a slug collision, which means these are almost certainly
// the same concept the resolver failed to merge. Ground truth, for free.
const looksDuplicate = (a: string, b: string) =>
  a.replace(/-\d+$/, '') === b.replace(/-\d+$/, '');

const dupes = pairs.filter((p) => looksDuplicate(p.a, p.b));
console.log(`${BOLD}Known duplicates${OFF} ${DIM}(slug collisions — same concept, different id)${OFF}`);
if (dupes.length === 0) console.log(`  ${DIM}none${OFF}`);
for (const p of dupes) {
  const verdict = p.score >= MERGE_THRESHOLD ? 'would merge' : `${RED}LEAKED${OFF}`;
  console.log(`  ${p.score.toFixed(3)}  ${p.a} ~ ${p.b}  ${verdict}`);
}
if (dupes.length > 0) {
  const worst = Math.min(...dupes.map((d) => d.score));
  console.log(`\n  ${YELLOW}lowest known-duplicate score: ${worst.toFixed(3)}${OFF}`);
  console.log(`  ${DIM}MERGE_THRESHOLD must sit below this to catch them — currently ${MERGE_THRESHOLD}${OFF}`);
}

console.log(`\n${BOLD}Top 10 non-duplicate pairs${OFF} ${DIM}(the ceiling — merging these would be wrong)${OFF}`);
for (const p of pairs.filter((x) => !looksDuplicate(x.a, x.b)).slice(0, 10)) {
  console.log(`  ${p.score.toFixed(3)}  ${DIM}${p.a} ~ ${p.b}${OFF}`);
}

const distinct = pairs.filter((x) => !looksDuplicate(x.a, x.b));
if (dupes.length > 0 && distinct.length > 0) {
  const floor = Math.min(...dupes.map((d) => d.score));
  const ceiling = Math.max(...distinct.map((d) => d.score));
  console.log(`\n${BOLD}Separation${OFF}`);
  console.log(`  ${DIM}duplicates bottom out at  ${floor.toFixed(3)}${OFF}`);
  console.log(`  ${DIM}distinct pairs top out at ${ceiling.toFixed(3)}${OFF}`);
  if (floor > ceiling) {
    const mid = (floor + ceiling) / 2;
    console.log(`  → separable. Set MERGE_THRESHOLD ≈ ${mid.toFixed(2)}`);
  } else {
    console.log(`  → ${RED}overlapping${OFF} — no single threshold separates them.`);
    console.log(`    ${DIM}Embedding alone is not enough; the review band needs a model tiebreaker.${OFF}`);
  }
}
console.log('');
await closeMongo();
