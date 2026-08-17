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

## The five internal contracts

These *are* the platform. The test of whether Grasp is a platform rather than a
pile of features: **can a new surface be built in a week on top of these alone?**

| Contract | Input | Output |
| --- | --- | --- |
| `POST /internal/context/assemble` | `{ userId, surface, sessionId?, query, attachmentIds[] }` | `ContextBundle` — ordered, budgeted, citable |
| `POST /internal/retrieve` | `{ query, conceptIds[], scope, k }` | Reranked chunks with ids and provenance |
| `GET /internal/mastery/:userId` | — | Per-concept state + due queue + frontier |
| `POST /internal/cards/next` | `{ userId, n }` | Pre-generated cards, from cache |
| `POST /internal/events` | `Event[]` (with idempotency keys) | Ack; fans out to derivations |

They are internal HTTP routes in `apps/web` for now, backed by functions in
`packages/core`. Calling the function directly from server code is fine and
preferred; the HTTP surface exists so the Python service and future clients have
a boundary. **Do not bypass them from a surface.**

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
  ├── retrieval/  Hybrid search, RRF fusion, rerank        (Phase 1)
  ├── context/    The broker                                (Phase 1)
  ├── learner/    Mastery, scheduler, event handlers        (Phase 2)
  └── eval/       Golden sets, rubric judges, harness
       ▲
       │
apps/web          UI + BFF. Depends on core. Owns no business logic.
```

The dependency arrows never reverse. `core` must never import from `apps/web`.

## How a request actually flows

### Ask — a tutor turn

```
1. POST /api/chat                 apps/web route handler
2. authenticate, rate-limit       Upstash
3. broker.assemble()              ─┐
     a. understand query           │  ONE cheap fast model call:
        (rewrite + concept tags    │  resolves "explain that again",
         + intent)                 │  tags concepts, classifies intent
     b. allocate token budget      │
     c. compact history            │  last n turns verbatim + session digest
     d. retrieve                   │  BM25 ∥ vector → RRF → rerank → top-5
     e. inject learner card        │  ~300 tokens, hand-formatted prose
     f. stamp chunk ids           ─┘
4. generate(task: 'tutor.reply')  gateway → provider (failover if 429)
5. stream SSE to client           tokens as they arrive
6. verify citations               every cited id exists in the bundle?
7. persist message + emit events  messages (tree), events (append-only)
8. trace                          cost, latency, prompt version, eval tags
```

Steps 3a and 6 are the two most commonly skipped and the two that matter most.
Without 3a, follow-up turns break. Without 6, you have no hallucination metric.

### Reps — a card swipe

```
1. GET /api/cards          returns from Redis; never touches a model
2. learner answers         graded client-side where possible (<100ms feedback)
3. POST /api/attempt       emits attempt event
4. handler updates mastery + nextDueAt        (pure function, unit-tested)
5. background: top up the pre-generated queue if it dipped below threshold
6. wrong answer? explanation streams from a pre-warmed broker bundle
```

The model appears at step 6 only, and only on demand. Steps 1–4 are pure data.

### Snap — a doubt

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
| `tutor.reply` | mid | Ask | no (streams prose) |
| `tutor.explainAnswer` | mid | Reps wrong-answer | no |
| `card.generate` | fast | Ingestion job | yes |
| `card.solve` | mid | Verification (×2, independent) | yes |
| `concept.tag` | fast | Ingestion, Snap | yes |
| `doubt.decompose` | mid | Snap | yes |
| `mindmap.build` | mid | Map | yes |
| `slip.classify` | best | Slips | yes |
| `session.title` | fast | Ask, after turn 2 | yes |
| `session.digest` | fast | Broker step 3c | yes |
| `eval.judge` | best | Eval harness | yes |

Model *tier* — not model name — is what feature code names. The registry maps
tier to a concrete model per provider, so swapping providers is a config change.
See [04-llm-gateway.md](04-llm-gateway.md).

## Service boundaries

**Now (Phase 0–2):** one Next.js app + Mongo + Redis. That's it.

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
| Primary model provider | Gateway fails over to the next; then to local Ollama |
| All providers | Ask degrades to retrieval-only ("here's the relevant passage"); Reps unaffected |
| Redis | Cards generated on demand (slower); rate limiting fails open |
| Atlas Vector Search | Retrieval falls back to BM25 alone; flagged in the trace |
| Pusher | Duel falls back to 1s polling; scoring unaffected ([ADR 0005](adr/0005-duel-is-a-replay.md)) |
| Inngest | Ingestion queues locally; nothing user-facing breaks |

Free-tier providers rate-limit constantly, so failover is not a
resilience nicety — it is the normal operating path.
