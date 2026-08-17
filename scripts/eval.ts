/**
 * `pnpm eval`
 *
 * The eval harness. Phase 0 deliverable 0.4 — build it now, while there is one
 * task to evaluate. Build it in month six and you will never build it.
 *
 * Design (docs/09-conventions.md § Evals):
 *   · golden sets live in packages/core/src/eval/golden/<task>.jsonl
 *   · each task has a rubric; judging uses `eval.judge` on the `best` tier
 *   · the judge must be a DIFFERENT model family than produced the output —
 *     same-family judging inflates scores
 *   · `--compare=main` scores against a baseline; a regression blocks the merge
 *
 * Currently a stub. Filling it in is the last item of Phase 0.
 */
import './load-env';
import { listTasks, TASKS } from '@grasp/core';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

console.log(`\n${BOLD}Grasp — eval harness${OFF} ${YELLOW}(not implemented)${OFF}\n`);
console.log(`${DIM}Phase 0 deliverable 0.4. See docs/07-phases.md${OFF}\n`);

console.log(`${BOLD}Tasks needing a golden set${OFF} ${DIM}(minimum 10 cases each)${OFF}\n`);

for (const task of listTasks()) {
  const cfg = TASKS[task];
  const kind = cfg.schema ? 'schema' : 'prose';
  console.log(
    `  ${task.padEnd(24)} ${DIM}tier ${cfg.tier.padEnd(5)} ${kind.padEnd(7)} ${cfg.prompt}${OFF}`,
  );
}

console.log(`
${DIM}Priority order — a task with no golden set cannot be improved, only changed:

  1. query.understand   the rewrite either works or every follow-up turn breaks
  2. concept.tag        tag quality caps the whole platform's personalization
  3. slip.classify      writes into the learner graph and persists for weeks
  4. tutor.reply        needs a rubric, not an exact match${OFF}
`);
