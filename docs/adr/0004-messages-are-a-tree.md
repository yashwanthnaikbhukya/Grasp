# ADR 0004 — Messages are a tree

**Status:** accepted · 2026-08-17

## Context

Ask is a chat surface, and learners arrive with expectations set by ChatGPT. One
of those expectations is **edit-and-regenerate**: change an earlier message, get a
different continuation, and be able to switch back to the original branch.

That requires message history to be a tree with a rendered active path. A flat
array cannot express it.

## Decision

**`messages` carries `parentMessageId` from the first commit.** `chatSessions`
carries `activeLeafId`. Rendering walks from the active leaf to the root and
reverses.

Regenerate creates a sibling. Editing a user message creates a sibling of that
message and a fresh continuation beneath it. Nothing is deleted.

## Consequences

Good:

- Edit-and-branch, regenerate, and branch switching all work with no schema change.
- **Nothing is destroyed.** A learner who regenerates and preferred the first
  answer can get it back — and for a study tool, where the first explanation may
  have been the one that clicked, that matters more than in a general assistant.
- Abandoned branches are training and eval data: the pairs
  `(rejected answer, accepted answer)` on the same prompt are exactly what a
  preference eval wants, and they are free.
- The context broker's history compaction operates on the active path, so
  branching costs nothing at prompt-assembly time.

Bad, accepted:

- Every read is a tree walk rather than a range scan. Mitigated by indexes on
  `(sessionId, createdAt)` and `parentMessageId`, and by the fact that sessions
  are tens of messages, not thousands.
- The UI must render a branch indicator ("2 / 3") wherever siblings exist. Small
  but real work that a flat list wouldn't need.
- Storage grows with abandoned branches. Immaterial at this scale, and see the
  eval-data upside.

## Why now rather than later

This is the cheapest possible moment. The field is nullable and the walk is
fifteen lines.

Retrofitting it means: a migration over every message ever written, backfilling
`parentMessageId` by inferring order, backfilling `activeLeafId` per session,
rewriting every read path, and doing it while live sessions are being appended to.
That is a week of risky work to buy something that costs an hour today.

The same reasoning applies to `events` being append-only
([ADR 0003](0003-event-sourced-learner-state.md)). Both are structural choices
that are nearly free before there is data and expensive after.

## What would change our mind

Nothing. Even if edit-and-branch were cut from the product, the field would stay —
it's one nullable column and it keeps the option open.
