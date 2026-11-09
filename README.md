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

Then open **http://localhost:3000** → **Get started**. How to use each part, what
works today and what doesn't: [docs/12-using-grasp.md](docs/12-using-grasp.md).

## Documentation

Start at [docs/README.md](docs/README.md). The two you'll read most:

- [docs/02-architecture.md](docs/02-architecture.md) — the three planes and how a request flows
- [docs/07-phases.md](docs/07-phases.md) — what to build, in order, with exit gates

## Stack

TypeScript end to end. Next.js, MongoDB Atlas (documents + full-text + vectors
in one place). Models via a provider-agnostic gateway with failover across
Gemini, Groq, and OpenRouter free tiers; embeddings run locally through Ollama.
Planned, not wired yet: Vercel deploy, Upstash Redis, Cloudflare R2, and
Inngest for durable jobs ([docs/07-phases.md](docs/07-phases.md)). A Python
service joins in Phase 3 for document parsing, symbolic math, and
psychometrics.

## Scope

**Global product, narrow first corpus.** Scope lives on each learner's profile;
only the first *ingested* corpus is one subject and stage band
(`GRASP_SEED_CURRICULUM`). See
[ADR 0006](docs/adr/0006-curriculum-agnostic-concepts.md) and
[docs/01-product.md](docs/01-product.md#audience-and-scope).
