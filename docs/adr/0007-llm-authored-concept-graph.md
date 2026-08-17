# ADR 0007 — The concept graph is LLM-authored and self-growing

**Status:** accepted · 2026-08-17 · **supersedes the hand-authoring guidance in
[07-phases.md](../07-phases.md) § 0.2**

## Context

The original plan had a human authoring 150–300 concept nodes with prerequisite
edges from a syllabus, using a model only as a drafting assistant. Two days of
work before Phase 1 could start.

That was wrong twice over. It front-loads manual work onto the critical path, and
it does not scale — every new subject, and eventually every new curriculum,
repeats it. A model knows secondary mathematics well enough to generate this, and
generating structured taxonomies is squarely what it's good at.

But the opposite extreme — asking the model to name concepts fresh on every
request, storing nothing — breaks the product. Worth being precise about why,
because the failure is silent.

## The failure that forces persistence

Grasp's thesis is that evidence about a learner **accumulates**. That requires a
stable key to accumulate it under.

```
Monday    learner asks about the Pythagorean identity
          → Groq tags it `pythagorean-identity`
          → attempts row, mastery row created

Thursday  same question, Groq is rate-limited, Gemini serves it
          → Gemini tags it `trig-pythagorean-identity`
          → a second mastery row
```

The system now believes the learner has two concepts each seen once, rather than
one seen twice. Consequences, all silent:

- Spaced repetition schedules both, so they see it twice as often as intended.
- `p` never rises, because evidence is split across two rows.
- Frontier gating can't tell whether the prerequisite is satisfied.
- Slips can't locate the upstream gap — the chain is severed.
- The calibration metric degrades, and nothing points at why.

With failover across two providers ([04-llm-gateway.md](../04-llm-gateway.md))
and small models in the dev profile, tag disagreement is not a risk to mitigate —
it is the expected behaviour. Two different models will not converge on a slug.

## Decision

**The model authors the graph. Mongo remembers what it decided. Nothing is
written by hand.**

```
concept mentioned in a chunk, doubt, or query
        │
        ▼
1. resolve against the existing graph      ← in-memory, no model call
     alias exact match, then embedding similarity
        │
        ├── match ──▶ return the existing stable id        (the common path)
        │
        └── no match
                ▼
2. `concept.propose`  model generates the full node:
     canonical name, aliases, description, objectives,
     stageRange, and prerequisite names
                ▼
3. resolve each prerequisite name the same way (bounded depth)
                ▼
4. validate: no cycles, no dangling edges
                ▼
5. insert with a stable slug id + its embedding
```

Step 1 is the hot path and involves **no model call** — the graph is a few
hundred nodes, so it lives in memory and dedupe is cosine similarity in JS.

Consequences of that shape:

- **`data/concepts.seed.json` becomes optional.** It's a bootstrap convenience for
  a corpus you already know, not a prerequisite. An empty graph is a valid
  starting state; the first ingestion run populates it.
- **The graph converges rather than sprawling.** Every proposal is deduped against
  everything already known, so the second model to encounter a concept lands on
  the first model's id.
- **Growth is a background job.** Ingestion and Snap propose new concepts through
  Inngest. A learner request never waits on graph growth — it resolves against
  what exists and queues anything new.

## Consequences

Good:

- No manual authoring, ever. New subject = point ingestion at a corpus.
- Prerequisite edges are model-generated but **validated** — a cycle is rejected
  at write time, which is more than hand-authoring guaranteed.
- Scales across curricula for free, because concepts stay universal
  ([ADR 0006](0006-curriculum-agnostic-concepts.md)).
- Provenance is recorded (`origin`, `proposedFrom`, `generatedBy`), so a bad node
  is traceable to the call that created it.

Bad, accepted:

- **The dedupe threshold is a tuning problem with two bad failure modes.** Too
  low merges distinct concepts (`mean` and `median` collapse); too high splits one
  concept across near-duplicate ids, which is the exact problem this ADR exists to
  prevent. Mitigated by alias exact-match as a high-precision fast path, a
  quarantine band where near-misses are flagged (`needsReview`) rather than
  auto-decided, and `pnpm concepts:calibrate`, which measures the actual cosine
  separation between known-duplicate and known-distinct pairs so the thresholds
  come from data. A `concepts:audit` review UI is still to build.

  **Observed on the first real run:** a sine/cosine passage proposed
  `definition-of-sine-and-cosine` at 0.855 against the existing `trig-ratios` —
  inside the review band. Flagged, not merged, not silently duplicated. The net
  works; the judgement still needs a golden set.
- **Model-generated prerequisite edges will be wrong sometimes.** Accepted: they
  were going to be wrong when hand-authored too, and now they're at least
  consistent and cycle-free. The audit surface shows the highest-degree nodes,
  where an error does the most damage.
- **Graph quality is now an eval target, not a craft artifact.** It needs a golden
  set: given a passage, does resolution land on the right existing concept?
  Without that this is unimprovable.
- Embeddings for concepts are held in memory. Fine at a few hundred nodes;
  revisit past ~20k.
- **Every write path must embed.** A concept row with an empty `embedding` is
  invisible to the cosine scan, so the resolver duplicates it. This bit on the
  first run: `seed-concepts.ts` persisted nine nodes without embeddings and the
  next growth pass created `-2` variants of four of them. Loud in
  `concepts:calibrate` now, but it is a standing footgun for any new write path.
- **Free-tier rate limits are the binding constraint on growth, not model quality.**
  A three-passage run hit `groq 429` and `gemini 503`. The gateway retries the same
  provider with backoff (honouring `retry-after`) before failing over, batch drivers
  throttle between passages, and `resolveOrCreate` returns `deferred` rather than
  throwing so one rate-limited passage cannot fail a whole ingestion batch.

## Why dedupe is in memory rather than an Atlas vector index

Atlas M0 caps search indexes at a handful, and `docChunks` already uses two
(vector + full text). A third on `concepts` would take the last slot, blocking
cross-session message search later.

The graph is small enough that it doesn't need one: a few hundred 768-float
vectors is a few megabytes, loaded once and cached. Exact cosine in JS is more
accurate than approximate nearest-neighbour anyway, and there is no index to keep
in sync.

## What would change our mind

- Dedupe accuracy plateauing below what mastery needs. Then the resolution step
  gets a model-based tiebreaker for the quarantine band ("are these the same
  concept?"), which is a slower but far more accurate judgment than cosine.
- Growing past ~20k concepts. Then dedupe moves to a real vector index and the
  M0 index budget stops being the constraint.
- Discovering that prerequisite structure genuinely differs by curriculum, which
  would move `prereqIds` onto `curriculumMappings` as an override layer — already
  noted as the escape hatch in [ADR 0006](0006-curriculum-agnostic-concepts.md).
