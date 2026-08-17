# 04 — LLM gateway

`packages/core/src/llm`

Every model call in Grasp goes through one function. Feature code never imports a
provider SDK, never names a concrete model, and never writes a prompt inline.

```ts
import { generate, embed } from '@grasp/core/llm';

const out = await generate({
  task: 'query.understand',        // key into the task registry
  input: { query, history },       // fed to the versioned template
  userId,                          // for the cost guard
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
  prompt: 'slip.classify@3',        // resolved in @grasp/prompts
  schema: SlipClassificationSchema, // from @grasp/schema
  maxOutputTokens: 512,
  cache: true,                      // hash(prompt+input) → Redis
  timeoutMs: 20_000,
}
```

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
| `mid` | Tutor replies, doubt walkthroughs, mindmaps | Directly visible to the learner. |
| `best` | Card verification, root-cause labels, eval judging | Judgments that write to the learner graph. A wrong label persists and poisons downstream state. |

Rule of thumb: **if the output is written into the learner graph rather than
shown once, use `best`.** A bad tutor sentence is forgotten; a bad root-cause
label changes what the learner practises for weeks.

## Provider chain and failover

Providers are tried in order per tier. Configured by which env keys are present,
so the chain adapts to what you've actually set up.

```
fast:  groq → gemini → openrouter → ollama(local)
mid:   gemini → groq → openrouter → ollama(local)
best:  gemini → openrouter → groq
```

Failover triggers on: 429, 5xx, timeout, connection error, and
**schema-validation failure after one repair attempt**. It does *not* trigger on
4xx that indicate a bad request — those are bugs and must surface loudly.

```
attempt(provider[i])
  ├─ ok + schema valid              → return
  ├─ schema invalid → repair once   → ok? return
  ├─ 429 / 5xx / timeout            → next provider (log downgrade)
  └─ 400 / 401 / 403                → throw immediately (your bug)
all providers exhausted             → throw GatewayExhaustedError
```

Ollama sits last on `fast` and `mid` as the offline floor: if every hosted free
tier is exhausted, the app degrades instead of dying. `best` has no local leg
because a small local model cannot do those judgments — better to fail than to
write a wrong label into the learner graph.

## Structured output

Every task whose output is consumed by code declares a Zod schema. The gateway:

1. Converts it to JSON Schema and passes it as the provider's native structured
   output constraint (Gemini `responseSchema`, OpenAI-compatible
   `response_format`, Ollama `format`).
2. Parses and validates the response against the Zod schema.
3. On failure, makes **one** repair call including the validation error.
4. On repeated failure, fails over to the next provider.

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

**Response cache (ours).** `hash(promptVersion + resolvedInput + model)` → Redis,
for tasks marked `cache: true`. Deterministic, idempotent tasks only:
`concept.tag`, `card.generate`, `session.title`. Never `tutor.reply` — the
learner card makes it per-learner by design.

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

Per-user daily output-token budget (`GRASP_DAILY_TOKEN_BUDGET`), counted in Redis.

- Under budget → normal tier.
- Over budget → forced down one tier, with a `degraded` flag on the response so
  the UI can note it.
- Over 2× → `mid`/`best` tasks rejected; `fast` still allowed so the app works.

This protects free-tier quotas from one enthusiastic user as much as it protects
a bill. It's also the mechanism that lets you offer the product without a
per-user cap on the UI.

## Tracing

Every call emits, to both `llmCalls` in Mongo and Langfuse if configured:

`task · tier · provider · model · promptVersion · inputTokens · outputTokens ·
cachedInputTokens · latencyMs · ok · errorKind? · failoverDepth · userId ·
traceId · evalTags[]`

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

Batched, with a small concurrency cap. Chunk and query embeddings use the same
model but are cached separately — query embeddings have high repeat rates and
short TTLs.

## Adding a new kind of model call

1. Add the output schema to `@grasp/schema` (skip if the task streams prose).
2. Add the template to `@grasp/prompts` as `name@1`.
3. Add the registry entry: tier, prompt, schema, budget, cache, timeout.
4. Add a golden set to `packages/core/src/eval/golden/` — at least 10 cases.
5. Call `generate({ task, input })` from feature code.

Step 4 is not optional. A task with no golden set cannot be improved, only
changed.
