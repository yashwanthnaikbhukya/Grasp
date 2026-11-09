# 06 — Learner model

`packages/core/src/learner` — **Phase 2, partly built.** This file is the spec;
where today's code falls short of it, the gap is marked inline.

The learner model is derived state. Nothing writes it directly; events flow in,
handlers fold them into `mastery`, `episodes`, and `misconceptions`.

## Event flow

```
surface ──emit──▶ events (append-only, idempotent)
                     │
        ┌────────────┼────────────┬──────────────┐
        ▼            ▼            ▼              ▼
    mastery     episodes    misconceptions   analytics
    (fold)      (append)    (evidence++)     (PostHog)
```

*Today only the `mastery` fold exists*, and it runs inline in `/api/attempt`
right after the event append. The `episodes` and `misconceptions` derivations
and PostHog analytics are planned ([07-phases.md](07-phases.md)).

### Why append-only, restated

The mastery algorithm **will** change: naive counter → Elo per concept → proper
spaced repetition. Each change requires recomputing every learner's state from
history. With an append-only log that is a replay you can run in an afternoon.
Without it, every algorithm improvement is a data migration you can't validate.

`mastery.updatedFromEventSeq` is the replay watermark, so a rebuild is resumable
and a partial rebuild is detectable. *The live fold does not write it yet* —
planned with `learner:rebuild`.

### Event types

| Type | Emitted by | Payload |
| --- | --- | --- |
| `attempt.recorded` | Reps, Duel, Snap, Test | questionId, conceptIds, correct, answer, latencyMs, hintsUsed, surface |
| `card.skipped` | Reps | questionId, conceptIds, dwellMs |
| `doubt.asked` | Snap, Ask | conceptIds, sourceRef, surface |
| `hint.requested` | Reps, Snap | questionId, level |
| `explanation.viewed` | Reps | questionId, dwellMs |
| `session.started` / `.ended` | any | surface, durationMs, cardCount |
| `placement.completed` | Reps | estimates per concept |
| `duel.completed` | Duel | duelId, scores |
| `misconception.observed` | Slips | conceptId, statement |
| `mastery.rebuilt` | ops | fromSeq, toSeq, reason |

*Emitted today:* only `attempt.recorded` (by `/api/attempt`, surface `reps`) and
`doubt.asked` (by `/api/chat`). The rest are defined in `@grasp/schema`'s
`EventSchema` but nothing emits them yet; `explanation.viewed` and
`duel.completed` are not in the schema yet.

**Idempotency key convention:** `{type}:{userId}:{naturalKey}` — e.g.
`attempt.recorded:u123:q456:1735689600000`. A retried write is a no-op. Never
generate the key from a random value.

*Today `/api/attempt` keys on the server-assigned attempt `_id`*, so a client
retry of the same answer is not deduplicated server-side — the Reps client's
in-flight guard is what prevents double submits. A client-supplied attempt id is
planned. If the event write fails, the route logs it and still folds mastery.

## Mastery

### Start simple, deliberately

Phase 2 ships **Elo per concept + a two-parameter scheduler**, not Bayesian
Knowledge Tracing. Reasoning:

- Elo needs one number per (user, concept) and updates in a line of code.
- It's interpretable, so when a mastery number looks wrong you can see why.
- BKT's extra parameters (slip, guess, learn rate) need fitting, and fitting
  needs data you won't have until Phase 2 is *running*.

Ship Elo, collect attempts, then fit something better against the calibration
metric below. Do not start with the sophisticated thing.

```ts
// pure, unit-tested, no I/O, no clock of its own (learner/mastery.ts)
function updateMastery(prev: MasteryStateRecord, signal: AttemptSignal, now: Date): MasteryStateRecord
```

Ability update, standard Elo with item difficulty as the opponent. Item
difficulty is on the IRT scale (−3…+3); it maps to Elo as `1200 + 200·b`:

```
expected = 1 / (1 + 10^((itemElo - prev.elo) / 400))
elo'     = prev.elo + K * weight * (correct - expected)
```

`K` decays with attempt count (32 → 16 → 8) so early attempts move fast and
established estimates stay stable. `weight` is the evidence weight from latency
and hints (below).

`p` (probability they know it now) blends the Elo expected score with a
Laplace-smoothed hit rate — the hit rate gains weight as attempts accumulate
(`attempts / (attempts + 5)`), because twelve-for-twelve is strong evidence for
mastery even though it is a modest Elo gain — then multiplies by an exponential
forgetting curve, so mastery **falls** while a learner is away. A mastery model
without decay claims people never forget, which makes the whole due-queue
meaningless.

### Latency is signal, not noise

`latencyMs` distinguishes failure modes that a boolean cannot:

| Pattern | Reads as |
| --- | --- |
| Fast + correct | Fluent — safe to space out further |
| Slow + correct | Effortful — keep in rotation, small stability gain |
| Fast + wrong | Careless or guessing — feeds `careless-arithmetic` in Slips |
| Slow + wrong | Genuine conceptual gap — largest mastery penalty |

Feed it into both the mastery update and the Slips classifier. It's free and
almost nobody uses it.

### Scheduling

Two params per (user, concept): `stability` (how long the memory holds) and
`difficulty` (how hard it is for *this* learner). On each review:

- correct → `stability *= gain(difficulty, p)`; `nextDueAt = now + stability`
- wrong → `stability = max(1 day, stability * 0.4)`; due soon

Deliberately simpler than FSRS. Upgrade once real review histories exist; the
interface stays the same, which is the point of keeping this a pure function.

## The feed scheduler

`composeFeed` (served by `GET /api/feed`) composes each feed from four pools,
then diversifies. **Never a model call in this path.** *Today* the feed is
computed per request from `verified` questions in Mongo (`type: 'mcq'` only);
pre-generation into Redis is planned.

| Pool | Query | Share |
| --- | --- | --- |
| **Due review** | `mastery.nextDueAt <= now`, soonest first | 40% |
| **Weak concept** | lowest `p` where `state != unseen` | 30% |
| **Frontier** | `state = unseen` AND all `prereqIds` have `p >= 0.6` | 20% |
| **Interleave** | random `state = mastered`, spaced out | 10% |

Then:

1. **Diversify** — no two consecutive cards from the same concept.
2. **Difficulty band** — target ~80% success. Too easy is boring, too hard quits.
3. **Vary card type** — never three MCQs in a row; that's what makes it feel like
   a quiz instead of a feed. (`diversify` already prefers a different type; it
   has no effect until the feed serves more than `mcq`.)
4. **Cap** — max 3 cards per concept per session.
5. **Hold back what was just answered** — a card answered in the last 12 h
   (`RESERVE_AFTER_MS`) is not a candidate. Its worked solution is still in the
   learner's head, so a "correct" there would be free mastery; the *concept*
   still returns on its review schedule through its other cards. When every
   servable card is held back, the feed answers `empty: 'caught-up'` and Today
   says so instead of offering practice that isn't there.

Shares are config, not constants, and they're the first thing to tune against
retention.

### Frontier gating is why the graph exists

A learner is only shown a new concept when its prerequisites are satisfied. This
is the payoff for the `prereqIds` edges — model-proposed, cycle-checked, never
hand-authored ([ADR 0007](adr/0007-llm-authored-concept-graph.md)): it prevents the single worst
experience in adaptive learning, which is being drilled on something you cannot
possibly do yet because an upstream concept is missing.

### Cold start

No mastery ⇒ no useful feed. New learners get an **8-question adaptive
placement**, delivered *in the feed format* so it doesn't feel like a test. Binary
search over the concept graph's topological depth: start mid-depth, correct →
deeper, wrong → shallower. Eight questions gives a usable prior over ~200
concepts, because prerequisite structure propagates each answer.

*Planned — not built yet:* `placementNext` exists and is unit-tested, but no
placement flow is wired into the UI.

## Slips — root-cause classification

Runs on each wrong attempt, in the background after `/api/attempt` has
responded (never in front of the learner), using the `best` tier
(`slip.classify@2`). A signal-based prior from latency, position and
prerequisite mastery is reconciled with the model's label, so a rate-limited
call still yields a defensible label.

**Fixed taxonomy. Never free text.**

| Root cause | Signals |
| --- | --- |
| `careless-arithmetic` | Fast, method right, answer off; often an off-by-one or sign |
| `misread-question` | Answer correct for a *different* reading of the stem |
| `prerequisite-gap` | An upstream concept has low `p` |
| `misconception` | Repeated, systematic, matches a known wrong belief |
| `knowledge-gap` | Concept simply not learned yet |
| `time-pressure` | Accuracy collapses late in a timed session |

Free text would be unaggregatable, and aggregation is the entire product value —
*"you lose 40% of your marks to sign errors under time pressure"* only exists if
the labels are enumerable.

Classifier input: the question, their answer, the correct answer, `latencyMs`,
position in session, and mastery of the concept **and its prerequisites**. That
last input is what lets it distinguish `prerequisite-gap` from `knowledge-gap` —
without it the two are indistinguishable.

Low-confidence labels are stored but excluded from learner-facing digests.

## The calibration metric

**The one number that says whether any of this is real.**

Every time the model predicts `p` for a concept and the learner then attempts it,
you have a forecast and an outcome. Score it with Brier:

```
brier = mean((p_predicted - outcome_actual)^2)     lower is better
```

Compare against two baselines:

| Baseline | Beat it or the model is theatre |
| --- | --- |
| Constant (global mean accuracy) | **Phase 2 gate.** Must beat this. |
| Per-concept mean accuracy | Should beat it by Phase 3. |

Reported weekly by a scheduled job, tracked over time. Every mastery-algorithm
change is judged against it. *Today `brierScore()` exists and is unit-tested;
the weekly job is planned.*

This is the honest measure of personalization. Accuracy going up can just mean
easier questions; retention going up can just mean better UI. Calibration going
up means the learner model actually knows something about the learner.

## Rebuilding

> **Planned — not built yet** ([07-phases.md](07-phases.md) §2.2). There is no
> `learner:rebuild` script; `readEventsFrom()` in `core/events` is the replay
> source it will use.

```bash
pnpm learner:rebuild --user=<id>     # one learner
pnpm learner:rebuild --all           # everyone; run after an algorithm change
```

Replays `events` in `seq` order through the current pure functions, writing
`mastery`, `episodes`, and `misconceptions` fresh. Idempotent. Emits
`mastery.rebuilt`.

Guard rail: the rebuild writes to a shadow collection first and reports the diff
against live before swapping. An algorithm change that moves 90% of learners'
mastery by more than 0.3 is more likely a bug than an improvement.
