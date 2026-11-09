# Grasp documentation

Read in order the first time. After that, jump by task.

| # | Doc | What it answers |
| --- | --- | --- |
| 01 | [Product](01-product.md) | What Grasp is, the six surfaces, the scope decision, glossary |
| 02 | [Architecture](02-architecture.md) | Three planes, internal contracts, how a request actually flows |
| 03 | [Data model](03-data-model.md) | Every collection, every index, the two irreversible decisions |
| 04 | [LLM gateway](04-llm-gateway.md) | Task registry, provider failover, structured output, cost control |
| 05 | [Context broker](05-context-broker.md) | The six assembly steps, token budgets, citation enforcement |
| 06 | [Learner model](06-learner-model.md) | Events, mastery, the scheduler, the calibration metric |
| 07 | [Phases](07-phases.md) | The build order, with a measurable exit gate per phase |
| 08 | [Setup](08-setup.md) | Accounts, keys, connection strings — step by step |
| 09 | [Conventions](09-conventions.md) | Code style, testing, evals, commits |
| 10 | [Onboarding](10-onboarding.md) | The journey, the global stage ladder, consent and moderation |
| 11 | [Experience](11-experience.md) | UX principles, navigation, per-surface requirements, a11y and performance budgets |
| 12 | [Using Grasp](12-using-grasp.md) | Start it, use it as a learner, what works today, troubleshooting |

## Decision records

Settled decisions with their reasoning. Change one only by writing a superseding
ADR — not by editing history.

- [0001 — MongoDB as the single store](adr/0001-mongodb-single-store.md)
- [0002 — TypeScript first, Python at Phase 3](adr/0002-typescript-first.md)
- [0003 — Event-sourced learner state](adr/0003-event-sourced-learner-state.md)
- [0004 — Messages are a tree](adr/0004-messages-are-a-tree.md)
- [0005 — Duel is a synchronized replay](adr/0005-duel-is-a-replay.md)
- [0006 — Universal concept graph, curriculum overlays](adr/0006-curriculum-agnostic-concepts.md)
- [0007 — The concept graph is LLM-authored and self-growing](adr/0007-llm-authored-concept-graph.md)

## Keeping these honest

These docs are the project's memory, and they're loaded as context by AI
sessions. Two rules:

1. **Structural change and doc update land in the same commit.** A doc that
   describes last month's architecture will be trusted and will cause bugs.
2. **Write what's true, not what's aspirational.** If a phase isn't built,
   [07-phases.md](07-phases.md) says so. Don't document intent as if it were
   implementation.
