# 07 — Phases

**Status legend:** ☐ not started · ◐ in progress · ☑ done

The rule that makes this plan work: **nothing from phase *n+1* starts until phase
*n*'s gate passes.** The gates are measurable on purpose — "feels good" is not a
gate. Scope creep is the most common way a project like this dies, and the gates
are the only mechanism that stops it.

## Where things stand — 2026-11-09

**The rule above was broken, and the plan now says so.** Building ran ahead of
the gates: Ask, Reps, Slips and Map all work end to end, but only Gate 0 had
passed. Racing ahead was not wasted — it surfaced real bugs no gate would have
— but it also meant the event log, the retrieval filter and the learner-facing
shell were never hardened. Phase H closed that debt before anything new.

**Order from here** — each step unblocks the next:

1. **Phase H — Hardening ☑** *(Gate H passed 2026-11-09)*. The last check was CI:
   the repo is on GitHub (`yashwanthnaikbhukya/Grasp`) and the first run is
   green. Event-log integrity came first because `events` is append-only.
2. **0.4 Eval harness — next** *(built — `pnpm eval`, 65 cases across 6 tasks, baseline
   recorded, CI-gated; two golden sets left)*. No prompt version bump until its
   task has ≥10 golden cases — `--compare` enforces it. Next prompt work, by the
   baseline: `slip.classify` (6/11), then Coach (7/10).
3. **Gate 1** (Ask), with the experience track (1.8) — navigation, a real home,
   typeset maths. A tutor that hangs or shows raw LaTeX fails the gate in spirit
   even if the numbers pass.
4. **Gate R — first real learner.** Consent, deletion, backups, deploy. Gate 2
   *needs* real attempts, and nothing real can be collected until R passes.
5. **Gate 2** (Reps calibration on real data) → Phase 3 → Phase 4.

No new surface (Snap, Duel) starts before Gate 2.

---

## Phase 0 — Foundations ◐

*Weeks 1–2. Goal: the spine exists and is observable.*

### 0.1 Pick the first corpus ☑

Picked: `in-cbse-secondary-math` (mathematics). One chapter ingested so far —
`data/corpus/trigonometry.md`, 9 chunks.

Not the product's scope — Grasp is global, and a learner's curriculum lives on
their profile ([ADR 0006](adr/0006-curriculum-agnostic-concepts.md)). This is
purely **which corpus to ingest first**, set as `GRASP_SEED_CURRICULUM`.

Pick one coherent secondary-mathematics curriculum. Retrieval quality is a
function of corpus coherence, and the concept graph you author for it is mostly
reusable for every other maths curriculum.

### 0.2 Concept graph ☑ mechanism · ◐ quality

**Nothing is hand-authored.** The model proposes concepts from ingested text; the
resolver dedupes against the existing graph and persists new nodes under stable
ids. See [ADR 0007](adr/0007-llm-authored-concept-graph.md).

```bash
pnpm concepts:grow --demo      # watch it decide, on sample passages
pnpm concepts:grow "<text>"    # or on your own
pnpm concepts:calibrate        # measured cosine separation, not guessed
pnpm concepts:reset            # drop llm-origin nodes, keep seeds
```

- ☑ `concept.propose` task + prompt (`@2` tightens naming and granularity)
- ☑ Resolver: bidirectional alias match → cosine → merge / review / create
- ☑ Within-batch prerequisite linking, cycle rejection, depth computation
- ☑ Review band: near-misses are flagged (`needsReview`), never silently decided
- ☑ No local-model fallback for graph writes — a weak model's plausible garbage
      persists, and this is a background job, so failing and retrying is free
- ☐ **Golden set for resolution** — given a passage, does it land on the right
      existing concept? Until this exists, graph quality is unmeasured
- ☐ Model tiebreaker for the review band ("are these the same concept?")
- ☐ `pnpm concepts:audit` review surface

`data/concepts.seed.json` is now an optional bootstrap, not a deliverable. An
empty graph is a valid starting state — the first ingestion run populates it.

> **Observed on a real run:** the mechanism holds — a quadratic-equations passage
> produced `completing-the-square → quadratic-formula → discriminant-and-nature-of-roots`
> with correct depths, and aliases including `shreedharacharya formula`. But a
> sine/cosine passage proposed `definition-of-sine-and-cosine` at 0.855 against
> the existing `trig-ratios` — landing in the review band rather than merging.
> The safety net worked; the judgement needs the golden set above.

### 0.3 Infrastructure ◐

- ☑ Monorepo (pnpm workspaces + turbo), TS config
- ☑ **Lint** — Biome (`pnpm lint`) and the boundary check, part of `pnpm check`
      since Phase H.5
- ☑ `packages/schema` — Zod schemas
- ☑ `packages/core/db` — client, typed collections, index definitions
- ☑ `packages/core/llm` — gateway, registry, providers, failover, tracing
- ☑ `packages/core/events` — idempotent append
- ☑ `packages/prompts` — versioned registry, 9 templates today (started with
      `query.understand`, `concept.tag`, `slip.classify`, `tutor.reply`)
- ☑ `pnpm setup:check` — reports what's wired, per phase, with fixes
- ☑ `pnpm db:indexes` — all regular indexes + prints the Atlas Search defs
- ☑ `pnpm db:seed` — curricula (~22 across 15 regions) + universal concept graph,
      with edge validation and cycle detection
- ☑ Global stage ladder (`stage` + `stageLabel`), 25 regions hand-checked,
      with round-trip tests
- ☑ `LearnerProfile` + completeness scoring (the onboarding target schema)
- ☑ Vitest + registry guard tests (prompt existence, tier invariants, cache safety)
- ☑ `/debug/gateway` — makes the gate below verifiable in a browser
- ☑ **Atlas cluster + the two Atlas Search indexes** ([08-setup.md](08-setup.md)) —
      both `READY`, and `pnpm retrieval:eval` reports `lexical=atlas vector=atlas`
- ☑ **At least two model provider keys** — Gemini + Groq
- ☑ **Ollama + `nomic-embed-text`** pulled locally
- ☐ Langfuse project (optional, recommended now — the code is wired, keys are blank)

### 0.4 Eval harness ◐ — built; two golden sets to go

`pnpm eval` runs golden sets through the real gateway and gates regressions
against a committed baseline. How it scores and the rules:
[09-conventions.md § Evals](09-conventions.md#evals).

- ☑ Golden-set runner over `packages/core/src/eval/golden/<task>.jsonl`, with
      frozen fixtures (concept catalogue, 8 corpus chunks, a learner card) so
      scores don't drift as the graph grows; every set is schema-checked in
      `pnpm test` without a model call
- ☑ Deterministic scorers for everything checkable (intent, concept ids, rewrite
      wording, root cause, answer equality, question counts, "must not repeat")
- ☑ Rubric judge `eval.judge@1` with the producer's provider excluded, **asserted
      per case** — on 2026-11-08 every judged case ran on the other provider
- ☑ `pnpm eval --compare` — fails on regression (≥ 2 shared cases flipping in a
      task); the `eval` workflow (`.github/workflows/eval.yml`) runs it when
      prompts, golden sets, the gateway or schemas change, or by hand — never on
      every push, since a run is ~100 calls on the app's own free-tier keys.
      It skips until `GEMINI_API_KEY` / `GROQ_API_KEY` are repository secrets
- ☑ Provider outages are *inconclusive* (`?`), not failures; Ollama never
      produces eval answers
- ☑ Rule enforced, not trusted: `--compare` refuses a prompt version bump on a
      task with fewer than 10 golden cases
- ☑ Golden sets — 65 cases: `query.understand` 13, `slip.classify` 11,
      `card.solve` 11, `tutor.answer` / `tutor.teach` / `tutor.coach` 10 each
      (the Coach set opens with the 2026-11-08 "I don't know" loop, verbatim)
- ☐ Golden set for `concept.propose` **resolution** (passage → right existing
      node) — needs the live graph and embeddings, so a different runner shape
- ☐ Golden set for `card.generate`

**Baseline, 2026-11-08** (`packages/core/src/eval/baseline.json`):

| Task | Pass | What fails — kept failing on purpose |
| --- | --- | --- |
| `query.understand@2` | 13/13 | — |
| `card.solve@1` | 11/11 | — |
| `tutor.answer@1` | 9/10 | Not labelling an off-syllabus answer as general knowledge |
| `tutor.teach@1` | 9/10 | Re-asking the same check question after a wrong answer |
| `tutor.coach@1` | 7/10 | After two misses, re-asks instead of explaining the step; states a simple fact instead of coaching |
| `slip.classify@2` | 6/11 | Reaches for `misconception` on fast, high-mastery slips; ignores weak-prerequisite evidence |

**First prompt change measured by it:** `query.understand@2` (a short reply right
after the tutor's question is an *answer* to it; maths words kept exactly) beat
`@1` 13/13 vs 12/13 on two runs each — `@1` read "tan" as an unclear request and
once rewrote "cos 30" as "ω 30°".

### Gate 0 ☑ (gateway) · 0.4 still open

> A `generate()` call for a task with a Zod schema returns validated typed data;
> forcing the primary provider to fail produces a **successful** response from the
> next provider; both attempts appear in the trace with `failoverDepth` recorded.

Verify with: `pnpm setup:check` then the `/debug/gateway` page.

**Passed 2026-11-08.** `query.understand@1` validated on groq at depth 0; with groq
forced down, gemini served it at depth 1, and `llmCalls` holds both attempts under
one trace id. Phase 0 is not *closed* until 0.4 (the eval harness) exists.

---

## Phase H — Hardening ☑ — Gate H passed 2026-11-09

*Inserted 2026-11-08, after a full review (docs vs code, the hard rules, and a
walk-through as a new learner). Everything here was **verified in the code or
seen happen** — no speculative items. It comes before new features because the
features already exist; what they lack is integrity.*

### H.0 Found by using it (2026-11-08) ☑

- ☑ **Signing in to an existing account returned 500** ("Invalid id value"):
      Next bundled a second copy of `mongodb`/`bson` because `apps/web` didn't
      depend on `mongodb` directly, so Better Auth's `instanceof ObjectId` check
      failed. Sign-up never touched that path, which is why it went unnoticed.
      Fix: `mongodb` is a direct dependency of `apps/web`, and `better-auth` +
      its Mongo adapter are server-external
- ☑ **An English-only learner in India got tutor replies in Hindi** — the learner
      card stated no language for English, and the prompt's Hinglish guidance
      filled the gap. The card now always states the language, by name
- ☑ `/` was a developer status page with no way in; it is now a landing page
      (signed-in learners are redirected), and the status page lives at `/debug`

### H.0b Found by testing everything (2026-11-09) ☑

Full write-up: [test-reports/2026-11-09.md](test-reports/2026-11-09.md).

- ☑ **Structured output dropped LaTeX backslashes.** A strict-schema JSON decoder
      only allows `\" \\ \/ \b \f \n \r \t \u`, so `\sqrt`, `\dfrac`, `\sin`,
      `\circ`, `\phi` came back as `sqrt`, `dfrac`… (5 of 8 newly verified cards).
      `parseModelJson` now restores known commands inside maths
      (`core/llm/latex.ts`); 15 stored questions repaired
- ☑ **Cards that cite what the learner never sees** — "According to the
      passage", "In the worked example", "the triangle shown": 9 of 30 generated.
      Now a structural fault; 4 verified cards re-audited to `rejected`.
      The generator still writes them — `card.generate@2` needs a golden set first
- ☑ **`/debug/gateway` spent two model calls per anonymous request in
      production** even though it answered 404: a layout's `notFound()` does not
      stop its page rendering in parallel. `middleware.ts` now 404s `/debug` before
      anything renders; the page guards itself too
- ☑ **The feed re-served a card seconds after it was answered**, so its worked
      solution was still on screen — free mastery. Cards answered in the last
      12 h (`RESERVE_AFTER_MS`) are held back; Today counts what Reps will serve
- ☑ `DELETE /api/sessions` answered `{ok:true}` for another learner's chat (it
      changed nothing — the write is scoped); it now answers 404
- ☑ Baseline response headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`,
      `Permissions-Policy`); `X-Powered-By` off. ☐ CSP still to do — KaTeX inline
      styles and the pre-paint theme script need a nonce or hashes
- ☑ GCSE learner retrieved nothing (the corpus is CBSE-tagged and the curriculum
      filter was hard): curriculum is now a preference with a labelled top-up
      ("Another syllabus › …") — retrieval:isolation still passes

### H.0c Found in use, same day (2026-11-09) ☑

- ☑ **The tutor steered a biology question to trigonometry.** Retrieval always
      returns its top k, so "what is photosynthesis" got six trig passages; the
      learner card then pulled in those concepts' mastery and any misconceptions.
      Now: a relevance gate keyed on query understanding (`context/relevance.ts`),
      a learner card scoped to the gated concepts, a `no-material` flag
      (*General explanation*), and `tutor.*@3` — v2 plus one grounding rule
      (evals: answer 9/10, teach 9/10, coach 8/9, no regressions)
- ☑ **Questions sometimes classified `chitchat`** (no retrieval, 1,000-token
      reply). A deterministic guard (`context/intent.ts`) + golden qu-14..17. A
      `query.understand@3` was tried and dropped: it regressed qu-06 (meta)
- ☑ **Feature switching felt laggy.** No route had a loading state, and Reps,
      Map and Slips fetched their data after the page — two round trips. Now:
      `loading.tsx` skeletons everywhere (first change 5–7 ms, prefetched), first
      data rendered on the server (`lib/data/*` shared with the API routes),
      independent queries batched. Reps 950 → 320 ms, Map 530 → 325 ms, answer →
      verdict ~400 ms. `pnpm dev` on Turbopack. Measurements in
      [11-experience.md](11-experience.md#performance-budgets)
- ☑ Browser dialogs replaced by Grasp's own (`useConfirm`); delete is a bin icon,
      not ×; select chevrons drawn at the field inset; one height for all fields;
      `color-scheme` per theme; `microphone=(self)` (the security header had
      blocked dictation)
- ☐ Ask's first token is still p50 ~5.5 s on free-tier Gemini — a provider
      limit, not ours. A paid tier, or routing the tutor to a faster first
      provider, is the fix; minimal thinking measured < 1 s better and noisy

### H.1 Event log and learner state — first, because it cannot be fixed later

- ☑ **Attempt idempotency from a client attempt id** (UUID per card render,
      Zod-validated) — verified live: two concurrent POSTs plus a retry with one
      id ⇒ 1 event, 1 attempt row, 1 fold
- ☑ Client in-flight guard on Reps — a double keypress no longer records twice
- ☑ **Fold only from a persisted event.** Emit failure ⇒ 503 and nothing is
      folded; every mastery row is stamped with `updatedFromEventSeq`, and the
      fold uses optimistic concurrency so two racing attempts both land
- ◐ `recordAttempt()` in `core/learner` — grading, the event and the fold moved
      out of `/api/attempt` (now ~40 lines). Still in `apps/web`: the feed's
      candidate selection and the map's depth/blocker logic. `masteryFromDoc()`
      replaced four drifting copies of the row→record conversion
- ☑ Read-only events scope — `UserScope.events()` exposes only reads (tested)
- ☑ `attempts.questionId` stored as a string, like the event payload (rule 12);
      one attempt row per event via a unique `(userId, eventSeq)` index
- ☑ **Rule 13:** model concept ids pass `knownConceptIds()` (exact id → alias or
      name → slug; unmatched dropped) before they boost retrieval, reach the
      tutor, enter a `doubt.asked` event or tag a generated question. The
      `query.understand` catalogue is the learner's subjects (≤400), not "the
      first 200 rows"
- ☑ **`pnpm learner:rebuild`** (shadow, read-only): replays `attempt.recorded`
      through the pure fold and diffs against stored mastery. First run: 3 of 4
      learners identical; one August test account has 2 folds with no event —
      the pre-H.1 bug, caught in real data. `--write` waits until the report is trusted
- ☑ `/api/attempt` only grades `verified` questions (rule 6 — grading by id used
      to return a quarantined card's answer and move mastery on it)
- ☑ Feed serves only `mcq`, the one type the Reps UI can answer

### H.2 Retrieval

- ☑ **Scope filter inside the search** — `$vectorSearch.filter` and `$search`
      `compound.filter` (`searchScopeFilter`), plus the `$match` after both as a
      second line of defence. Curriculum-neutral content uses an indexed
      `curriculumNeutral` flag (backfilled; `$size` can't run in a pre-filter).
      **`pnpm retrieval:isolation`: 1,008 foreign-user copies of the corpus, every
      result unchanged, none leaked.** `recall@5` still 100%
- ☑ Embedder down ⇒ keyword-only answer (`legs.vector: 'unavailable'`, message
      flagged `keyword-only`) instead of a failed turn
- ☑ `scopeFilter` + `searchScopeFilter` security tests
- ☑ `pnpm db:indexes` creates/updates both Atlas Search indexes itself and
      reports `unchanged` when they match

### H.3 Gateway, latency and cost

- ☑ **Streaming timeouts.** The stream path never applied `timeoutMs`: an
      overloaded provider that accepted the request and went quiet hung the Ask
      turn forever. Now: 10 s first-token deadline → failover, plus the task's
      overall timeout
- ☑ **Caller abort is not a provider failure** — Stop, or closing the tab, used to
      fail over and spend the next provider's quota on nobody
- ☑ **Provider cooldown** — a provider that just failed transiently sinks to the
      back of its tier for 60 s, so an outage costs one request its deadline
      instead of every request
- ☑ **LaTeX in model JSON** — `"\theta"` parsed as TAB + "heta"; `"\sin"` failed
      the parse outright. Repaired before parsing; 2 stored questions fixed
- ☑ `query.understand` on the Ask path has a 1.5 s deadline, then the raw
      message is used (Groq answers it in ~0.5–0.8 s; 700 ms would drop too many
      good rewrites)
- ☑ Repair turn is a versioned prompt (`schema.repair@1`); the unused
      `tutor.explainAnswer` task (which borrowed another task's prompt) is removed;
      `chat/route.ts` reads the prompt version from the registry
- ☑ **Cost guard** — over `GRASP_DAILY_TOKEN_BUDGET` output tokens today, a
      learner's tutor turns run on `fast` (`llm/budget.ts`, index `user_daily`)
- ☑ Rate limit: 12 tutor turns per learner per minute, 429 + `retry-after`
      (in-memory — Redis before a multi-instance deploy)
- ☑ `ttftMs` recorded on every tutor message (Gate 1's number)
- ☑ **`mid` chain decided from `ttftMs`: Gemini stays first, on its lightest
      model.** `gemini-flash-latest` was overloaded all day on 2026-11-08 (a Coach
      turn: 10.5 s to first token). `GEMINI_MODEL_MID` is now
      `gemini-3.1-flash-lite` — free-tier limits are per model and far higher for
      flash-lite, and it streams its first token in ~0.9–1.5 s with no thinking
      tokens. Live: tutor turns served by it at depth 0, `ttftMs` 3.3 s (was 10.5 s).
      Pinned rather than aliased so fast and mid use separate quota buckets.
      (`gemini-2.5-flash-lite` is listed for the key but 404s.)
- ☐ **TTFT to Gate 1's 1.5 s:** the model is now ~1 s of the 3.3 s; the rest is
      `query.understand` (~0.8 s) and retrieval running *before* it. Next: start
      retrieval on the raw message in parallel with the rewrite, and stream the
      tutor while the rewrite-based retrieval refines
- ☑ `/debug/*` 404 in production (`debug/layout.tsx`)
- ☑ Cooldown backs off 1 → 2 → 4 … → 10 min while a provider keeps failing —
      a flat 60 s let an hours-long Gemini overload cost every turn 10 s again

### H.4 API safety

- ☑ Every route body and id param validated from `@grasp/schema`, 400 on failure
      (`attempt`, `feed`, `chat`, `profile`, `sessions`)
- ☑ Hand-written duplicates of schemas replaced (rule 3): `ContextBundle` is now
      the schema's (which was rewritten to describe the real bundle),
      `MasteryStateRecord` derives from `Mastery`, `DocEvent` from `StoredEvent`,
      the Reps client's `Card`/`Graded` from `FeedCard`/`AttemptResult`
- ☑ Raw error text never reaches the client — routes use `serverError()`;
      `/api/health` shows driver detail only outside production
- ☑ Chat stream: `send` is safe after disconnect; the answer is saved regardless
      and flagged `interrupted` when cut short
- ☑ Chat history is the *latest* 40 messages — it was the oldest 40, freezing
      context from turn 21 and hanging new messages off message #40
- ☑ Slip classification via `after()`, not `void`
- ☑ Groq's "Failed to generate JSON" 400 is treated as a model failure and fails
      over (no cooldown), instead of dropping `slip.classify` to its prior
- ☑ Feed query sorts before `.limit(500)` and skips concept-less cards; the
      Slips query has its own index (`user_recent`)

### H.5 Engineering hygiene

- ☑ **Biome** (`pnpm lint`, recommended rules, lint only): 0 errors; 44 warnings
      left visible (mostly non-null assertions in older code). Every suppression
      carries its reason
- ☑ **`pnpm lint:boundaries`** — provider hosts/SDKs only in `core/llm` (rule 1),
      no package imports the app, no `grade` field (rule 10). Proven to fail on a
      planted violation
- ☑ **CI** — `.github/workflows/ci.yml`: frozen install, typecheck, both lints,
      unit tests and the **production build** on every PR and push to `main`.
      The build step (added 2026-11-09) needs no secrets: building without the
      env file failed until the auth route stopped creating Better Auth at
      import. Runs on GitHub
      (`yashwanthnaikbhukya/Grasp`, public) since 2026-11-09 — first run green in
      33 s. The `eval` job skips until `GEMINI_API_KEY` / `GROQ_API_KEY` are
      added as repository secrets
- ☐ `pnpm eval --compare=main` in CI (after 0.4)
- ☑ Tests for `verifyCitations` (2026-11-09). Writing them showed grouped
      markers (`[c3, c6]`) were never counted, and gpt-oss writes `【c1】`, which
      showed as raw text. One `normalizeCitations` (`@grasp/schema/citations`)
      now feeds the renderer, read-aloud, verification, evals and the saved text
- ☐ Move the feed's candidate selection and the map's depth/blocker logic out of
      `apps/web` into core (the last business logic in a surface)

### Gate H ☑ — passed 2026-11-09

> A duplicate attempt POST changes nothing; mastery for a test learner is rebuilt
> from `events` alone and matches what is stored; with 1,000 foreign-user chunks
> present, own `recall@5` is unchanged; CI runs lint + typecheck + tests on every
> PR and is green.

- ☑ Duplicate attempt POST changes nothing (two concurrent + one retry ⇒ 1 event,
      1 attempt row, 1 fold — verified live)
- ☑ Rebuild from `events` matches stored mastery for every learner whose folds
      came from persisted events (`pnpm learner:rebuild`); the one drifted test
      account predates the fix
- ☑ 1,000 foreign-user chunks, own results unchanged (`pnpm retrieval:isolation`)
- ☑ CI runs lint + typecheck + tests on every push and PR — first GitHub run
      green on 2026-11-09 (`check` job, 33 s)

---

## Phase 1 — Ask ◐

*Weeks 3–6. Goal: a tutor that is visibly not ChatGPT.*

### 1.0 Onboarding ◐

Built **before** chat, because the learner card is empty until it exists. Full
spec: [10-onboarding.md](10-onboarding.md).

- ☑ Four screens, progressive, each saving as it goes
- ☑ Region picker — 30 one-tap countries plus every other country — →
      programme candidates, notation, locale
- ☑ Age asked plainly, never inferred + stage picker with **local labels**, from
      Class/Grade/Year 1 through college years 1–4, Master's and Doctorate
      ([ADR 0008](adr/0008-programmes-subjects-tertiary-stages.md))
- ☑ **Any student, any subject** (2026-11-09): 100 programmes in 40 regions —
      school boards, entrance and admission exams (JEE, NEET, CUET, SAT, GRE,
      JAMB, ENEM…), university coursework and degrees, professional
      qualifications (ACCA, CFA, CA, CPA), olympiads — searchable and grouped by
      kind; subjects from a ~100-subject catalogue in 12 groups with search,
      browse and type-your-own. Seed held to the catalogue by tests
- ☐ Content for subjects beyond maths — Ask answers any subject today (marked
      *General explanation*); Map and Reps fill in as material is ingested
- ☑ Goal (incl. *career*) + exam date, with the chosen programmes' exams as
      one-tap labels + minutes/day
- ☑ Instruction language (34) + code-switching pair
- ☐ Country geo-guess from request headers (currently a plain picker)
- ☐ `profileCompleteness` nudge in the UI (the function exists and is tested)
- ☐ **Consent gating by age and region** — under threshold ⇒ guardian flow.
      Required before any real learner; not needed on synthetic data
- ☐ Learner-card snapshot tests across the profile matrix
- ◐ Accessible choice chips, labelled fields ☑; programmes ranked by region and
      stage fit ☑; goal defaulted from the answers ☐; primary button always on screen ☐
      — details in [11-experience.md](11-experience.md#onboarding--exists-4-steps-saves-as-it-goes)

### 1.6 Auth ☑

- ☑ Better Auth + Mongo adapter, email + password, 30-day rotating sessions
- ☑ Better Auth owns credentials; Grasp's `users` holds the learner record,
      linked by `authId` — an auth-library upgrade can never migrate learner data
- ☑ `requireUser()` / `requireOnboarded()` hand back a **pre-scoped** `UserScope`,
      so the natural thing to reach for is already user-filtered
- ☑ **`UserScope` / `ScopedCollection`** — owner filter injected into every read,
      owner stamped on every write, `$setOnInsert` on upsert so a miss cannot
      create an unowned document. A mismatched owner **throws** rather than being
      silently rewritten, because a silent override hides the bug
- ☑ 19 cross-user isolation tests (security tests — blocking them is not negotiable)
- ☑ `userId` denormalized onto `messages` so scoping is a direct filter, never a
      join through `chatSessions` that someone could write wrong
- ☐ Magic-link sign-in (needs Resend)
- ☐ Email verification (blocked on the same)

Verified live against Atlas: sign-up → session → empty profile → onboarding save
→ signed-in render. Anonymous `/api/profile` returns 401; anonymous `/app`
redirects to `/login?next=/app`. A learner stored as `stage: 10` with
`region: NG` renders as **"SSS 1"**.

### 1.1 Ingestion ☑

- ☑ Chunker (layout-naive; heading-path aware; never splits display maths)
- ☑ Local embedding via Ollama, batched
- ☑ `concept.tag` pass over every chunk (8 of 9 tagged on the first chapter)
- ☑ Stamp `curriculumIds`, `subject`, `stageRange`, `language` on every chunk
- ☑ Ingest one textbook chapter end to end (`data/corpus/trigonometry.md`)
- ☑ Retrieval eval: 20 hand-written student questions — `recall@5` **100%
      (20/20)**, rank-1 55%, on the Atlas indexes (`pnpm retrieval:eval`)

### 1.2 Retrieval ◐

- ☑ Atlas Search (BM25) leg
- ☑ Atlas Vector Search leg
- ☑ RRF fusion + concept boost
- ◐ Rerank — lexical-overlap rerank (20% weight) today; the local cross-encoder,
      top-20 → top-5, is still ☐
- ☑ Profile-driven scope filter; curriculum-neutral content stays eligible
- ☑ **Security test on `scopeFilter` itself** — the filter runs inside
      `$search` / `$vectorSearch`, with unit tests and `pnpm retrieval:isolation`
      (H.2): a user never retrieves another user's chunks
- ☐ Rank-1 hit rate above 55% (it is the number a learner actually feels)

### 1.3 Context broker v1 ☑

All six steps from [05-context-broker.md](05-context-broker.md). Budget allocator,
learner card and RRF fusion are pure and unit-tested — that is where correctness
lives.

- ☑ `query.understand` — rewrite, concept tags, intent
- ☑ Per-intent budget profiles, explicit allocation, shed reporting
- ☑ History compaction (verbatim tail; digest wiring pending)
- ☑ Hybrid retrieval with profile-driven scope filter
- ◐ Learner card with mastery, prerequisite gaps, notation — the misconceptions
      slot is wired but nothing writes `misconceptions` or `episodes` yet
- ☑ Citation ids stamped; `verifyCitations` flags fabricated and ungrounded

### 1.4 Chat ◐ — **usable end to end**

- ☑ SSE streaming from a route handler, failover before first token only —
      with a 10 s first-token deadline and provider cooldown (Phase H.3)
- ☑ Sessions: sidebar, auto-title, archive, reload
- ☑ Markdown + maths + code blocks, streaming-safe renderer
- ☑ Citation markers inline, expandable source panel with headings and excerpts
- ☑ Stop generation
- ☑ Socratic default — probe once, then explain
- ☑ Per-turn diagnostics: intent, rewrite, concepts, sources, timings
- ☑ `parentMessageId` written on every message (tree stored; branching UI pending)
- ◐ Edit the latest question in place, Regenerate the latest answer — the old
      messages get `supersededAt` (kept for evals, never shown or resent).
      Editing an earlier message as a real branch is still to do
- ☑ Answer feedback (Good / Bad → `messages.feedback`), Copy, Read aloud
- ☑ Chat layout (learner right, tutor left), composer with attach / dictate /
      mode menu / icon send, thinking state, typing reveal (2026-11-09)
- ☐ Cross-session search
- ☐ Session digest for long conversations (verbatim tail only for now)
- ☑ **Chat modes** — *Answer* (direct, like a general assistant), *Teach*
      (step by step, then one check question; the default), *Coach* (one step and
      one question at a time). Picked per message, remembered per conversation;
      one prompt per mode (`tutor.answer@1` / `tutor.teach@1` / `tutor.coach@1`)
- ☑ **Two-way dialogue rules** shared by every mode — "I don't know" / "explain"
      ⇒ explain now; an answer to the tutor's question ⇒ say what's right or
      wrong and build on it; never repeat a question. Fixes a reproduced loop where
      the tutor asked the same probing question twice to "explain me whole"
- ☑ Earlier turns go to the model as real chat messages, not a text block
- ☑ **Rendering on standard libraries**: react-markdown + remark-gfm (tables) +
      remark-math + rehype-katex (typeset maths, MathML for screen readers), in
      Ask *and* Reps
- ☑ **Diagrams in answers** — the tutor can emit a ```plot block (function
      graphs, triangles, the unit circle), Zod-validated (`PlotSpecSchema`),
      drawn with Mafs, expressions compiled by mathjs (never `eval`)
- ◐ Thinking state from the real phases — built; elapsed time after 3 s and
      *Try again* at 30 s still to do
- ☑ Session list as a drawer on narrow screens — the whole sidebar is one under
      900 px (1.8)
- ☐ No empty "New chat" rows left behind by a failed turn
- ☐ History follows the active path from `activeLeafId`; fixture test at 60 turns

### 1.5 Attachments ◐ — interim path built (2026-11-09)

Built: `POST /api/attachments` (one file, multipart) checks the type by its
bytes (`sniff`), stores it on the Mongo document (`storage: 'inline'`, TTL 30
days), and reads it once with `attachment.read@1` — a vision call made only to
providers that can open the file (`reads`, Gemini today). The transcript goes
into understanding, retrieval and the tutor's turn; the image or PDF itself also
goes to the tutor when its provider can read it. Limits in
`ATTACHMENT_LIMITS` (4 per message; 5 MB image, 8 MB PDF, 300 KB text; 20
uploads / 10 min). Served back scoped, with `nosniff` and a sandboxing CSP.

- ☐ Presigned R2 upload from the browser (replaces the inline bytes)
- ☐ Inngest extraction job: detect → extract → chunk → embed → index
- ☐ Image path: vision description + OCR, both indexed
- ☐ PDF path: text + page images
- ◐ Real extraction status in the UI — the chip says *Reading…*; Send waits
      for it rather than answering from a partial read
- ☐ **Both scopes**: `session` (TTL'd) and `library` (persists into the corpus)
- ☐ Blocked on H.2: the scope filter must run inside the search first, or
      attachments arrive as a retrieval regression

### 1.7 Production path ☐

Nothing is deployed yet, and two decisions lock in once it is.

- ☐ **ADR 0008 — where embeddings run in production.** Ollama is localhost; a
      serverless host has none. `nomic-embed-text` at 768 dims is baked into the
      vector index, so changing model later means re-embedding everything
- ☐ Vercel preview + production deploys from `main`, env from the platform
- ☑ `ttftMs` recorded on every tutor message, measured from request receipt
- ☐ **Safety intent**: distress / self-harm / abuse ⇒ a fixed, kind reply plus
      the regional helpline, never a tutoring answer. ≥30 golden cases, 100%
      routed. `Intent` has no safety class today ([10-onboarding.md](10-onboarding.md))
- ☐ Error tracking; uptime check on `/api/health`

### 1.8 Experience ◐ — shell, identity, Today and Profile built

The shell around the surfaces. Spec: [11-experience.md](11-experience.md).

- ☑ **One platform shell** (ChatGPT/Claude pattern): sidebar with logo, New chat,
      Today · Ask · Reps · Map · Slips, recent chats and an account menu;
      collapsible on desktop, a drawer on phones. Features hand off to each other
      (`/reps?concept=`, `/ask?q=`, `/ask?session=`)
- ☑ **Identity**: the Grasp mark, wordmark, app icon / favicon and a feature icon
      family with per-feature colours — `components/brand/`, review at `/debug/brand`
- ☑ **Today** replaces the `/app` profile dump: next action, today/week/ideas,
      fix this first, last conversation, slip pattern, explore. (Daily-goal ring and
      placement still ☐)
- ☑ `/` is a learner landing page (signed-in ⇒ redirected into the app); the
      developer status page moved to `/debug` with honest states
- ☑ `/profile` — Profile & settings: answers in human words (*Edit answers*),
      appearance (system / light / dark), account and sign-out
- ☐ Shared accessible primitives (`Chip`, `Field`, `Checkbox`, `Button`, `Sheet`)
- ☐ Playwright: sign-up → onboarding → Ask turn → Reps session, with axe at 0
      serious violations, in CI

### Gate 1 ☐

> A 20-turn conversation with 3 attachments: stays coherent, stays inside its
> token budget (`bundle.budget.shed` empty on typical turns), cites real
> retrievable sources, `fabricated-citation` rate is 0 across the golden set, and
> p95 time-to-first-token is under 1.5 s **measured by `ttftMs`** — and a new
> learner gets from `/` to a first answered card without being shown raw LaTeX,
> a developer page, or a dead wait.

---

## Gate R — first real learner ☐

*Not a phase of features: the line between synthetic data and a real child's
data. Gate 2 needs real attempts, so this sits between Gate 1 and Gate 2. The
checklist in [08-setup.md](08-setup.md#security-checklist-before-any-real-learner-touches-this)
is part of it.*

- ☐ Consent gating by age and region, with an integration test: an
      under-threshold account writes nothing beyond itself until consent lands
- ☐ **ADR — erasure vs an append-only `events` log.** Deletion is mandatory
      under DPDP/GDPR; decide between per-user crypto-shredding and
      pseudonymisation *before* the first real event is written
- ☐ Account export and delete across every user-owned collection, tested
- ☐ Atlas tier with backups (M0 has none); one restore drill; RPO ≤ 24 h
- ☐ Alert on 5xx > 1% over 5 min
- ☐ A no-training model tier for all real-learner traffic
- ☐ Atlas network access restricted to deploy egress (it is `0.0.0.0/0` for dev)
- ☐ WCAG 2.2 AA on onboarding, Ask and Reps: keyboard-only and reduced motion
- ☐ `/reps` LCP < 2.5 s p75 on a mid-range Android over 4G; < 200 KB JS gzipped
      per route
- ☐ Privacy notice and terms per regime; incident runbook (provider outage,
      leaked key, Atlas full)

> **Gate R:** every item above is ticked, and one person who is not the author
> has walked the consent, export and delete flows end to end.

---

## Phase 2 — Reps ◐ — **loop closed end to end**

*Weeks 7–10. Goal: the loop closes. This is the phase that makes Grasp a platform.*

### 2.1 Question bank ◐

- ☑ `card.generate` from chunks, targeting concept objectives
- ☑ **Verification pipeline**: structural check → two solves → judge → persist.
      `pnpm cards:build`
- ☐ Make the two solves actually independent — today both are identical
      `card.solve` calls on the same chain, so one model agrees with itself.
      The second solve excludes the first solve's provider
- ☐ Structural check rejects control characters in any text field (the
      "sin heta" cards passed verification)
- ☑ Structural check rejects a card that refers to a passage, worked example
      or figure the learner never sees (H.0b)
- ☐ **`card.generate@2`** — tell the generator the learner never sees the
      passage, and to write `\\sin` inside JSON. Blocked on a `card.generate`
      golden set (≥10 cases; `--compare` refuses the bump without one)
- ☐ **Bank volume.** 8 tagged chunks → 8 verified cards (2026-11-09; pass rate
      33% with the new checks). A learner finishes everything in one sitting.
      Ingest more material, then `pnpm cards:build` at scale
- ☑ Only `verified` questions are servable (enforced in the feed query *and*, since
      Phase H, in `/api/attempt`)
- ☑ Answer comparison handles fractions, roots, percentages, set vs sequence
- ☐ Human spot-check UI for the quarantine queue
- ☐ *Report a problem* on every card → quarantine; < 2% errors on a 50-card
      spot-check per release
- ☐ Card types beyond mcq wired into the UI (the feed serves `mcq` only until then)

Observed pass rate 67%. The rejects were real: one asked "which could NOT be…",
the trick phrasing `card.generate` explicitly forbids — verification caught the
generator breaking its own rules.

### 2.2 Learner model ☑ (calibration job pending)

- ☑ Mastery fold: Elo blended with a smoothed hit rate, forgetting curve, pure
- ☑ Latency as signal — fast+wrong discounted as a guess
- ☑ Brier scoring against a constant baseline
- ☐ Weekly calibration job
- ◐ `pnpm learner:rebuild` — shadow replay + diff report ☑ (H.1); `--write`
      waits until the report is trusted

### 2.3 Feed ◐ — **usable**

- ☑ Scheduler: four pools + difficulty band + diversify
- ☑ `/api/feed` — no model call on this path; answer key never leaves the server
- ☑ `/api/attempt` — server-side grading, event append, mastery fold
- ☑ Card UI with keyboard control (1–9 to answer, Enter to continue)
- ☑ Verdict with worked solution and the mastery delta
- ☑ Streak, progress rail, haptics on mobile web
- ☐ Redis pre-generation (feed is computed per request for now)
- ☐ Wrong answer → streamed explanation from a pre-warmed bundle
- ☐ Daily goal ring, XP
- ☐ 8-question cold-start placement (`placementNext` exists and is tested)
- ☑ Recently answered cards held back for 12 h; "All caught up" end state
- ☐ End-of-session summary: accuracy, concepts that moved, next due, one next step
- ☐ PostHog D1/D7 retention on Reps — Reps has shipped, so the clock has started

### Gate 2 ☐

> A 50-card session has zero perceived latency (no model call in the swipe path,
> verified in the trace), **and** the weekly calibration job shows mastery beating
> the constant baseline on Brier score — over **≥ 2,000 next-attempt predictions
> from ≥ 20 consented learners**, with a bootstrap 95% CI that excludes the
> baseline.

The second half is the real gate. If mastery doesn't predict better than a
constant, the personalization is theatre and no amount of UI fixes it. Synthetic
learners only test the plumbing — this gate needs Gate R first.

---

## Phase 3 — Snap + Slips ◐

*Weeks 11–13. Goal: prove the thesis — a doubt becomes tomorrow's practice.*

- ☐ `services/ai` (Python FastAPI): layout-aware parsing, OCR, `sympy`
- ☐ Snap: photo → extract → `doubt.decompose` → step-wise walkthrough that
  pauses and asks *what next?*
- ☐ Auto concept-tag the doubt → feeds tomorrow's weak pool
- ☐ Math answer equivalence via `sympy` (`1/2` = `0.5` = `2⁻¹`)
- ☑ Slips: signal prior reconciled with `slip.classify@2`, fixed taxonomy
- ☑ Mistake notebook UI, filterable by root cause, with the dominant pattern named
- ☑ Low-confidence labels withheld from the learner, count surfaced
- ☐ Weekly Error-DNA digest

### Gate 3 ☐

> Root-cause labels agree with your own hand-labels on ≥80% of a 100-attempt
> sample, **and** a photographed doubt produces cards in the next day's feed
> without manual intervention.

---

## Phase 4 — Duel + Map ◐

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

### 4.2 Map ◐

- ☑ Concept DAG with mastery heat — hand-rolled layered layout, no graph library
- ☑ Deterministic and stable under input reordering (spatial memory matters)
- ☑ Barycentre ordering to reduce edge crossings
- ☑ Critical edges: a weak prerequisite under something being attempted
- ☑ **Weakest chain** — "fix this first", the most useful thing the map can say
- ☑ Node actions: practise / ask about it / see prerequisites
- ☑ Rendered with **React Flow** (`@xyflow/react`) over the same deterministic
      core layout: pan/zoom, fit-to-view (nothing clipped), arrowheads for
      prerequisite → dependent, full names on two lines in one node size
      (`conceptLabel`: sentence case, `sin^2` shown as `sin²`), state in text as
      well as colour, keyboard focus and selection
- ☑ Detail panel for the selected idea (2026-11-09) — beside the graph on wide
      pages, a sheet over it on narrow ones: mastery, *Builds on* / *Leads to*,
      *Practice this*, *Ask about it*; the view pans just enough to keep the
      selection visible
- ☐ "Start here" for a learner with nothing started; a list view for screen readers
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

- Ingesting a second subject before Gate 2 — the schema is already global
  ([ADR 0006](adr/0006-curriculum-agnostic-concepts.md)); a second *corpus* is
  what dilutes retrieval
- Live classes, video hosting, doubt marketplaces
- Native mobile apps (mobile web first; Expo only if the swipe demands it)
- Payments
- Social feed, following, public profiles
- Multi-tenant / white-label

Each is defensible eventually. None belongs before gate 4.
