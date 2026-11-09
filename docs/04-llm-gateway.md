# 04 — LLM gateway

`packages/core/src/llm`

Every model call in Grasp goes through one function. Feature code never imports a
provider SDK, never names a concrete model, and never writes a prompt inline.

```ts
import { generate, embed } from '@grasp/core/llm';

const out = await generate({
  task: 'query.understand',        // key into the task registry
  input: { query, history },       // fed to the versioned template
  userId,                          // trace attribution + the cost guard (tutor turns)
});
// out.data is typed + validated against the task's Zod schema
```

## Why this is not over-engineering

Three forces make the indirection load-bearing from day one:

1. **Free tiers rate-limit constantly.** 429 is the normal operating condition,
   not an exception. Failover has to live somewhere, and duplicating it per call
   site is how you end up with six subtly different retry behaviours.
2. **You will change providers.** Gemini free tier today, Claude when quality
   starts mattering. If feature code names `gemini-2.0-flash`, that migration
   touches every file.
3. **Without per-call cost and latency attribution you are guessing** about your
   own system — including whether a prompt edit helped.

## Task registry

`llm/registry.ts` maps a task id to everything about how it runs.

```ts
'slip.classify': {
  tier: 'best',
  prompt: 'slip.classify@2',        // resolved in @grasp/prompts
  schema: SlipClassificationSchema, // from @grasp/schema
  maxOutputTokens: 2_000,
  timeoutMs: 20_000,
  cache: false,                     // per-learner — never response-cached
}
```

Two more optional fields: `reasoningEffort` (caps reasoning tokens on
schema-constrained tasks, which would otherwise truncate the JSON) and
`excludeProviders` (providers a task must never fall back to — see below).

Feature code names a **task**. The registry names a **tier**. Provider config
maps tier → concrete model. Three levels of indirection, each earning its place:

```
task ('slip.classify')  →  tier ('best')  →  provider+model (gemini-2.0-flash)
     what you want           how good           what actually runs
```

### Tiers

| Tier | For | Characteristics |
| --- | --- | --- |
| `fast` | Query rewriting, tagging, titling, bulk card generation | Runs on every message or thousands of times. Latency and quota matter more than depth. |
| `mid` | Tutor replies, card verification (`card.solve`), concept proposal, doubt walkthroughs, mindmaps | Directly visible to the learner, or written durably by a background job. |
| `best` | Root-cause labels, eval judging | Judgments that write to the learner graph. A wrong label persists and poisons downstream state. |

Rule of thumb: **if the output is written into the learner graph rather than
shown once, use `best`.** A bad tutor sentence is forgotten; a bad root-cause
label changes what the learner practises for weeks. `card.solve` and
`concept.propose` run on `mid` but get no local fallback (`excludeProviders:
['ollama']`); `registry.test.ts` asserts the solver's tier is at least the
generator's.

With `GRASP_MODEL_PROFILE=dev` (the default), the Gemini adapter collapses
`best` onto the `mid` model to stretch the free quota — see
[08-setup.md](08-setup.md) §3.

## Provider chain and failover

Providers are tried in order per tier. Configured by which env keys are present,
so the chain adapts to what you've actually set up.

```
fast:  groq → gemini → openrouter → ollama(local)
mid:   gemini → groq → openrouter → ollama(local)
best:  gemini → openrouter → groq
```

Gemini leads `mid` on its **lightest** model (`GEMINI_MODEL_MID=gemini-3.1-flash-lite`):
free-tier rate limits are counted per model and are far higher for flash-lite,
and it was the reliable one when the full flash model was overloaded (measured
2026-11-08 from `ttftMs` — see 07-phases.md § H.3). Model ids are env, never code:
`pnpm models:check` shows what a key can actually use.

Failover triggers on: 429, 5xx, timeout, connection error, and
**schema-validation failure after one repair attempt**. It does *not* trigger on
4xx that indicate a bad request — those are bugs and must surface loudly — or on
the caller aborting (the learner pressed Stop or navigated away).

```
attempt(provider[i])
  ├─ ok + schema valid              → return
  ├─ schema invalid → repair once   → ok? return
  ├─ 429 / 5xx                      → retry same provider with backoff (≤2,
  │                                   honours retry-after), then next provider
  ├─ timeout / connection           → next provider (log downgrade)
  ├─ caller aborted                 → throw, no failover
  └─ 400 / 401 / 403                → throw immediately (your bug)
all providers exhausted             → throw GatewayExhaustedError
```

**Cooldown.** A provider that fails transiently (rate limit, 5xx, timeout,
connection) cools down for 60 s on that tier: it moves to the back of the chain,
so the next request doesn't rediscover the same outage. In-memory, per
instance; a success clears it.

**Streaming** (`generateStream`, used by the Ask modes `tutor.answer` / `tutor.teach` / `tutor.coach`) fails over only before
the first token. Each attempt has a first-token deadline (10 s, or the task's
timeout if shorter) and an overall `timeoutMs`.

Ollama sits last on `fast` and `mid` as the offline floor: if every hosted free
tier is exhausted, the app degrades instead of dying. `best` has no local leg
because a small local model cannot do those judgments — better to fail than to
write a wrong label into the learner graph. Tasks that write durable structure
(`concept.propose`, `card.solve`) also exclude it via `excludeProviders`.

## Structured output

Every task whose output is consumed by code declares a Zod schema. The gateway:

1. Converts it to JSON Schema and passes it as the provider's native structured
   output constraint (Gemini `responseSchema`, OpenAI-compatible
   `response_format`, Ollama `format`).
2. Parses and validates the response against the Zod schema. Parsing
   (`parseModelJson`) repairs maths before validation: `repairLatexEscapes`
   re-escapes `\theta`/`\frac` that JSON would read as TAB/form-feed, and
   `restoreLatexDeep` (`llm/latex.ts`) puts back backslashes a strict-schema
   decoder never let through — `\sqrt`, `\dfrac`, `\sin` arrive as `sqrt`,
   `dfrac`, `sin`. Only text inside `$…$` is touched, never `\text{…}`.
3. On failure, makes **one** repair call including the validation error.
4. On repeated failure, fails over to the next provider.

**Files.** A message can carry inline files (`ChatMessage.files` — images,
PDFs). Each adapter declares what it `reads`; the gateway strips files a provider
cannot open (`filesFor`), so the caller always puts a text transcript in the
message too. `generate({ files, filesRequired: true })` tries only providers
that can read every file — used by `attachment.read`, where the file is the
point.

Validation is at the boundary, so feature code receives a typed value or an
exception — never a `JSON.parse` in a feature file, never a defensive
`data?.foo?.[0] ?? fallback` chain.

## Prompt versioning

Templates live in `packages/prompts` as files, keyed `name@version`. The registry
pins a version. Bumping a prompt means adding `name@n+1`, not editing `name@n`.

Why: the version id lands in the trace and on the message document, so a change
in output quality is attributable to a specific prompt change. Editing in place
destroys that.

Prompt content itself is subject to [09-conventions.md](09-conventions.md#prompts).
Two rules worth stating here:

- **Emphasis is a tested fix for one underweighted instruction, not a register.**
  `CRITICAL: YOU MUST` on every line means none of them carry information.
- **Say what you want, at normal volume, with the reason.** Modern models follow
  the system prompt closely; prompts written to overcome older models'
  reluctance now over-trigger.

## Caching

Two independent layers.

**Response cache (ours).** *Planned — not built yet (see
[07-phases.md](07-phases.md)); there is no Redis client, so `cache: true` is
declared intent only.* `hash(promptVersion + resolvedInput + model)` → Redis,
for tasks marked `cache: true`. Deterministic, idempotent tasks only — marked
today: `concept.tag`, `concept.propose`, `session.title`, `mindmap.build`
(`card.generate` is not). Never the `tutor.*` modes, `query.understand` or
`slip.classify` — per-learner by design, and `registry.test.ts` asserts it.

**Provider prompt cache (theirs).** Applies once you move to a provider that
supports it. The mechanic that matters: **it is a prefix match.** Any byte change
anywhere in the prefix invalidates everything after it. Therefore:

- Stable content first (frozen system prompt, deterministic tool order, curriculum
  context), volatile content last (learner card, query, timestamps).
- Never interpolate a date, a UUID, or the learner's name into the system prompt.
- Serialize deterministically — sorted keys, never a `Set` iteration.
- **Verify, don't assume.** Log the cache-read token count. Zero across repeated
  identical prefixes means a silent invalidator.

A second, less obvious trap: **the minimum cacheable prefix differs by model, and
is largest on the cheapest models.** Cheap bulk-generation prompts are therefore
the *least* likely to cache. If you want them cached, build them large and stable
deliberately.

## Cost guard

**Built (2026-11-08)** — `llm/budget.ts`. A per-learner, per-UTC-day ceiling on
*output* tokens (`GRASP_DAILY_TOKEN_BUDGET`, 0 = no ceiling), summed from
`llmCalls` (index `user_daily`) and cached a minute per learner.

- Under budget → normal tier.
- Over budget → the tutor's streamed turns run on `fast`. Applied to tutor turns
  only: background tasks that write durable labels never silently degrade.
- Planned: a `degraded` flag on the response so the UI can say so.

**Rate limit** — `/api/chat` allows 12 turns per learner per minute
(`core/limits.ts`, 429 with `retry-after`). In-memory and per-instance today;
moves to Redis with a multi-instance deploy.
- Over 2× → `mid`/`best` tasks rejected; `fast` still allowed so the app works.

This protects free-tier quotas from one enthusiastic user as much as it protects
a bill. It's also the mechanism that lets you offer the product without a
per-user cap on the UI.

## Tracing

Every call emits, to both `llmCalls` in Mongo and Langfuse if configured:

`task · tier · provider · model · promptVersion · inputTokens · outputTokens ·
cachedInputTokens · latencyMs · ok · errorKind? · errorMessage? · failoverDepth ·
userId · traceId · evalTags[]`

Time-to-first-token is not recorded yet — `latencyMs` is the whole call.

`failoverDepth > 0` is the number to watch. A rising average means your primary
free tier is saturated and it is time to re-order the chain or move a task down
a tier — a signal you cannot get any other way.

If Langfuse keys are absent the gateway logs a single structured line to stdout
instead. It never fails a request because tracing failed.

## Embeddings

```ts
const vectors = await embed({ texts: string[], purpose: 'chunk' | 'query' });
```

Runs locally via Ollama — free, unmetered, and no learner text leaves the
machine. 768 dimensions (`nomic-embed-text`). The dimension is written into the
Atlas vector index definition, so **changing the embedding model means
re-embedding the whole corpus and recreating the index.** Decide once, early.

Today: one batched `/api/embed` request per call, no concurrency cap, no cache.
`embed()` talks only to Ollama. If Ollama is unreachable, **an Ask turn still
answers** — retrieval drops to keyword-only (`legs.vector: 'unavailable'`) and
the message is flagged `keyword-only`; ingestion and the concept resolver, which
must have vectors, fail and retry.
Planned: a small concurrency cap, and separate caches for chunk and query
embeddings (query embeddings have high repeat rates and short TTLs).

## Adding a new kind of model call

1. Add the output schema to `@grasp/schema` (skip if the task streams prose).
2. Add the template to `@grasp/prompts` as `name@1`.
3. Add the registry entry: tier, prompt, schema, budget, cache, timeout.
4. Add a golden set to `packages/core/src/eval/golden/` — at least 10 cases — and
   add the task to `EVAL_TASKS` in `eval/run.ts` with a scorer.
5. Call `generate({ task, input })` from feature code.

Step 4 is not optional. A task with no golden set cannot be improved, only
changed. Six tasks have one today (`pnpm eval`, see
[09-conventions.md](09-conventions.md#evals)); `pnpm eval --compare` refuses a
prompt bump on a task with fewer than 10 cases. Until a prompt exists, list the
task in `PROMPT_PENDING` in `registry.test.ts` or the suite fails.
