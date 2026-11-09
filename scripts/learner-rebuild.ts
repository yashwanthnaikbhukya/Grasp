/**
 * `pnpm learner:rebuild [--email=<learner>] [--all]`
 *
 * Shadow mode — reads only. Replays each learner's `attempt.recorded` events
 * through the pure mastery fold and diffs the result against stored `mastery`.
 * A clean diff is the evidence that mastery is derived state (ADR 0003, rule 4);
 * a mismatch names the concept and field.
 *
 * Writing the rebuilt rows (`--write`) is deliberately not built yet: the shadow
 * report has to be trusted first (docs/07-phases.md § 2.2).
 */
import './load-env';
import { closeMongo, collections, diffMastery, forUser, masteryFromDoc, oid, replayMastery } from '@grasp/core';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const email = arg('email');

const users = await collections
  .users()
  .find((email ? { email } : {}) as never, { projection: { _id: 1, email: 1 } })
  .limit(email ? 1 : 200)
  .toArray();

if (users.length === 0) {
  console.error(email ? `No learner with email ${email}.` : 'No learners.');
  await closeMongo();
  process.exit(1);
}

// Item difficulty is part of the fold; read it once for every question referenced.
const questionDifficulty = new Map<string, number>();
async function difficulties(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => !questionDifficulty.has(id));
  if (missing.length === 0) return;
  const rows = await collections
    .questions()
    .find({ _id: { $in: missing.flatMap((id) => oid(id) ?? []) } } as never, {
      projection: { _id: 1, difficulty: 1 },
    })
    .toArray();
  for (const r of rows) questionDifficulty.set(String(r._id), Number(r.difficulty ?? 0));
}

console.log(`\n${BOLD}Learner rebuild — shadow${OFF} ${DIM}(reads only)${OFF}\n`);

let mismatched = 0;
for (const u of users) {
  const userId = String(u._id);
  const scope = forUser(userId);
  const events = await scope
    .events()
    .find({ type: 'attempt.recorded' } as never)
    .sort({ seq: 1 })
    .toArray();
  const storedRows = await scope.mastery().find({}).toArray();
  if (events.length === 0 && storedRows.length === 0) continue;

  const attempts = events.map((e) => {
    const p = e.payload as {
      questionId: string;
      conceptIds: string[];
      correct: boolean;
      latencyMs: number;
      hintsUsed?: number;
    };
    return {
      seq: e.seq,
      ts: new Date(e.ts),
      questionId: p.questionId,
      conceptIds: p.conceptIds,
      correct: p.correct,
      latencyMs: p.latencyMs,
      hintsUsed: p.hintsUsed ?? 0,
    };
  });
  await difficulties([...new Set(attempts.map((a) => a.questionId))]);

  const rebuilt = replayMastery(attempts, (qid) => questionDifficulty.get(qid) ?? 0);
  const stored = new Map(
    storedRows.map((m) => [String(m.conceptId), masteryFromDoc(m as Record<string, unknown>, new Date())]),
  );
  const diffs = diffMastery(stored, rebuilt);

  const label = String(u.email ?? userId);
  if (diffs.length === 0) {
    console.log(`  ${GREEN}✓${OFF} ${label} ${DIM}${events.length} events → ${rebuilt.size} concept(s), identical${OFF}`);
  } else {
    mismatched++;
    console.log(`  ${RED}✗${OFF} ${label} ${DIM}${events.length} events → ${diffs.length} difference(s)${OFF}`);
    for (const d of diffs.slice(0, 6)) {
      console.log(`      ${d.conceptId} · ${d.field}: stored ${JSON.stringify(d.stored)} · rebuilt ${JSON.stringify(d.rebuilt)}`);
    }
  }
}

console.log(
  mismatched === 0
    ? `\n${GREEN}${BOLD}All learners rebuild from events alone.${OFF}\n`
    : `\n${RED}${mismatched} learner(s) differ.${OFF} ${DIM}Rows folded before 2026-11-08 could be written without an event (the bug Phase H.1 fixed).${OFF}\n`,
);
await closeMongo();
process.exit(mismatched === 0 ? 0 : 1);
