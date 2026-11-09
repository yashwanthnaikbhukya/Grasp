/**
 * `pnpm eval`
 *
 *   pnpm eval                          every task with a golden set
 *   pnpm eval --task=tutor.coach       one task (comma-separate for several)
 *   pnpm eval --compare                fail on regression vs the committed baseline
 *   pnpm eval --update-baseline        record this run as the new baseline
 *   pnpm eval --verbose                show the model output for every failure
 *
 * Golden sets: packages/core/src/eval/golden/<task>.jsonl (docs/09-conventions.md).
 * Each case runs through the real gateway; prose is judged on a different
 * provider than produced it. `--compare` also refuses a prompt version bump on a
 * task with fewer than 10 cases.
 */
import './load-env';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Baseline,
  closeMongo,
  compareToBaseline,
  EVAL_TASKS,
  type EvalTask,
  MIN_CASES_FOR_PROMPT_BUMP,
  runEval,
  toBaseline,
} from '@grasp/core';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const goldenDir = join(root, 'packages/core/src/eval/golden');
const baselineFile = join(root, 'packages/core/src/eval/baseline.json');

const flag = (name: string) => process.argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const tasks = (value('task')?.split(',') as EvalTask[] | undefined) ?? [...EVAL_TASKS];
const unknown = tasks.filter((t) => !(EVAL_TASKS as readonly string[]).includes(t));
if (unknown.length > 0) {
  console.error(`Unknown task(s): ${unknown.join(', ')}. Known: ${EVAL_TASKS.join(', ')}`);
  process.exit(2);
}

console.log(`\n${BOLD}Grasp — eval${OFF} ${DIM}${tasks.join(', ')}${OFF}\n`);
const started = Date.now();

const run = await runEval({
  goldenDir,
  tasks,
  concurrency: Number(value('concurrency') ?? 2),
  onCase: (task, r) =>
    process.stdout.write(
      `  ${r.inconclusive ? `${YELLOW}?` : r.pass ? `${GREEN}✓` : `${RED}✗`}${OFF} ${task.padEnd(17)} ${r.id.padEnd(30)} ${DIM}${r.provider ?? ''}${r.judgeProvider ? ` → judged by ${r.judgeProvider}` : ''}${OFF}\n`,
    ),
});

console.log(`\n${BOLD}Results${OFF} ${DIM}(${Math.round((Date.now() - started) / 1000)} s)${OFF}\n`);
for (const r of run.results) {
  const pct = r.total === 0 ? 0 : Math.round((r.passed / r.total) * 100);
  const colour = pct >= 90 ? GREEN : pct >= 70 ? YELLOW : RED;
  // The set's size — an outage must not make a full set look too small.
  const setSize = r.total + (r.inconclusive ?? 0);
  const thin = setSize < MIN_CASES_FOR_PROMPT_BUMP ? ` ${YELLOW}(< ${MIN_CASES_FOR_PROMPT_BUMP} cases)${OFF}` : '';
  const unsure = r.inconclusive ? ` ${YELLOW}${r.inconclusive} inconclusive (provider outage — not scored)${OFF}` : '';
  console.log(`  ${r.task.padEnd(17)} ${colour}${String(r.passed).padStart(2)}/${r.total} ${String(pct).padStart(3)}%${OFF} ${DIM}${r.prompt}${OFF}${thin}${unsure}`);
  for (const c of run.details[r.task] ?? []) {
    if (c.pass) continue;
    console.log(`      ${c.inconclusive ? `${YELLOW}?` : `${RED}✗`}${OFF} ${c.id}: ${c.failures.join('; ')}`);
    if (flag('verbose') && c.output) console.log(`        ${DIM}${c.output.replace(/\n/g, ' ')}${OFF}`);
  }
}

let exit = 0;

if (flag('compare')) {
  if (!existsSync(baselineFile)) {
    console.log(`\n${YELLOW}No baseline yet${OFF} — run with --update-baseline first.`);
    exit = 1;
  } else {
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as Baseline;
    const regressions = compareToBaseline(run.results, baseline);
    if (regressions.length === 0) {
      console.log(`\n${GREEN}${BOLD}No regressions${OFF} ${DIM}vs baseline of ${baseline.updatedAt.slice(0, 10)}${OFF}`);
    } else {
      console.log(`\n${RED}${BOLD}${regressions.length} regression(s)${OFF}`);
      for (const r of regressions) console.log(`  ${RED}✗${OFF} ${r.task}: ${r.reason}`);
      exit = 1;
    }
  }
}

if (flag('update-baseline')) {
  // Merge: tasks not run this time keep their previous baseline.
  const previous = existsSync(baselineFile)
    ? (JSON.parse(readFileSync(baselineFile, 'utf8')) as Baseline)
    : { updatedAt: '', tasks: {} };
  const next = toBaseline(run.results);
  next.tasks = { ...previous.tasks, ...next.tasks };
  writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\n${DIM}Baseline written: ${baselineFile.replace(`${root}/`, '')}${OFF}`);
}

console.log('');
await closeMongo();
process.exit(exit);
