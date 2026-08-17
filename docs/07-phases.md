# 07 — Phases

**Status legend:** ☐ not started · ◐ in progress · ☑ done

The rule that makes this plan work: **nothing from phase *n+1* starts until phase
*n*'s gate passes.** The gates are measurable on purpose — "feels good" is not a
gate. Scope creep is the most common way a project like this dies, and the gates
are the only mechanism that stops it.

---

## Phase 0 — Foundations ◐

*Weeks 1–2. Goal: the spine exists and is observable.*

### 0.1 Pick the scope ☐

**Do this before writing any other code.** One board, one grade, one subject, set
in `.env.local`. Everything downstream filters by it. See
[01-product.md#scope](01-product.md#scope).

### 0.2 Author the concept graph ☐

150–300 nodes with `prereqIds`. Two days of work by hand from the syllabus, using
a model as a drafting assistant — **not** fully generated, because the
prerequisite edges are the part that has to be right and the part models get
wrong. This artifact pays for itself for the rest of the project: it drives
retrieval scoping, frontier gating, gap detection, and the Map surface.

Seed file: `data/concepts.seed.json`. Loader: `pnpm db:seed:concepts`.

### 0.3 Infrastructure ☑

- ☑ Monorepo (pnpm workspaces + turbo), TS config, lint
- ☑ `packages/schema` — Zod schemas
- ☑ `packages/core/db` — client, typed collections, index definitions
- ☑ `packages/core/llm` — gateway, registry, providers, failover, tracing
- ☑ `packages/core/events` — idempotent append
- ☑ `packages/prompts` — versioned registry + 4 templates
      (`query.understand`, `concept.tag`, `slip.classify`, `tutor.reply`)
- ☑ `pnpm setup:check` — reports what's wired, per phase, with fixes
- ☑ `pnpm db:indexes` — all regular indexes + prints the Atlas Search defs
- ☑ `pnpm db:seed:concepts` — loads the graph, validates edges, detects cycles
- ☑ Vitest + registry guard tests (prompt existence, tier invariants, cache safety)
- ☑ `/debug/gateway` — makes the gate below verifiable in a browser
- ☐ **Atlas cluster + the two Atlas Search indexes** ([08-setup.md](08-setup.md))
- ☐ **At least two model provider keys** — one is not enough, you'll rate-limit
- ☐ **Ollama + `nomic-embed-text`** pulled locally
- ☐ Langfuse project (optional, recommended now)

### 0.4 Eval harness ☐

`scripts/eval.ts` is a stub that lists every task needing a golden set, in
priority order. Filling it in is the last item of Phase 0: golden-set runner +
rubric judge + `--compare` regression gate.

Build it now while there are four tasks to evaluate. Build it in month six and
you will never build it.

### Gate 0 ☐

> A `generate()` call for a task with a Zod schema returns validated typed data;
> forcing the primary provider to fail produces a **successful** response from the
> next provider; both attempts appear in the trace with `failoverDepth` recorded.

Verify with: `pnpm setup:check` then the `/debug/gateway` page.

---

## Phase 1 — Ask ☐

*Weeks 3–6. Goal: a tutor that is visibly not ChatGPT.*

### 1.1 Ingestion ☐

- ☐ Chunker (layout-naive; heading-path aware)
- ☐ Local embedding via Ollama, batched
- ☐ `concept.tag` pass over every chunk
- ☐ Ingest one textbook chapter end to end
- ☐ Retrieval eval: 20 hand-written student questions, measure `recall@5`

### 1.2 Retrieval ☐

- ☐ Atlas Search (BM25) leg
- ☐ Atlas Vector Search leg
- ☐ RRF fusion
- ☐ Local cross-encoder rerank, top-20 → top-5
- ☐ Scope filter + **security test**: a user cannot retrieve another user's chunks

### 1.3 Context broker v1 ☐

All six steps from [05-context-broker.md](05-context-broker.md). The budget
allocator, history compaction, and RRF fusion are pure functions — unit-test them
properly, they're where correctness lives.

### 1.4 Chat ☐

- ☐ SSE streaming from a route handler
- ☐ Sessions: sidebar, auto-title after turn 2, rename, archive
- ☐ Cross-session search (Atlas Search on `messages`)
- ☐ Markdown + KaTeX + code blocks + copy
- ☐ **Edit-and-branch** (the message tree — do not defer this)
- ☐ Regenerate, stop generation
- ☐ Citation chips that open the source page
- ☐ Socratic toggle; default *probe once, then explain*
- ☐ Token/cost readout in dev mode

### 1.5 Attachments ☐

- ☐ Presigned R2 upload from the browser
- ☐ Inngest extraction job: detect → extract → chunk → embed → index
- ☐ Image path: vision description + OCR, both indexed
- ☐ PDF path: text + page images
- ☐ Real extraction status in the UI, chat stays usable
- ☐ **Both scopes**: `session` (TTL'd) and `library` (persists into the corpus)

### 1.6 Auth ☐

Better Auth + Mongo adapter. Email magic link via Resend.

### Gate 1 ☐

> A 20-turn conversation with 3 attachments: stays coherent, stays inside its
> token budget (`bundle.budget.shed` empty on typical turns), cites real
> retrievable sources, `fabricated-citation` rate is 0 across the golden set, and
> p95 time-to-first-token is under 1.5 s.

---

## Phase 2 — Reps ☐

*Weeks 7–10. Goal: the loop closes. This is the phase that makes Grasp a platform.*

### 2.1 Question bank ☐

- ☐ `card.generate` from chunks, targeting concept objectives
- ☐ **Verification pipeline**: generate → solve twice independently → agreement
  check → difficulty estimate → quarantine → human spot-check UI
- ☐ Only `verified` questions are servable (enforced in the query)
- ☐ Six card types: mcq, multi, tapError, orderSteps, numeric, label

### 2.2 Learner model ☐

- ☐ Event handlers → mastery fold (pure, unit-tested)
- ☐ Elo + 2-param scheduler
- ☐ Calibration job (weekly Brier vs baselines)
- ☐ `pnpm learner:rebuild` with shadow-write + diff report

### 2.3 Feed ☐

- ☐ Scheduler: four pools + diversify + difficulty band + type variety
- ☐ Pre-generate next 20 cards into Redis; top-up job
- ☐ Vertical swipe (spring physics, snap), keyboard navigable
- ☐ Instant feedback < 100 ms; local grading where possible
- ☐ Wrong answer → streamed explanation from a pre-warmed bundle
- ☐ Streak, daily goal ring, XP, per-concept progress
- ☐ Haptics on mobile web
- ☐ 8-question cold-start placement, in feed format

### Gate 2 ☐

> A 50-card session has zero perceived latency (no model call in the swipe path,
> verified in the trace), **and** the weekly calibration job shows mastery beating
> the constant baseline on Brier score.

The second half is the real gate. If mastery doesn't predict better than a
constant, the personalization is theatre and no amount of UI fixes it.

---

## Phase 3 — Snap + Slips ☐

*Weeks 11–13. Goal: prove the thesis — a doubt becomes tomorrow's practice.*

- ☐ `services/ai` (Python FastAPI): layout-aware parsing, OCR, `sympy`
- ☐ Snap: photo → extract → `doubt.decompose` → step-wise walkthrough that
  pauses and asks *what next?*
- ☐ Auto concept-tag the doubt → feeds tomorrow's weak pool
- ☐ Math answer equivalence via `sympy` (`1/2` = `0.5` = `2⁻¹`)
- ☐ Slips: `slip.classify` over wrong attempts, fixed taxonomy
- ☐ Weekly Error-DNA digest
- ☐ Mistake notebook UI, filterable by root cause

### Gate 3 ☐

> Root-cause labels agree with your own hand-labels on ≥80% of a 100-attempt
> sample, **and** a photographed doubt produces cards in the next day's feed
> without manual intervention.

---

## Phase 4 — Duel + Map ☐

*Weeks 14–16. Goal: retention and legibility.*

### 4.1 Duel ☐

Read [ADR 0005](adr/0005-duel-is-a-replay.md) first — the design is a
synchronized replay, not a game server.

- ☐ Create → 6-char code → share link + QR
- ☐ **Frozen question set** at creation, identical order
- ☐ Lobby, ready state, 3-2-1 countdown
- ☐ Local round execution; server scores
- ☐ Pusher presence (index only, never answers); 1 s polling fallback
- ☐ Anti-cheat: no keys client-side pre-submit, server timestamp check
- ☐ **Ghost duel** — same phase, not later
- ☐ Post-duel breakdown, rematch, shareable OG result card

### 4.2 Map ☐

- ☐ Concept DAG with mastery heat (React Flow + elk/dagre)
- ☐ Node actions: explain / drill / prerequisites / weakest chain
- ☐ Mindmap generation from doc, session, or concept — **typed edges**, schema-validated
- ☐ Expand-on-demand child generation
- ☐ Mastery overlay on mindmaps
- ☐ Export PNG/SVG/Markdown

### Gate 4 ☐

> Two phones, one throttled to 3G, complete a duel with correct scores and no
> desync; a 40-page PDF produces a structurally correct mindmap in under 60 s.

---

## Phase 5 — Plan, Voice, Cockpit ☐

*Beyond. Not scheduled — gate 4 first.*

- ☐ **Plan**: durable Inngest workflow, daily re-plan around forgetting curves and
  missed days, morning brief
- ☐ **Voice**: explain-back mode, STT → rubric-graded against source material.
  The richest evidence of real understanding — an MCQ can be guessed, an
  explanation cannot.
- ☐ **Cockpit**: class rollups, auto-generated worksheets targeting the class's
  actual weak spots, "3 things to reteach tomorrow". The commercial wedge.

---

## Things that are explicitly *not* in the plan

Recorded so they don't creep in:

- Multi-subject or multi-grade support (breaks the scope mechanism)
- Live classes, video hosting, doubt marketplaces
- Native mobile apps (mobile web first; Expo only if the swipe demands it)
- Payments
- Social feed, following, public profiles
- Multi-tenant / white-label

Each is defensible eventually. None belongs before gate 4.
