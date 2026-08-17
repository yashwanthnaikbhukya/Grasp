# ADR 0005 — Duel is a synchronized replay, not a game server

**Status:** accepted · 2026-08-17

## Context

Duel: one learner creates a match, shares a six-character code, the other joins,
both answer the same questions under time pressure, scores are compared.

The instinctive implementation is a realtime multiplayer game: authoritative
server, WebSocket connections, server-driven question advancement, tick loop,
reconnection and state-resync logic. That is a substantial and fragile piece of
engineering — and it runs badly on Vercel serverless, which cannot hold sockets.

It also fails in the environment the product actually runs in: two students on
Indian mobile networks, where a dropped connection mid-match is normal.

## Decision

**Freeze the question set at duel creation. Both clients run the round locally
against that frozen list. The server is the scorekeeper, not the game loop.**

- `duels.questionIds[]` is written once, at creation, identical order for both
  players.
- Each client executes the round locally with its own timer.
- Answers are submitted per question; the server validates timing and scores.
- Pub/sub carries **presence and progress index only** — never answers, never
  question advancement.

## Consequences

Good:

- **A dropped connection does not break the match.** The client keeps playing
  against its local list; scores reconcile on reconnect. On the target networks
  this is the difference between a feature that works and one that doesn't.
- **Realtime becomes cosmetic.** Pusher failing degrades to 1-second polling for
  the opponent's progress bar. Nobody notices, and correctness is unaffected.
- **Anti-cheat gets simpler, not harder.** Never send answer keys before
  submission; stamp client and server time on each answer; reject impossible
  latencies. There is no authoritative-state desync to exploit because there is no
  authoritative state to desync.
- Works on serverless with no socket server, no sticky sessions, no scaling story.
- **The ghost duel falls out for free** — see below.

Bad, accepted:

- Both players see identical questions in identical order, so the format cannot
  support adaptive-per-player difficulty within a match. Acceptable; a fair duel
  arguably *requires* identical items.
- A client with devtools open can read its own frozen question list. It cannot
  read answers (not sent), and the exploit is visible in the timing check. For a
  friendly-competition feature this is the right amount of anti-cheat.
- Progress indication can lag by up to a second on the polling fallback.

## The ghost duel — build it in the same phase

Synchronous matchmaking between two *specific friends* fails constantly:
different timezones, different study schedules, one person opens the link three
hours later.

Because the question set is frozen and each run is independent, a run recorded
earlier is replayable. If the opponent doesn't join within five minutes, they can
play the same frozen set later against the host's recorded run.

Same schema (`duels.runs[]` — a ghost run is just a run), same scoring, no new
infrastructure. It converts a feature that only works when both people are
simultaneously free into one that always works, and it should ship in Phase 4
rather than being deferred as an enhancement.

## What would change our mind

- Wanting genuinely live head-to-head mechanics — seeing the opponent's answer as
  they lock it in, steal-the-point, buzzer races. Those need an authoritative
  server. They are also a different product, and not one this ADR is blocking.
- Duel becoming a primary retention driver at scale, justifying dedicated realtime
  infrastructure. Revisit then, with data.
