# 01 — Product

## The thesis

Using an LLM is now commodity. Using it with *the right context* is not.

Grasp's bet is that the durable advantage in AI education is not the model, the
content library, or the UI — it is a **learner model**: a live, per-student
representation of what they know, what they've forgotten, what they
misunderstand, and why. Build that once, and every surface gets personalization
for free. Skip it, and you have a chat window with a textbook attached.

So the architecture is not "features that use AI." It is **one substrate, many
surfaces** — where a surface is thin and the substrate is thick.

## What that means concretely

A learner photographs a trigonometry problem they got wrong.

1. **Snap** extracts it, walks them through it, and tags it to the concept node
   `sin-cos-identities`.
2. That produces an `attempt` event with `correct: false`.
3. The event updates `mastery` for that concept — and, because the concept graph
   has prerequisite edges, flags that `radian-measure` is a likely upstream gap.
4. **Slips** classifies the root cause as `prerequisite-gap`, not "trigonometry."
5. Tomorrow, **Reps** puts three `radian-measure` cards at the front of the feed.
6. When they next open **Ask**, the tutor's context includes *"weak on radian
   measure, active misconception: treats degrees and radians interchangeably"* —
   so it explains at the right level without being asked.
7. **Map** shows the whole chain lit up in mastery heat.

No feature above knows about any other feature. They all know about the
substrate. That is the entire design.

## The six surfaces

| Surface | Job | Primary read | Primary write |
| --- | --- | --- | --- |
| **Ask** | Socratic tutor grounded in the learner's syllabus + history | Context broker | Episodes, concept tags |
| **Reps** | Bite-size swipeable practice, scheduled | `cards/next` | Attempts → mastery |
| **Snap** | Photo → guided walkthrough → tomorrow's cards | Broker + vision | Attempts, concept tags |
| **Duel** | Shared code, frozen question set, compared scores | `questions` | Attempts |
| **Map** | Concept DAG with mastery heat; mindmaps from any source | `mastery` + graph | Mindmaps |
| **Slips** | Every mistake clustered by root cause | `attempts` | Root-cause labels |

Three later surfaces, deliberately deferred: **Plan** (study-plan agent),
**Voice** (explain-back, graded against a rubric), **Cockpit** (teacher/parent
rollups — the commercial wedge).

### Why Reps is the centrepiece

Reps looks like the least sophisticated surface. It is the most important one,
because it is the **highest-signal data collector in the product**. Every swipe
is a labelled observation of ability, cheap to produce and unambiguous to
interpret. Ask produces rich but hard-to-grade signal; Reps produces
`(concept, correct, latency)` tuples by the hundred. The learner model is only
as good as its evidence stream, and Reps is the evidence stream.

### Why Slips is the differentiator

Every competitor can show you a topic-wise accuracy breakdown. Almost none tell
you *why* you're getting things wrong. Clustering mistakes by root cause —
careless arithmetic, misread the question, missing prerequisite, genuine
misconception, time pressure — is the single most differentiated thing in the
product, and it costs almost nothing to build because the data already exists by
Phase 3.

## Scope

**One board, one grade, one subject.** Configured in `.env.local` as
`GRASP_BOARD` / `GRASP_GRADE` / `GRASP_SUBJECT`. Target 150–300 concept nodes.

This is not a limitation of the prototype. It is the mechanism.

Retrieval quality is a function of corpus coherence, not corpus size. A tutor
grounded in 300 well-tagged concepts and one textbook will outperform one
grounded in 40,000 loosely-tagged documents, and it will do so on a laptop with
no budget. Widening scope before the loop works is the most common way projects
like this die — the retrieval gets mushy, the concept tags get noisy, mastery
stops predicting anything, and there's no way to tell which layer broke.

**Recommended default if undecided:** one competitive-prep subject. The syllabus
is well-defined, the concept graph has clean prerequisite structure, and the
users tolerate a rough UI. K–12 board is the better commercial path because it
unlocks the teacher cockpit, but it is a harder first scope.

## Glossary

Terms used precisely throughout the codebase and docs.

| Term | Means |
| --- | --- |
| **Concept** | A node in the curriculum graph. The atomic unit of knowledge. Has prerequisite edges. |
| **Concept tag** | A reference from any content atom (chunk, question, doubt, message) to a concept. The interop layer. |
| **Surface** | A learner-facing feature. Thin by design. |
| **Spine** | The substrate: content plane + learner plane + event plane + broker. |
| **Learner graph** | The union of a learner's mastery, episodes, misconceptions, and profile. |
| **Mastery** | Per-concept probability that the learner currently knows the concept. Derived, never authored. |
| **Context bundle** | The budgeted, ordered, citable payload the broker hands a model. |
| **Card** | One unit in the Reps feed. Wraps a question plus presentation type. |
| **Slip** | One mistake, with a root-cause label. |
| **Root cause** | Why a mistake happened. Fixed taxonomy, never free text. |
| **Due** | A concept whose `nextDueAt` has passed. Drives the review pool. |
| **Frontier** | A concept not yet learned whose prerequisites are all satisfied. |
| **Gate** | A phase's measurable exit criterion. See [07-phases.md](07-phases.md). |

## What Grasp is not

- **Not a content library.** Content is fuel for the learner model, not the product.
- **Not a chatbot with RAG.** Ask is one surface of six, and the least
  differentiated one on its own.
- **Not adaptive-in-name-only.** If mastery doesn't predict next-attempt
  correctness better than a constant baseline, the personalization is theatre.
  That number is the honest measure, and it's the Phase 2 gate.
