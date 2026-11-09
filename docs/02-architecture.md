# 02 — Architecture

## Three planes and one pivot

```
┌─────────────────────────────────────────────┐   ┌──────────────────┐
│  SURFACE PLANE                              │   │  EVENT PLANE     │
│  Ask · Reps · Snap · Duel · Map · Slips      │──▶│  append-only log │
└──────────────────┬──────────────────────────┘   └────────┬─────────┘
                   │                                       │
                   ▼                          ┌────────────▼─────────┐
   ┌───────────────────────────────┐          │  LEARNER PLANE       │
   │  CONTEXT BROKER               │◀─────────│  mastery · episodes  │
   │  rewrite · retrieve · budget  │          │  misconceptions      │
   │  inject · cite                │          │  profile             │
   └───────────────┬───────────────┘          └──────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  CONTENT PLANE                                                       │
│  concept graph · hybrid retrieval · question bank · corpora           │
│  every atom tagged to a concept node ← this is the interop layer      │
└──────────────────────────────────────────────────────────────────────┘
```

**Surfaces are thin.** A surface owns its UI, its interaction model, and its
event emissions. It owns no retrieval logic, no prompt assembly, no mastery math.

**The broker is the pivot.** Anything that talks to a model gets its context from
the broker. This is the only place that knows how to combine a query, a corpus,
and a learner into a prompt.

**The event plane is the only path into the learner plane.** Nothing writes
mastery directly. A surface emits an event; a handler derives state. This is what
makes the learner model rebuildable ([ADR 0003](adr/0003-event-sourced-learner-state.md)).
*Today the mastery fold runs inline in `/api/attempt`, right after the event
append; moving it behind a `core` handler shared with `learner:rebuild` is
planned.*

## The five internal contracts

These *are* the platform. The test of whether Grasp is a platform rather than a
pile of features: **can a new surface be built in a week on top of these alone?**

> **Planned — not built yet (see [07-phases.md](07-phases.md)).** No
> `/internal/*` route exists. Today the contracts are plain functions exported
> from `@grasp/core` (`assemble`, `retrieve`, `composeFeed`, `emit`, …), called
> directly from the route handlers listed below.

| Contract | Input | Output |
| --- | --- | --- |
| `POST /internal/context/assemble` | `{ userId, surface, sessionId?, query, attachmentIds[] }` | `ContextBundle` — ordered, budgeted, citable |
| `POST /internal/retrieve` | `{ query, conceptIds[], scope, k }` | Reranked chunks with ids and provenance |
| `GET /internal/mastery/:userId` | — | Per-concept state + due queue + frontier |
| `POST /internal/cards/next` | `{ userId, n }` | Pre-generated cards, from cache |
| `POST /internal/events` | `Event[]` (with idempotency keys) | Ack; fans out to derivations |

When built, they are internal HTTP routes in `apps/web`, backed by functions in
`packages/core`. Calling the function directly from server code is fine and
preferred; the HTTP surface exists so the Python service and future clients have
a boundary. **Do not bypass them from a surface.**

### Routes that exist today

All in `apps/web/src/app/api`, all session-authenticated except `health` and
`auth`, all reading learner data through the pre-scoped `UserScope`.

| Route | Does |
| --- | --- |
| `POST /api/chat` | One Ask turn in the learner's chosen mode: `assemble()` → `tutor.answer` / `tutor.teach` / `tutor.coach` over SSE → citation check → persist + `doubt.asked` |
| `GET /api/feed` | Reps feed, computed per request from verified questions (the planned `cards/next`; there is no `/api/cards`) |
| `POST /api/attempt` | Server-side grading, `attempt.recorded` append, mastery fold, background slip classification |
| `GET /api/slips` | Mistake notebook, grouped by root cause |
| `GET /api/map` | Concept graph with mastery heat |
| `GET` / `DELETE /api/sessions` | List / load a chat session; `DELETE` archives (sets `archivedAt`) |
| `GET` / `POST /api/profile` | Read / save the onboarding profile |
| `GET /api/health` | Dependency check — Mongo, providers, Ollama |
| `/api/auth/[...all]` | Better Auth |

## Package boundaries

```
packages/schema   Zod schemas. Depends on nothing. Everyone depends on this.
       ▲
       │
packages/prompts  Versioned templates + registry. Depends on schema.
       ▲
       │
packages/core     The spine. Depends on schema + prompts.
  ├── db/         Mongo client, typed collections, index definitions
  ├── llm/        Gateway, task registry, provider adapters, tracing
  ├── events/     Idempotent append, seq counter, replay reader
  ├── auth/       Better Auth config, UserScope / ScopedCollection
  ├── concepts/   Resolver: resolveExisting / resolveOrCreate (ADR 0007)
  ├── ingest/     Chunker + ingestion pipeline
  ├── retrieval/  Hybrid search, RRF fusion, rerank
  ├── context/    The broker
  ├── learner/    Mastery fold, scheduler, Brier
  ├── questions/  Card generation + verification
  ├── slips/      Root-cause classification
  ├── map/        Concept-graph layout
  └── eval/       Golden sets, scorers, rubric judge, baseline gate (pnpm eval)
       ▲
       │
apps/web          UI + BFF. Depends on core. Owns no business logic.
```

The dependency arrows never reverse. `core` must never import from `apps/web`.

## How a request actually flows

### Ask — a tutor turn

```
1. POST /api/chat                 apps/web route handler
2. authenticate                   session cookie; 12 turns/min per learner (core/limits.ts)
3. broker.assemble()              ─┐
     a. understand query           │  ONE cheap fast model call:
        (rewrite + concept tags    │  resolves "explain that again",
         + intent)                 │  tags concepts, classifies intent
     b. allocate token budget      │
     c. compact history            │  last n turns verbatim (session digest: planned)
     d. retrieve                   │  BM25 ∥ vector → RRF → rerank → top-k
     e. inject learner card        │  ~300 tokens, hand-formatted prose
     f. stamp chunk ids           ─┘
4. generateStream('tutor.<mode>')  gateway → provider; failover before the first token only;
                                  earlier turns sent as real chat messages
5. stream SSE to client           tokens as they arrive
6. verify citations               every cited id exists in the bundle?
7. persist message + emit events  messages (tree), `doubt.asked` (append-only)
8. trace                          tokens, latency, prompt version → llmCalls
```

Steps 3a and 6 are the two most commonly skipped and the two that matter most.
Without 3a, follow-up turns break. Without 6, you have no hallucination metric.

The route loads the latest 40 messages of the session as history; the broker
keeps the last few turns verbatim from that.

### Reps — a card swipe

```
1. GET /api/feed           composed per request from verified mcq questions in
                           Mongo; never touches a model (Redis pre-generation: planned)
2. learner answers         the client holds no answer key
3. POST /api/attempt       graded server-side; only `verified` questions accepted;
                           appends `attempt.recorded`
4. route folds mastery + nextDueAt            (pure function, unit-tested)
5. background: slip classification on wrong answers (not awaited)
6. wrong answer? explanation streams from a pre-warmed broker bundle   (planned)
```

No model call sits in front of the learner here: step 5 runs after the response
is sent, and step 6 is planned and on demand. Steps 1–4 are pure data. The Reps
client guards against double-submitting an attempt while one is in flight.

### Snap — a doubt *(Phase 3 — not built)*

```
1. presigned R2 upload      browser → R2 directly; server never sees bytes
2. POST /api/snap           returns immediately with a job id
3. Inngest job:
     vision extract → concept tag → step decomposition → persist
4. client polls / SSE       walkthrough streams step by step
5. emit doubt event         → concept enters the weak pool → tomorrow's feed
```

## Where the model calls are

Exhaustive list. If a model call exists outside this table, it's a bug.

| Task id | Tier | Called from | Structured output |
| --- | --- | --- | --- |
| `query.understand` | fast | Broker step 3a | yes |
| `tutor.answer` · `tutor.teach` · `tutor.coach` | mid | Ask — one task per chat mode | no (streams prose) |
| `tutor.reply` | mid | superseded by the three modes; registered for old traces | no |
| `tutor.explainAnswer` | mid | Reps wrong-answer | no |
| `card.generate` | fast | `pnpm cards:build` | yes |
| `card.solve` | mid | Verification (×2 — two calls on the same provider chain today; provider independence planned) | yes |
| `concept.tag` | fast | Ingestion, Snap | yes |
| `concept.propose` | mid | Concept resolver, on a miss (no `ollama` leg) | yes |
| `doubt.decompose` | mid | Snap | yes |
| `mindmap.build` | mid | Map | yes |
| `slip.classify` | best | Slips | yes |
| `session.title` | fast | Ask — **not called today**: the title is the first message truncated to 48 chars | yes |
| `session.digest` | fast | Broker step 3c | yes |
| `eval.judge` | best | Eval harness | yes |

Registered but not callable yet, because their prompts don't exist
(`PROMPT_PENDING` in `llm/registry.test.ts`): `session.title`,
`session.digest`, `doubt.decompose`, `mindmap.build`, `eval.judge`.
`tutor.explainAnswer` is registered (on the `tutor.reply@1` prompt) but nothing
calls it yet.

Model *tier* — not model name — is what feature code names. The registry maps
tier to a concrete model per provider, so swapping providers is a config change.
See [04-llm-gateway.md](04-llm-gateway.md).

## Service boundaries

**Now (Phase 0–2):** one Next.js app + Mongo, plus Ollama for embeddings. Redis
is planned (rate limiting, response cache, card queue) and not wired yet.

**Phase 3 adds `services/ai`** — a Python FastAPI service, because these four
things are genuinely better in Python and none of them land before Phase 3:

- layout-aware PDF/OCR parsing (`pymupdf`, `unstructured`)
- symbolic math equivalence (`sympy`) — `1/2`, `0.5`, and `2⁻¹` are one answer
- item response theory and forgetting-curve fitting (`numpy`, `scipy`)
- local reranking at volume

It communicates over HTTP behind an Inngest job. It holds no user state and
owns no collections — it reads and writes through the same contracts.
([ADR 0002](adr/0002-typescript-first.md))

## Failure posture

| Component down | Behaviour |
| --- | --- |
| Primary model provider | Gateway retries a 429/5xx on the same provider with backoff (honouring `retry-after`), then fails over to the next; then to local Ollama (except tasks that exclude it). A provider that failed transiently cools down for 60 s — it moves to the back of the chain for that tier |
| All providers | Today: Ask shows a "providers are rate-limited, try again" error; Reps unaffected. Planned: degrade to retrieval-only ("here's the relevant passage") |
| Ollama (embeddings) | Ask answers keyword-only (BM25 leg), flagged `keyword-only` on the message; ingestion and concept growth wait for it |
| Atlas Search / Vector Search index missing | That leg falls back to an in-process scan; `retrievalLegs` on the bundle reports `fallback` |
| Redis | Planned (not wired): cards generated on demand; rate limiting fails open |
| Pusher | Planned: Duel falls back to 1s polling; scoring unaffected ([ADR 0005](adr/0005-duel-is-a-replay.md)) |
| Inngest | Planned: ingestion queues locally. Today ingestion is a CLI script (`pnpm ingest`) |

Free-tier providers rate-limit constantly, so failover is not a
resilience nicety — it is the normal operating path.
