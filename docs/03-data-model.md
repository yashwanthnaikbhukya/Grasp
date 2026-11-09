# 03 — Data model

MongoDB Atlas holds documents, the full-text index, and the vector index. One
system, no sync job ([ADR 0001](adr/0001-mongodb-single-store.md)).

**Shapes are defined once, in Zod, in `packages/schema`.** The tables below are
documentation; the schema files are the truth. Never hand-write a TS interface
that duplicates one.

## Two decisions you make now or never

### `parentMessageId` — messages are a tree

Edit-and-regenerate is a behaviour learners expect from any chat product. It
requires message history to be a tree with a rendered active path. Adding that
later means migrating every session ever created. The field costs nothing now.
([ADR 0004](adr/0004-messages-are-a-tree.md))

### `events` is append-only

Mastery is **derived** state. The mastery algorithm will change at least three
times — a naive counter, then Elo per concept, then a proper spaced-repetition
scheduler. Each change requires recomputing every learner's state from history.
If the event log is append-only and idempotent, that is a replay. If it isn't,
it's data loss. ([ADR 0003](adr/0003-event-sourced-learner-state.md))

Corollary: **never `updateOne` on `events`.** Never delete. Corrections are new
events that supersede, not edits.

## Collections

### Identity and profile

**`users`**

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `authId` | string | unique. Links to Better Auth's own credential collections, which Grasp never writes — an auth-library upgrade can never migrate learner data |
| `email` | string | unique |
| `name` | string | display only — never enters a prompt |
| `profile` | LearnerProfile | **everything onboarding discovers** — region, locale, age, stage, curriculumIds, subjects, goal, language, depth, consent. Replaced the old process-level board/grade/subject scope ([ADR 0006](adr/0006-curriculum-agnostic-concepts.md)). Every field optional with a default. |
| `streak` | `{ current, longest, lastActiveDate }` | |
| `xp` | number | |
| `placementDoneAt` | Date? | null ⇒ show cold-start placement |

### Content plane

**`concepts`** — the **universal** graph. Model-proposed and resolver-deduped,
never hand-authored ([ADR 0007](adr/0007-llm-authored-concept-graph.md)). ~150–300
rows per subject. No board, no grade ([ADR 0006](adr/0006-curriculum-agnostic-concepts.md)).

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | stable slug, e.g. `sin-cos-identities`. Human-readable on purpose. |
| `name` | string | canonical international-English name |
| `aliases` | string[] | every local + colloquial variant (`cosec`, `SOH CAH TOA`). **Does real work** — feeds retrieval recall and cross-curriculum tagging. |
| `subject` / `domain` | string | universal, not a curriculum's chapter name |
| `prereqIds` | string[] | **edges of the DAG.** The expensive artifact; generated once, cycle-checked, reused by every curriculum |
| `description` | string | one paragraph, used as tagging context |
| `objectives` | string[] | learning objectives; card generation targets these |
| `stageRange` | `{min,max}`? | **advisory** typical band. Ranks and caveats, never refuses |
| `depth` | number | topological depth, computed by the loader |
| `embedding` | number[] | 768-dim. **Required on every write path** — a row without one is invisible to dedupe |
| `origin` / `proposedFrom` / `generatedBy` | | provenance: `llm` or `seed`, the passage, the model call |
| `needsReview` / `reviewNote` | bool / string | set when the resolver landed in the review band |

**`curricula`** — one row per programme a learner studies or prepares for: a
board or school curriculum, an entrance exam, university coursework, a
professional qualification, a competition ([ADR 0008](adr/0008-programmes-subjects-tertiary-stages.md)).
Data, not code: adding one is adding a row to `data/curricula.seed.json`.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | stable slug, e.g. `gb-gcse-maths` (now *GCSE*, every subject — ids predate multi-subject programmes and are kept) |
| `kind` | enum | `school` \| `exam` \| `university` \| `professional` \| `competition` \| `self-study` — onboarding's sections |
| `subjects` | SubjectId[] | what it offers, from `packages/schema/src/subjects.ts`; suggested at onboarding, never a limit |
| `name` / `authority` | string | as a learner would recognise it |
| `regions` | string[] | ISO-3166 codes, or `['*']` for international (IB, Cambridge) |
| `stageRange` / `language` | | onboarding candidate filter; stage runs 1–18 (13–16 degree years, 17 master's, 18 doctorate) |
| `notation` | NotationProfile | `csc` vs `cosec`, `trapezoid` vs `trapezium`, decimal separator, lakh/crore grouping, units. **Not cosmetic** — `trapezoid` denotes different shapes in US and UK English |
| `exam` | `{name, typicalMonth}`? | drives review urgency |
| `active` | bool | false hides it from onboarding but keeps existing learners working |

**`curriculumMappings`** — the join, and where all local truth lives.

| Field | Type | Notes |
| --- | --- | --- |
| `curriculumId` / `conceptId` | | compound unique |
| `localName` | string? | `cosec` where canonical is `csc` |
| `localCode` | string? | the curriculum's own reference, e.g. `Ch 8.3` |
| `sequenceIndex` | number | this curriculum's teaching order; drives coursework mode |
| `inScope` | bool | some curricula exclude a concept outright |
| `examWeight` | number? | share of the terminal exam; drives revision priority |

> **A missing mapping row means "unmapped", not "out of scope."** An unmapped
> concept degrades to the universal default so the learner sees more, not less.

> **Today:** `pnpm db:seed:curricula` writes mappings, but nothing reads them
> yet — `inScope` gating, `localName` and `sequenceIndex` ordering are planned.

> The whole graph is a few hundred nodes — load it into memory and cache it.
> Do not write recursive `$graphLookup` queries for traversal at this size.

**`docChunks`** — retrievable text. The RAG corpus.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | this id is what the model cites |
| `ownerScope` | enum | `global` \| `user` \| `session` |
| `ownerId` | string? | userId or sessionId when scoped |
| `sourceId` | ObjectId | → `sources` |
| `text` | string | the chunk |
| `embedding` | number[] | 768-dim (`nomic-embed-text`) |
| `conceptIds` | string[] | tags — the interop layer |
| `curriculumIds` | string[] | curricula this content is valid for. **Empty ⇒ curriculum-neutral**, always eligible. Serving several is the normal case |
| `subject` / `language` | string | `language` is the corpus language; the tutor translates, retrieval does not |
| `stageRange` | `{min,max}`? | advisory fit band |
| `page` | number? | for citation deep-links |
| `headingPath` | string[] | e.g. `["Ch 8", "8.2 Identities"]`; prepended at retrieval |
| `tokenCount` | number | the broker budgets on this |
| `expiresAt` | Date? | **TTL for `session` scope.** Protects the 512 MB cap |

**`sources`** — provenance for chunks.

| Field | Type |
| --- | --- |
| `_id`, `kind` (`textbook`\|`notes`\|`upload`\|`transcript`), `title`, `r2Key?`, `pageCount?`, `ingestedAt`, `ownerScope`, `ownerId?` |

**`questions`** — the item bank.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `conceptIds` | string[] | |
| `type` | enum | `mcq` \| `multi` \| `tapError` \| `orderSteps` \| `numeric` \| `label` |
| `stem` | string | LaTeX allowed |
| `options` | `{ id, text, isCorrect }[]`? | for mcq/multi |
| `answer` | unknown | type-dependent; validated by a discriminated Zod union |
| `solution` | string | worked, shown after the attempt |
| `difficulty` | number | IRT `b`; starts as an estimate, refined by attempts |
| `verificationStatus` | enum | `draft` \| `quarantined` \| `verified` \| `rejected` |
| `verification` | `{ solvedBy[], agreement, checkedBy?, notes? }` | audit trail |
| `sourceId` | ObjectId? | provenance if derived from a chunk |
| `generatedBy` | `{ task, promptVersion, model }`? | reproducibility |

> **Only `verified` questions may be served.** Enforced in the feed query, not
> by convention — and `/api/attempt` rejects an attempt on anything else. The
> feed currently serves `type: 'mcq'` only.

### Learner plane

**`mastery`** — one row per (user, concept). Derived; rebuildable.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` / `conceptId` | | compound unique |
| `p` | number | 0–1, probability the learner knows it now |
| `attempts` / `correct` | number | |
| `elo` | number | ability estimate on this concept |
| `stability` / `difficulty` | number | spaced-repetition params |
| `lastSeenAt` | Date | |
| `nextDueAt` | Date | **the due-queue key.** Indexed with userId |
| `state` | enum | `unseen` \| `learning` \| `review` \| `mastered` |
| `updatedFromEventSeq` | number | replay watermark; makes rebuild resumable. **Not yet written by the live fold** in `/api/attempt` — planned with `learner:rebuild` |

> **Planned — not built yet:** nothing writes `episodes` or `misconceptions`
> today. The learner card already reads both, so they render empty until the
> derivations exist (see [07-phases.md](07-phases.md)).

**`episodes`** — semantic memory of what happened. Feeds the learner card.

| Field | Type |
| --- | --- |
| `userId`, `kind` (`doubt`\|`struggle`\|`breakthrough`), `conceptIds[]`, `summary`, `sourceRef`, `createdAt` |

**`misconceptions`** — active, named wrong beliefs. Highest-value context there is.

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `conceptId`, `statement` | | e.g. "treats degrees and radians interchangeably" |
| `evidenceCount`, `firstSeenAt`, `lastSeenAt`, `resolvedAt?` | | resolved when N consecutive correct |

### Interaction

**`chatSessions`**

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `title`, `createdAt`, `archivedAt?` | | `title` is the first message truncated to 48 chars today (`session.title` model call planned) |
| `digest` | `{ text, throughMessageId, tokenCount }`? | rolling summary — the compaction artifact |
| `tokenStats` | `{ in, out, cachedIn }` | per-session cost visibility |
| `activeLeafId` | ObjectId? | which branch of the tree is rendered |

**`messages`**

| Field | Type | Notes |
| --- | --- | --- |
| `sessionId`, `role`, `createdAt` | | |
| `userId` | string | **denormalized on purpose** — scoping is a direct filter, never a join through `chatSessions` |
| `parentMessageId` | ObjectId? | **the tree.** null ⇒ root |
| `parts` | `Part[]` | discriminated: `text` \| `attachmentRef` \| `citation` \| `toolCall` |
| `citations` | `{ chunkId, quoted }[]` | verified post-generation |
| `flags` | enum[] | `fabricated-citation` \| `ungrounded` \| `budget-shed` — the hallucination metric; `keyword-only`, `interrupted`, `no-material` (nothing relevant retrieved — a general-knowledge answer) |
| `sources` | `{ citeId, chunkId, heading, excerpt }[]`? | assistant: every passage the answer was given, under its `[cN]` marker — so a reopened chat shows "N sources" (saved from 2026-11-09) |
| `understoodAs` | string? | assistant: the question as `query.understand` rewrote it |
| `feedback` | `{ rating: up\|down, at }`? | the learner's thumbs on an answer — eval data |
| `supersededAt` | Date? | replaced by Regenerate or Edit; kept, never shown or resent as history |
| `model` / `promptVersion` / `traceId` | string? | reproducibility |
| `usage` | `{ in, out, cachedIn }`? | |

**`attachments`**

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `sessionId?`, `mime`, `bytes`, `filename` | | `mime` is sniffed from the bytes |
| `messageId` | ObjectId? | the user message it was sent with; null while in the composer (only then deletable) |
| `kind` | enum | `image` \| `pdf` \| `text` |
| `storage`, `r2Key?`, `data` | | `inline` today: `data` (BSON Binary) on the document, never in an API response; `r2` later |
| `expiresAt` | Date | TTL index — session attachments go after 30 days |
| `scope` | enum | `session` \| `library` — library persists into the learner's corpus |
| `status` | enum | `uploading` \| `extracting` \| `ready` \| `failed` |
| `extract` | `{ text, pageCount?, chunkCount, warnings[], promptVersion? }`? | the transcript the tutor and retrieval see |

**`attempts`** — one per answered card. The evidence stream.

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `questionId`, `conceptIds[]`, `correct` | | |
| `answer` | unknown | what they actually chose — needed for root-cause analysis |
| `latencyMs` | number | fast+wrong ⇒ careless; slow+wrong ⇒ conceptual |
| `hintsUsed` | number | |
| `surface` | enum | `reps` \| `duel` \| `test` \| `placement` \| `snap` |
| `sessionRef` | string? | duelId, testId, feed session |

**`slips`** — mistakes with root cause.

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `attemptId`, `conceptId` | | |
| `rootCause` | enum | `careless-arithmetic` \| `misread-question` \| `prerequisite-gap` \| `misconception` \| `knowledge-gap` \| `time-pressure` |
| `note` | string | one sentence, learner-facing |
| `confidence` | number | classifier confidence; low ⇒ excluded from digests |
| `resolvedAt` | Date? | |

**`duels`** — see [ADR 0005](adr/0005-duel-is-a-replay.md).

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | 6 chars, unique, uppercase, no ambiguous glyphs |
| `hostId` / `opponentId?` | | |
| `questionIds` | ObjectId[] | **frozen at creation.** Identical order for both |
| `config` | `{ count, secondsPerQuestion, conceptIds[] }` | |
| `status` | enum | `lobby` \| `live` \| `complete` \| `expired` |
| `runs` | `{ userId, answers[], score, finishedAt }[]` | a ghost run is just a run |

**`mindmaps`**

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `sourceRef` (`{kind, id}`), `nodes[]`, `edges[]` | | |
| `edges[].relation` | enum | `is-a` \| `part-of` \| `causes` \| `contrasts-with` \| `requires` — **typed, never untyped** |

### Platform

**`events`** — append-only. See [06-learner-model.md](06-learner-model.md).

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `seq` | number | monotonic; the replay cursor |
| `type` | string | `attempt.recorded`, `doubt.asked`, `card.skipped`, … |
| `userId` | string | **a string, not an ObjectId** — matches every `UserScope` filter. An ObjectId here made events invisible to their owner |
| `payload` | unknown | validated per type by a Zod discriminated union |
| `idempotencyKey` | string | **unique index.** Retries are free |
| `ts` | Date | |

**`counters`** — `{ _id: 'events.seq', value }`. Allocates `events.seq` with an
atomic `$inc`.

**`promptVersions`** — *planned, not built yet:* will mirror `packages/prompts` at
runtime so traces resolve historically even after a template changes. The
collection and its index exist; nothing writes to it.

**`llmCalls`** — thin local record of every gateway call (task, tier, provider,
model, tokens, ms, ok, errorKind/errorMessage, failoverDepth, promptVersion,
traceId). Langfuse is the rich view; this is the one that survives without a
third party, feeds `pnpm traces`, and will power the cost guard (planned).

## Indexes

Defined in `packages/core/src/db/indexes.ts`; created by `pnpm db:indexes`
(idempotent — safe to re-run).

| Collection | Index | Why |
| --- | --- | --- |
| `users` | `{ email: 1 }` unique | login |
| `users` | `{ authId: 1 }` unique | Better Auth → learner record |
| `concepts` | `{ subject:1, domain:1 }` | subject load |
| `concepts` | `{ aliases:1 }` | cross-curriculum tagging + retrieval recall |
| `curricula` | `{ regions:1, active:1 }` | onboarding candidates |
| `curriculumMappings` | `{ curriculumId:1, conceptId:1 }` unique | the join |
| `curriculumMappings` | `{ curriculumId:1, sequenceIndex:1 }` | coursework teaching order |
| `docChunks` | `{ ownerScope:1, ownerId:1 }` | scoped retrieval filter |
| `docChunks` | `{ conceptIds:1 }` | concept-targeted retrieval |
| `docChunks` | `{ curriculumIds:1, subject:1 }` | curriculum-scoped retrieval, per learner profile |
| `docChunks` | `{ expiresAt:1 }` **TTL** | reclaim the 512 MB cap |
| `docChunks` | **Atlas Search** `grasp_chunks_text` | BM25 leg of hybrid |
| `docChunks` | **Atlas Vector Search** `grasp_chunks_vec` | vector leg |
| `questions` | `{ conceptIds:1, verificationStatus:1, difficulty:1 }` | card selection |
| `attempts` | `{ userId:1, conceptIds:1, ts:-1 }` | mastery + slips queries (multikey) |
| `attempts` | `{ questionId:1 }` | item difficulty refinement |
| `mastery` | `{ userId:1, conceptId:1 }` unique | upsert target |
| `mastery` | `{ userId:1, nextDueAt:1 }` | **the due queue, hit on every feed load** |
| `messages` | `{ sessionId:1, createdAt:1 }` | render a session |
| `messages` | `{ parentMessageId:1 }` | walk the tree |
| `messages` | `{ userId:1, createdAt:-1 }` | scoped reads |
| `messages` | **Atlas Search** `grasp_messages_text` | cross-session search (planned — not created yet) |
| `events` | `{ idempotencyKey:1 }` unique | safe retries |
| `events` | `{ seq:1 }` unique | replay |
| `events` | `{ userId:1, ts:-1 }` | timeline |
| `duels` | `{ code:1 }` unique | join by code |
| `slips` | `{ userId:1, rootCause:1, createdAt:-1 }` | Error-DNA digest |

### The two Atlas Search indexes are created separately

`pnpm db:indexes` covers the regular ones. Atlas Search and Vector Search
definitions are separate resources — `createIndexes` cannot make them. The same
command prints the exact JSON; create them in the Atlas UI or with the driver's
`createSearchIndexes` (MongoDB 7.0+, M0 included). Steps in
[08-setup.md](08-setup.md#5-create-the-two-atlas-search-indexes).

## Storage discipline (M0 is 512 MB)

1. **Raw files live in R2, never Mongo.** Only extracted chunks land in Mongo.
2. **TTL on `session`-scoped chunks.** Throwaway uploads are what fills the cap.
3. **Keep chunk metadata lean.** No full-page text duplicated into fields.
4. **`llmCalls` gets a TTL too** (30 days). Langfuse holds the long tail.
5. Embeddings are the bulk: 768 floats ≈ 6 KB/chunk as BSON doubles. 10k chunks
   ≈ 60 MB. That is the real budget — plan chunk counts against it.
