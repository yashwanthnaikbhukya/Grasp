# ADR 0003 — Event-sourced learner state

**Status:** accepted · 2026-08-17

## Context

Mastery is the core of the product. It is also the thing most likely to be wrong
at first: the mastery algorithm will change from a naive counter, to Elo per
concept, to a properly fitted spaced-repetition model — and possibly to something
learned from data after that.

Each of those changes retroactively invalidates every stored mastery value. The
question is whether the system can recompute them.

The straightforward implementation is: an attempt arrives, update the `mastery`
row in place. Cheap, obvious, and it makes every future algorithm change a
destructive migration you cannot validate.

## Decision

**All learner-affecting facts are appended to an immutable `events` collection.
`mastery`, `episodes`, and `misconceptions` are derived projections, rebuildable
by replaying the log through pure functions.**

- `events` is append-only. Never updated, never deleted.
- Every event carries an `idempotencyKey` with a unique index, so retries are
  free and at-least-once delivery is safe.
- Every event carries a monotonic `seq`.
- `mastery.updatedFromEventSeq` is the replay watermark, so rebuilds are resumable
  and partial rebuilds are detectable.
- Corrections are **new events that supersede**, never edits.

## Consequences

Good:

- An algorithm change is an afternoon's replay, not a migration. This is the whole
  point, and it converts "we should improve mastery" from a scary project into a
  routine one.
- Algorithm changes are **validatable**: rebuild into a shadow collection, diff
  against live, inspect the learners who moved most. A change that shifts 90% of
  learners by more than 0.3 is more likely a bug than an improvement — and
  without a replay you would ship it blind.
- The event log is also the analytics substrate and the audit trail. "Why does the
  system think I'm weak at this?" is answerable.
- Debugging becomes tractable: a wrong mastery value has a reproducible cause.

Bad, accepted:

- **Storage.** Events accumulate forever on a 512 MB tier. Mitigated: event
  payloads are small (an attempt is ~200 bytes) and archival to R2 with a cursor
  is available if needed. 100k attempts ≈ 20 MB — not the binding constraint;
  embeddings are.
- **Write amplification.** Every attempt is two writes (event + projection)
  instead of one. Irrelevant at this scale.
- **Discipline cost.** Someone will eventually "just fix" a mastery row directly.
  Mitigated by a hard rule in [CLAUDE.md](../../CLAUDE.md) and by making
  `pnpm learner:rebuild` easy enough that the shortcut has no appeal.
- The mastery fold must stay a **pure function** of `(prevState, event, item)`.
  The moment it reads the database mid-fold, replay stops being deterministic. This
  is the constraint that's easiest to violate accidentally.

## What would change our mind

Nothing plausible. This is the decision most likely to look prescient in month
four, and the cheapest one to make now — the field is `seq` plus a unique index.

The only version of this that could go wrong is over-application: event-sourcing
*everything*. Sessions, messages, and questions are ordinary mutable documents.
Only learner-derived state is projected.
