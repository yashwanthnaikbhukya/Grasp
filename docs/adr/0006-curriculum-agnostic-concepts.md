# ADR 0006 — Universal concept graph, curriculum overlays

**Status:** accepted · 2026-08-17 · **supersedes the scope model in
[ADR 0001](0001-mongodb-single-store.md)'s assumptions and the original
`01-product.md` scope section**

## Context

The first cut of Grasp put the content scope in environment variables —
`GRASP_BOARD=CBSE`, `GRASP_GRADE=10`, `GRASP_SUBJECT=Mathematics` — and stamped
`board` / `grade` / `subject` onto every chunk and question. Retrieval filtered on
those fields.

That models a **single-curriculum product**. Grasp is for students globally. The
env-var scope has three fatal problems:

1. **"Class 10" is not a global concept.** Class 10 (India), Grade 10 (US),
   Year 11 (UK), MYP 5 (IB), and Seconde (France) are roughly the same age band
   under five incompatible names — and Year 11 is *not* Grade 11. Any field named
   `grade` holding a local label is a bug waiting for its second country.
2. **It duplicates the expensive artifact.** The prerequisite DAG is the costly
   thing to author. `pythagorean-identity` requires `pythagoras-theorem` in every
   curriculum on earth. Stamping a board onto the concept means re-authoring the
   same graph per board.
3. **It makes the learner invisible.** If scope is global config, two learners in
   the same deployment cannot have different curricula, stages, or languages —
   which is the entire point of a learner model.

## Decision

**Concepts are universal. Curricula are overlays. Scope lives on the learner.**

```
concepts                          universal, curriculum-free
  _id: 'pythagorean-identity'
  prereqIds: [...]                ← the expensive artifact, authored once
  canonicalName, description, objectives
  stageRange: { min, max }        typical stage band, advisory not gating

curricula                         one row per real-world curriculum
  _id: 'in-cbse-secondary-math'
  region, authority, subject, stageRange, language, notation

curriculumMappings                the join, and where local truth lives
  curriculumId, conceptId
  localName?                      'cosec' where canonical is 'csc'
  localCode?                      'Ch 8.3'
  sequenceIndex                   this curriculum's teaching order
  inScope                         some curricula exclude a concept outright
  examWeight?

users.profile                     discovered at onboarding
  region, stage, curriculumIds[], subjects[], language, goal
```

Content atoms (`docChunks`, `questions`) carry `curriculumIds[]` plus an advisory
`stageRange` — **not** a single board and grade. A chunk can serve several
curricula, which is normal: a good explanation of the Pythagorean identity is
correct in all of them.

Retrieval filters on the **learner's** profile, never on process config.

## The normalized stage ladder

One integer, `stage`, anchored on *nominal years of schooling completed*, which
happens to align with the US grade number. Local labels are presentation:

| `stage` | Typical age | India | US | UK | IB |
| --- | --- | --- | --- | --- | --- |
| 8 | 13–14 | Class 8 | Grade 8 | Year 9 | MYP 3 |
| 10 | 15–16 | Class 10 | Grade 10 | Year 11 | MYP 5 |
| 12 | 17–18 | Class 12 | Grade 12 | Year 13 | DP 2 |
| 13+ | 18+ | UG | College | Undergrad | — |

`age` is captured separately and is the more reliable anchor — an adult
self-learner and a 14-year-old both exist outside any grade ladder. Age also
drives the consent obligations in [10-onboarding.md](../10-onboarding.md).

**Never name a field `grade` and put a local label in it.** `stage` is the
number; `stageLabel(stage, region)` is the string.

## Consequences

Good:

- **The second curriculum costs a fraction of the first.** Author the DAG once;
  a new curriculum is a `curricula` row plus mappings, no new concepts.
- Cross-curriculum content reuse is the default rather than an afterthought.
- Two learners on different continents, curricula, and languages work in the same
  deployment — the actual requirement.
- Notation and terminology differences get a home (`curricula.notation`) instead
  of leaking into prompts as hardcoded assumptions. This matters more than it
  sounds: `trapezoid` means different shapes in US and UK English, and a tutor
  that gets it wrong is worse than one that says nothing.
- The learner card gets substantially richer, which is where the product edge is.

Bad, accepted:

- **Three collections and a join where there was one flat filter.** Real
  complexity, paid for by the reuse above.
- **Someone must author the curriculum mappings.** Mitigated: mappings are cheap
  (a model drafts them, a human checks `inScope` and `sequenceIndex`) and only the
  curricula you actually serve need them.
  *Amended by [ADR 0007](0007-llm-authored-concept-graph.md): nothing about the
  curriculum is hand-authored — mappings are model-drafted like the graph, and
  human review is an audit, not a step on the critical path. As of 2026-11-08,
  mappings are seeded but nothing reads them yet.*
- **Canonical naming needs a decision per concept.** We use canonical
  international-English names with `aliases[]` carrying every local variant, and
  the alias list feeds both retrieval and concept tagging. Aliases now do real
  work, so they cannot be an afterthought.
- **Onboarding becomes load-bearing.** With no global config, an incomplete
  profile means degraded retrieval. Handled by sensible defaults and progressive
  capture ([10-onboarding.md](../10-onboarding.md)), never by a blocking wizard.

## What does *not* change: the first corpus stays narrow

This ADR is about the data model, not the rollout. Retrieval quality is a
function of **corpus coherence**, not corpus breadth, and the loop has to be
proven against one coherent corpus before it is worth widening.

So: the schema is global from day one, and the first ingested corpus is still one
subject, one stage band, one curriculum. That is now recorded as
`GRASP_SEED_CURRICULUM` — an **ingestion** setting naming which corpus to load
first, with no effect on what a learner can be. Widening is adding rows, not
changing types.

Conflating "narrow first corpus" with "narrow product" was the original mistake.
They are independent.

## What would change our mind

- Discovering that prerequisite structure genuinely differs by curriculum for a
  material fraction of concepts. Then `prereqIds` moves onto
  `curriculumMappings` as an override layer, keeping the universal graph as the
  default. Cheap to add later; not worth paying for up front.
- A single-market pivot. Then this is over-built — but it collapses back to a
  degenerate case (one `curricula` row) rather than needing a migration.
