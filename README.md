# Grasp

An LLM-native learning platform built on one idea: **one learner model, many
surfaces.**

Most AI education products bolt a chat window onto a content library. Grasp
inverts that. A single substrate — the concept graph, the learner's knowledge
state, and an append-only event log — sits underneath every feature. A doubt
asked in the tutor becomes a concept tag, which becomes a practice card
tomorrow, which updates mastery, which changes how the tutor explains the next
thing.

## Surfaces

| Surface | What it is |
| --- | --- |
| **Ask** | Socratic tutor grounded in the learner's own syllabus and history |
| **Reps** | Swipeable bite-size practice, scheduled by mastery and forgetting curve |
| **Snap** | Photo of a homework problem → guided walkthrough → tomorrow's cards |
| **Duel** | Share a code, two people run the same frozen question set, scores compared |
| **Map** | The concept graph rendered with mastery heat; mindmaps from any source |
| **Slips** | Every mistake clustered by *root cause*, not topic |

## Getting started

```bash
pnpm install
cp .env.example .env.local     # then fill it in — see docs/08-setup.md
pnpm setup:check               # tells you exactly what's still missing
pnpm db:indexes
pnpm dev
```

**You need accounts and keys before anything runs.** Every one of them has a
real free tier. [docs/08-setup.md](docs/08-setup.md) walks through each in
order, and tells you which are needed *now* versus later.

## Documentation

Start at [docs/README.md](docs/README.md). The two you'll read most:

- [docs/02-architecture.md](docs/02-architecture.md) — the three planes and how a request flows
- [docs/07-phases.md](docs/07-phases.md) — what to build, in order, with exit gates

## Stack

TypeScript end to end. Next.js on Vercel, MongoDB Atlas (documents + full-text +
vectors in one place), Upstash Redis, Cloudflare R2, Inngest for durable jobs.
Models via a provider-agnostic gateway with failover across Gemini, Groq, and
OpenRouter free tiers; embeddings and reranking run locally through Ollama. A
Python service joins in Phase 3 for document parsing, symbolic math, and
psychometrics.

## Scope

**Deliberately narrow.** One subject, one grade, 150–300 concept nodes. Narrow
scope is not a limitation of the prototype — it is the mechanism that makes
retrieval good enough to be useful. See
[docs/01-product.md](docs/01-product.md#scope).
