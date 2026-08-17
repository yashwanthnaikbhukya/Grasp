# Grasp

An LLM-native learning platform. **One learner model, many surfaces.**

Every feature reads from and writes to the same substrate. If a change makes a
surface talk directly to a model or a corpus without going through the spine,
it is wrong — regardless of whether it works.

## Read these before non-trivial work

| You're touching | Read |
| --- | --- |
| Anything | [docs/02-architecture.md](docs/02-architecture.md) |
| A model call | [docs/04-llm-gateway.md](docs/04-llm-gateway.md) |
| Prompt assembly / retrieval | [docs/05-context-broker.md](docs/05-context-broker.md) |
| A collection or index | [docs/03-data-model.md](docs/03-data-model.md) |
| Mastery, scheduling, events | [docs/06-learner-model.md](docs/06-learner-model.md) |
| Anything curriculum / stage / locale shaped | [docs/10-onboarding.md](docs/10-onboarding.md) + [ADR 0006](docs/adr/0006-curriculum-agnostic-concepts.md) |
| Deciding what to build next | [docs/07-phases.md](docs/07-phases.md) |
| Code style, tests, evals | [docs/09-conventions.md](docs/09-conventions.md) |

Decisions that are settled (do not relitigate without an ADR):
[docs/adr/](docs/adr/).

## Hard rules

1. **No model call outside the gateway.** Never import a provider SDK or `fetch`
   a provider URL from feature code. Everything goes through
   `generate()` / `embed()` in `@grasp/core/llm`. A new kind of model call means
   a new entry in the task registry, not a new call site.
2. **No inline prompt strings.** Prompts live in `@grasp/prompts` with a version
   id. The version id must reach the trace.
3. **Zod is the single source of truth for shape.** Define it once in
   `@grasp/schema`; use it for API validation, client types, *and* as the
   model's structured-output schema. Never hand-write a TypeScript interface
   that duplicates a Zod schema.
4. **`events` is append-only.** Never update or delete an event. Mastery is
   derived state and must be rebuildable by replaying the log.
5. **Never an LLM call in the Reps swipe path.** Cards are pre-generated into
   Redis. If a card render awaits a model, that's a bug.
6. **No unverified question reaches a learner.** `questions.verificationStatus`
   must be `verified` before a card can be served.
7. **Retrieval is always hybrid + reranked.** Vector-only retrieval fails on
   exact terms (formula names, theorem names, numbers), which is most of what
   students ask about.
8. **Both themes, always.** Tokens on `:root`; redefine tokens only inside the
   dark blocks. Never a color whose only definition sits behind a media query.
9. **Scope belongs to the learner, never to the process.** Grasp is global. There
   is no deployment-wide board/grade/subject. Region, stage, curriculum, and
   language live on `users.profile`. `GRASP_SEED_*` names the first corpus to
   *ingest* and must never gate what a learner can be.
10. **Never name a field `grade`, and never store a local label in one.** "Class
   10", "Grade 10", "Year 11" and "MYP 5" are one age band under four names — and
   Year 11 is not Grade 11. Store the integer `stage`; render with
   `stageLabel(stage, region)`.
11. **Concepts are universal; curricula are overlays.** A concept never carries a
   board. `stageRange` is advisory — it ranks and caveats, it never refuses. A
   learner reaching ahead of their syllabus is the best signal they can send.
12. **Nothing about the curriculum is hand-authored.** The model proposes concepts;
   the resolver dedupes and persists them. But concept **ids must be stable** —
   free-form tags cannot accumulate mastery, because two providers won't agree on
   a slug and the learner ends up with two half-filled rows for one concept. Always
   go through `resolveExisting` / `resolveOrCreate`, never tag with raw model output.
   ([ADR 0007](docs/adr/0007-llm-authored-concept-graph.md))
13. **A concept row with no embedding is invisible to dedupe.** Any path that writes
   a concept must embed it, or the resolver will duplicate it later. This has
   already bitten once.
14. **Tasks that write durable structure get no weak fallback.** `concept.propose`
   excludes `ollama`: a small model's plausible garbage persists and corrupts every
   learner who touches that node, while a failure just retries.

## Layout

```
apps/web            Next.js app + BFF. UI, auth, SSE streaming, route handlers.
packages/schema     Zod schemas. Zero dependencies on anything else.
packages/core       The spine: db, llm gateway, context broker, mastery, events.
packages/prompts    Versioned prompt templates + registry.
services/ai         (Phase 3) Python FastAPI: ingestion, sympy, psychometrics.
docs/               Architecture, data model, phases, setup. Keep current.
scripts/            One-shot operational scripts.
```

## Commands

```bash
pnpm dev              # run the web app
pnpm check            # typecheck + lint everything
pnpm test             # unit tests (vitest)
pnpm setup:check      # which services/keys are wired, which aren't
pnpm db:indexes       # create/update all Mongo indexes (idempotent)
```

## Current phase

**Phase 0 — Foundations.** See [docs/07-phases.md](docs/07-phases.md) for the
exit gate. Do not start Phase 1 work until Phase 0's gate passes.

## When you change something structural

Update the doc in the same commit. A stale architecture doc is worse than none,
because the next session will trust it.
