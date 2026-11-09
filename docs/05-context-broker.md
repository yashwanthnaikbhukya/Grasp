# 05 — Context broker

`packages/core/src/context` — **Phase 1, v1 built.** This file is the spec; where
today's code falls short of it, the gap is marked inline.

The broker is the only component that knows how to turn a query, a corpus, and a
learner into a prompt. It is the highest-value piece of engineering in Grasp,
because it is where "using AI correctly" actually lives.

```ts
const bundle = await assemble({
  userId, sessionId, query, profile, history, signal,
});
// → ContextBundle: ordered, budgeted, every span carries a citable id
```

## The six steps, in order

### 1 — Understand the query before retrieving anything

One cheap `fast` call (`query.understand`) doing three jobs at once:

| Output | Why it matters |
| --- | --- |
| `rewritten` | Resolves the query against history. *"explain that again"* → *"explain the sine addition formula again"*. **Without this, every follow-up turn retrieves garbage.** |
| `conceptIds[]` | Which nodes the query touches. Routes retrieval scoping, mastery lookup, and event tagging. |
| `intent` | `explain` \| `solve` \| `quiz` \| `meta` \| `chitchat`. Selects prompt, budget profile, and whether to retrieve at all. |

This is the step most RAG systems skip, and skipping it is why they work on the
first turn and break on the second. It costs one small call and roughly 200 ms.

**A question is never chitchat** (`context/intent.ts`). Chitchat skips retrieval
and gets a 1,000-token reply, and the model intermittently labelled off-list
questions ("what is photosynthesis") that way. A deterministic guard lifts any
question-shaped message back to `explain`, leaving greetings alone. Golden cases
qu-14..17 hold the model to it.

`intent: 'chitchat'` short-circuits: no retrieval, no learner card, minimal
budget. Not every message needs the machinery.

*Today:* the model is shown the learner's subjects' concepts (up to 400) as a
catalogue, and the `conceptIds` it returns pass through `knownConceptIds()` —
exact id, then alias or name, then slug; anything unmatched is dropped — before
they reach retrieval, the tutor or the append-only `doubt.asked` event (rule 13).
On the Ask path the call has a 1.5 s deadline; past it, or on failure, the raw
query is used (the tutor still receives the whole conversation).

### 2 — Allocate the budget explicitly

Not "stuff it until it fits." A declared budget per surface and intent, so
overflow is a decision you made rather than a truncation you discover.

**Ask / `explain`, 32k window:**

| Component | Tokens |
| --- | --- |
| System prompt (stable — cacheable prefix) | 1,000 |
| Learner card | 500 |
| Retrieved chunks | 8,000 |
| Chat history (verbatim tail + digest) | 6,000 |
| Attachment excerpts | 8,000 |
| Reserved for the response | 4,000 |
| Headroom | rest |

Components declare a priority. On overflow the broker sheds from lowest priority
first and **records what it shed on the bundle**, so a degraded answer is
diagnosable rather than mysterious.

`solve` shifts budget from history into attachments. `quiz` drops the learner
card to a single mastery line. Profiles live in `context/budget.ts`.

### 3 — Compact history, never resend it

- Keep the last *n* turns verbatim (n ≈ 6, tuned).
- Everything older is summarized into a **session digest** stored on
  `chatSessions.digest`, refreshed every *k* turns (k ≈ 8) by `session.digest`.
- The digest records `throughMessageId`, so refreshes are incremental.

This is the difference between a chat that stays coherent at turn forty and one
that either forgets everything or costs a fortune. It also keeps the cacheable
prefix stable, because the digest changes rarely.

*Today: verbatim tail only.* The digest is planned — `session.digest` has no
prompt yet. `/api/chat` passes the latest 40 messages; the broker keeps the last
6 turns of those.

### 4 — Retrieve hybrid, then rerank

```
query ──┬─▶ Atlas Search (BM25)          top 20 ─┐
        │                                         ├─▶ RRF fusion ─▶ top 20
        └─▶ Atlas Vector Search (kNN)     top 20 ─┘
                                                       │
                                    local cross-encoder rerank
                                                       │
                                                   top 5 ─▶ bundle
```

**Both legs are mandatory.** Vector-only retrieval fails on exactly the queries
students ask most: formula names, theorem names, specific numbers, section
references. BM25-only fails on paraphrase. Reciprocal rank fusion needs no score
normalization, which is why it's the right fusion for a POC.

*Today the rerank is not a cross-encoder:* it is `0.8 × normalised RRF score +
0.2 × lexical overlap with the query` (`retrieval/fuse.ts`). The local
cross-encoder is planned ([07-phases.md](07-phases.md) §1.2).

Scope filter, always applied:

```
ownerScope: 'global'  AND (curriculumIds ∩ profile.curriculumIds  OR  curriculumIds = [])
                      AND (subject ∈ profile.subjects  OR  subject = '')
  OR ownerScope: 'user'     AND ownerId = userId
  OR ownerScope: 'session'  AND ownerId = sessionId
```

*It runs inside both searches* — `$vectorSearch.filter` (MQL) and `$search`
`compound.filter` (`searchScopeFilter`, the same scope in Atlas Search
operators) — and again as a `$match` afterwards, so the security boundary holds
twice. Curriculum-neutral content is matched on the indexed `curriculumNeutral`
flag, because `$size` cannot run inside `$vectorSearch`. Verified by
`pnpm retrieval:isolation`: with 1,008 foreign-user copies of the corpus present,
every learner result is unchanged and none leak.

Three things about that filter:

- It reads from **`users.profile`**, never from process config
  ([ADR 0006](adr/0006-curriculum-agnostic-concepts.md)).
- `curriculumIds = []` means curriculum-neutral content, which stays eligible for
  everyone. Most good explanations are.
- The `user`/`session` legs are a **security** boundary, not a relevance one, and
  need a dedicated integration test — *planned, not written yet*
  ([07-phases.md](07-phases.md) §1.2).

`stageRange` deliberately does **not** appear here. It ranks and it caveats; it
never excludes. A learner reaching past their syllabus is the best signal they
can send, and a filter that silently swallows the answer is the worst possible
response to it.

Concept-targeted boost: chunks tagged with a `conceptId` from step 1 get a rank
bonus, applied to the fused list before the rerank.

Each retrieved chunk is prepended with its `headingPath` at assembly time —
*"Ch 8 › 8.2 Identities › …"* — which measurably improves grounding for a few
tokens.

**Then a relevance gate** (`context/relevance.ts`). Retrieval always returns its
top k: rank fusion says which passages are *least far*, never whether any is
*near*. With one maths chapter in the corpus, "what is photosynthesis" received
six trigonometry passages; the tutor cited one for a biology fact and told the
student "we are looking at your mathematics syllabus" (2026-11-09). Each chunk
now carries its cosine `similarity` to the query, and the gate keys on the
question first, because on this corpus that separates cleanly where per-passage
similarity does not:

| The question was… | Passages kept | Measured |
| --- | --- | --- |
| understood, tagged with ≥1 graph concept | similarity ≥ 0.38 | on-topic best passage 0.42–0.85 |
| understood, tagged with none (off the graph) | similarity ≥ 0.62 (near-paraphrase only) | off-topic best 0.41–0.56 |
| not understood (timed out) | ≥ 0.45 | |

`bundle.relevance` records the floor and how many passages were dropped. A turn
left with no material is flagged `no-material` and shown as *General
explanation*. Recall@5 on the retrieval set is unchanged (100%).

### 5 — Inject the learner, compactly

Roughly 300 tokens of **hand-formatted prose**, not a JSON dump. Models read
prose far better, and the token cost is lower.

**Only what this question touches.** Mastery lines come from the question's
concepts and the *gated* passages' concepts; misconceptions only for those
concepts. Unrelated passages used to pull their concepts' mastery in, and any
four unresolved misconceptions rode along whatever the topic — together they
steered a biology answer toward trigonometry.

The profile half comes from onboarding ([10-onboarding.md](10-onboarding.md)),
the mastery half from the learner plane. Stage is written with its **local label**
so the model reasons in the learner's own vocabulary, and notation conventions
come from their curriculum:

```
LEARNER
Class 10 (India), CBSE Mathematics. Goal: board exam, 14 Feb 2027 (181 days).
Explanations in English, Hindi where it reads more naturally; keep technical
terms in English. Notation: cosec/sec/cot, Commonwealth quadrilateral names,
lakh-crore digit grouping. Studies ~40 min/day, streak 12.

RELEVANT MASTERY
  sin-cos-identities   0.34  learning   last seen 2 days ago
  radian-measure       0.19  learning   PREREQUISITE GAP
  pythagorean-identity 0.81  review

ACTIVE MISCONCEPTIONS
  · treats degrees and radians interchangeably (4 observations, latest today)
  · applies sin(a+b) = sin a + sin b

RECENT
  Asked about the same identity 6 days ago; struggled with the substitution step.
```

**This block is the entire difference between Grasp's tutor and ChatGPT.** Only
concepts detected in step 1 appear — never the whole mastery table.

*Today the ACTIVE MISCONCEPTIONS and RECENT sections never render:* the card
supports them, but nothing writes `misconceptions` or `episodes` yet (planned —
[03-data-model.md](03-data-model.md#learner-plane)).

Rules:
- **Local labels, not internal ones.** `Class 10 (India)`, never `stage: 10`.
- **Notation is stated explicitly**, from the curriculum's `notation` profile. A
  tutor confidently writing `trapezoid` at a learner who was taught `trapezium`
  is worse than one that says nothing.
- **No PII, ever.** No name, no contact detail, no school. The card addresses the
  learner in the second person, so a prompt leak is not a PII leak.
- **One prompt, per-learner context.** Never branch prompt templates per country.
- Mastery is shown with its state word, not just a number; the model reasons
  better about `learning` than about `0.34`.
- Prerequisite gaps are flagged explicitly, because that is the single most
  actionable fact in the block.
- Misconceptions are stated as the learner's belief, never as a correction. The
  model decides how to address it.
- The section is placed **after** the stable system prompt so it never
  invalidates a cacheable prefix.

### 6 — Stamp ids, require citations, then verify

Every chunk enters the bundle with a short citation id (`c1`, `c2`, …) mapped to
its `docChunks._id`. The prompt requires claims from retrieved content to cite.

After generation:
- Every cited id must exist in the bundle. Unknown id ⇒ flag `fabricated-citation`.
- A response making factual claims with zero citations ⇒ flag `ungrounded`.

Both flags land on the message (`messages.flags`, alongside `budget-shed`) and in
the SSE `cite` event; putting them on the trace is planned. **The rate of these two flags is
your hallucination metric**, it costs nothing, and it is the only reason you'll
know whether retrieval is actually working.

## The output

```ts
type ContextBundle = {
  bundleId: string;
  surface: Surface;
  intent: Intent;
  rewrittenQuery: string;
  conceptIds: string[];

  system: string;                    // stable → cache prefix
  learnerCard: string;               // step 5
  history: { verbatim: Message[]; digest?: string };
  retrieved: { citeId: string; chunkId: string; headingPath: string[]; text: string }[];
  attachments: { citeId: string; attachmentId: string; excerpt: string }[];

  budget: { allocated: Record<string, number>; used: Record<string, number>;
            shed: string[] };        // what got dropped, and why
  citeMap: Record<string, string>;   // citeId → chunkId, for verification
};
```

This is the target shape. The built `ContextBundle` (`context/assemble.ts`) has
no `surface`, `system` or `attachments` yet — the system prompt lives in the
`tutor.reply` template — and adds `needsClarification`, `digest?`, `timings`,
and `retrievalLegs` (`atlas` \| `fallback` \| `skipped` per leg).

`budget.shed` being non-empty is not an error — it's the signal that a budget
profile needs tuning.

## Attachment handling

> **Interim path built (2026-11-09)** — no R2 or Inngest yet. Each file is read
> once at upload into a transcript (`attachment.read@1`); a turn carries the
> message with each transcript under an `[Attached …]` line (`composeTurn`,
> 12,000 characters across the turn), and the file itself to providers that can
> open it. Understanding and retrieval get the message plus the start of each
> transcript (`queryForRetrieval`), so "solve this" with a photo retrieves the
> right chapter. Earlier turns resend 800 characters of each transcript, never
> the bytes. The pipeline below is still the target.

Uploads run through the same pipeline regardless of scope:

```
presigned R2 upload (browser → R2; server never sees bytes)
  → Inngest job: detect type → extract → chunk → embed → index → mark ready
```

| Type | Extraction |
| --- | --- |
| Image | Vision model structured description **+** OCR. Both indexed, so a diagram becomes searchable text. |
| PDF | Text extraction + page images for figures. Phase 3 upgrades to layout-aware. |
| DOCX / TXT / MD | Direct. |

**Two scopes, and the second one is the edge over ChatGPT:**

| Scope | Behaviour |
| --- | --- |
| `session` | This chat only. TTL'd. What ChatGPT does. |
| `library` | Persists into the learner's corpus — retrievable from the tutor next month, minable for cards, mappable into a mindmap. |

Same pipeline, one extra field, materially better product: the learner's notes
stop being an attachment and become part of the learner graph.

**While extracting:** chat stays open. Show a real status (*"reading your file —
page 12 of 40"*), not a spinner. If they ask something before extraction
finishes, answer from what's ready and say so.

## Testing

The broker is mostly pure functions around two I/O calls, so it tests well:

| What | How |
| --- | --- |
| Budget allocator | Unit (`budget.test.ts`). Property test: never exceeds total; sheds in priority order. |
| History compaction | Unit with fixture sessions of 2 / 10 / 60 turns. *Planned.* |
| RRF fusion | Unit with known rank lists (`fuse.test.ts`). |
| Learner card | Unit (`learner-card.test.ts`). |
| Scope filter | Integration — a user must never retrieve another user's chunks. **Security test, not a quality test.** *Planned.* |
| End to end | Golden set of 20 real student questions; assert retrieval hits the right chunk in top-5 (recall@5). `pnpm retrieval:eval` — 20/20 today. |

`recall@5` on that golden set is the number to watch when tuning retrieval. Move
it before touching prompts — retrieval quality dominates prompt quality here.
