# 09 — Conventions

## TypeScript

- **ESM only** (`"type": "module"`), with `moduleResolution: "Bundler"`.
- **Relative imports carry no file extension** — `from './registry'`, not
  `'./registry.js'`. Workspace packages ship TypeScript source and are compiled
  by whoever consumes them (Next for the app, `tsx` for scripts), so there is no
  build step in the monorepo. Next's webpack does not map a `.js` specifier back
  to a `.ts` file, so extensioned imports break the app build while typechecking
  cleanly — the worst combination.
- **`strict: true`**, plus `noUncheckedIndexedAccess`. The second one catches real
  bugs in array-heavy code like the scheduler.
- **No `any`.** `unknown` at boundaries, then narrow with Zod.
- **Zod is the only place a shape is defined.** If you're writing
  `interface Foo { … }` for something that crosses a boundary, stop and write a
  Zod schema, then `z.infer`.
- **No default exports** except Next.js pages/layouts, which require them.
- Errors are typed classes in `@grasp/core/errors`, never string matching.

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Files | kebab-case | `context-broker.ts` |
| Types / schemas | PascalCase, schema suffixed | `Mastery`, `MasterySchema` |
| Concept ids | kebab-case slug, human-readable | `sin-cos-identities` |
| Event types | `noun.verbPast` | `attempt.recorded` |
| Task ids | `domain.action` | `slip.classify` |
| Prompt ids | `taskId@version` | `slip.classify@3` |
| Atlas indexes | `grasp_<collection>_<kind>` | `grasp_chunks_vec` |

Concept ids are readable on purpose: they appear in traces, prompts, and logs, and
`sin-cos-identities` is debuggable where `c_7f3a91` is not.

## Where code goes

| It… | Lives in |
| --- | --- |
| defines a shape | `packages/schema` |
| talks to a model | `packages/core/llm` (task registry entry) |
| is a prompt | `packages/prompts` |
| reads/writes Mongo | `packages/core/db` collection accessor |
| computes learner state | `packages/core/learner` — **pure functions** |
| assembles a prompt | `packages/core/context` |
| is UI | `apps/web` |

`apps/web` owns no business logic. If a route handler contains a calculation,
that calculation belongs in `core`.

`core` never imports from `apps/web`. The arrow does not reverse.

## Purity where it counts

These are pure, take no I/O, and are unit-tested hard, because they're where
correctness actually lives:

- `updateMastery(prev, signal, now)` — also computes `stability` / `nextDueAt`
- `currentP(mastery, now)`
- `allocateBudget(profile, requested)`
- `fuseRRF(rankLists)`
- `composeFeed(candidates, states, now, config)`
- `scoreDuel(run, config)` — *planned, Phase 4*

If one of these grows a database call, that's the bug — pass the data in.

## Testing

| Kind | Tool | What |
| --- | --- | --- |
| Unit | Vitest | The pure functions above. Property tests where invariants exist (budget never exceeds total; feed never repeats a concept consecutively). |
| Integration | Vitest + real Atlas dev db | Collection accessors, index behaviour, **cross-user retrieval isolation** |
| Eval | `pnpm eval` | Model-task quality against golden sets |
| E2E | Playwright | Exactly three flows: ask a question, complete a feed session, finish a duel |

Three E2E flows, permanently. More is maintenance you'll resent.

> **Today only the Unit row exists** — `pnpm test` runs the Vitest unit suite,
> including the `UserScope` cross-user isolation tests, which assert the shape of
> the query against a mocked collection. Planned, not built yet
> ([07-phases.md](07-phases.md)): integration tests (Vitest is already set to
> pick up `*.integration.test.ts` only when run explicitly; none exist), the eval
> harness (`pnpm eval` is a stub), Playwright (not installed), and CI (there is
> no workflow ran). **Lint and CI now exist:** `pnpm lint` (Biome, recommended
> rules, lint only — no reformatting), `pnpm lint:boundaries` (the hard rules a
> linter can't express: provider calls only in `core/llm`, no package importing
> the app, no `grade` field), and `.github/workflows/ci.yml` running typecheck,
> both lints and the unit tests on every PR. Suppressions carry a reason
> (`// biome-ignore … : why`).

The cross-user retrieval test is a **security** test. Once it exists it runs in
CI, and blocking it is not negotiable.

## Evals

Golden sets live in `packages/core/src/eval/golden/<task>.jsonl` — one case per
line: an input, optional earlier turns, an `expect` block (shapes in
`@grasp/schema` `eval.ts`) and a `note` saying why the case exists. Shared
context (the concept catalogue, retrieved chunks, a learner card) is frozen in
`golden/fixtures/` so scores don't drift as the live graph grows. Built in Phase
0.4: `query.understand`, `slip.classify`, `card.solve`, `tutor.answer`,
`tutor.teach`, `tutor.coach` — 10+ cases each, validated by
`eval/golden.test.ts` in every `pnpm test` (no model calls).

```bash
pnpm eval                        # every task with a golden set
pnpm eval --task=tutor.coach     # one task (comma-separate for several)
pnpm eval --verbose              # print the model output for every failure
pnpm eval --compare              # fail on regression vs eval/baseline.json — CI runs this
pnpm eval --update-baseline      # record this run as the baseline (commit the file)
```

How a case is scored:

- **Deterministic first** (`eval/scorers.ts`, unit-tested): intent, concept ids,
  rewrite wording, root cause, answer equality, question counts, "must not repeat
  this question". The judge only sees what genuinely needs judgement.
- **Prose gets a rubric judge** (`eval.judge@1`) run with the producer's provider
  excluded — and the runner fails the case if the judge ever ran on the same
  provider. A MUST criterion needs ≥ 0.75.
- **Inconclusive is not failing.** If every real provider is rate-limited for the
  task or the judge (after back-off retries), the case is reported as `?` and left
  out of pass/fail and the gate. Ollama never produces eval answers: it is the
  offline floor, not a quality target.

The gate (`eval/baseline.ts`, unit-tested): a task regresses when two or more of
the cases it shares with the baseline flip from pass to fail (one flip is model
noise). And **a prompt version bump is refused while that task has fewer than 10
golden cases** — `--compare` enforces the rule rather than trusting it.

Rules:

1. **Judge with a different model family than produced the output.** Same-family
   judging inflates scores.
2. **Rubrics are explicit and independently checkable.** "Is the answer good" is
   not a rubric. "Cites at least one retrieved chunk; states the prerequisite gap
   if one exists; does not give the final answer before asking one probing
   question" is.
3. **A regression blocks the merge.** Without this the harness is decoration.
4. **When you find a real failure, add it to the golden set.** That's how the set
   earns its value.
5. **Change the case only when the case is wrong** — and say why in its `note`.
   A failing case that describes a real model weakness stays failing; that is the
   signal the harness exists to give.

## Prompts

Templates in `packages/prompts/src/templates/`, one file per `taskId@version`.
Bump the version; never edit a shipped one.

Style rules — these are quality rules, not preferences:

- **Say what you want, at normal volume, with the reason.** Current models follow
  the system prompt closely. Prompts written to overpower an older model's
  reluctance now over-trigger.
- **Emphasis is a tested fix for one specific underweighted instruction.** When
  every line is `CRITICAL: YOU MUST`, none of them carry information.
- **Describe success, don't enumerate failure.** A prohibition against a mistake
  the model wasn't going to make can anchor it toward that mistake.
- **Context is never cruft.** Audience, quality bar, environment facts, and the
  *reason* behind a constraint all belong in the prompt. Restating trained
  defaults ("be accurate and helpful") does not.
- **Examples are the strongest signal in a prompt** — the model matches their
  length, tone, and structure. Include several deliberately varied ones, or none.
  One "gold" example freezes its shape into every output.
- **No step-by-step choreography for judgment tasks.** State the outcome and the
  constraints; the model's own plan usually beats a hand-written script.

## Commits

Conventional-ish, with a scope:

```
feat(reps): four-pool feed scheduler
fix(broker): budget shed order was reversed
docs(architecture): record the events → mastery fold
chore(deps): bump zod
```

**A structural change and its doc update land in the same commit.** A stale
architecture doc gets trusted by the next session and causes bugs — that's the
whole reason for the rule.

## Feature flags

Every surface sits behind a flag in `packages/core/src/flags.ts` so half-built
work can ship to yourself without branching. Default off (`FLAG_ASK` defaults
on); flip in `.env.local`. *Today the flags only decide what the home page
lists — the surface routes and pages don't check them yet (planned).*

## Adding an ADR

When a decision is load-bearing and someone could reasonably choose otherwise,
write one. Copy the shape of an existing file in `docs/adr/`: context, decision,
consequences, what would change our mind.

Never edit a decided ADR to reflect a new decision. Write a new one that
supersedes it, and mark the old one superseded. The history is the value.
