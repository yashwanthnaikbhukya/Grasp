# ADR 0002 — TypeScript first, Python at Phase 3

**Status:** accepted · 2026-08-17

## Context

Four workloads in Grasp are meaningfully better in Python:

1. Layout-aware PDF and OCR parsing (`pymupdf`, `unstructured`)
2. Symbolic math equivalence (`sympy`) — `1/2`, `0.5`, `2⁻¹` are one answer
3. Item response theory and forgetting-curve fitting (`numpy`, `scipy`)
4. Local cross-encoder reranking at volume

Everything else — the app, the gateway, the broker, the schedulers — is better in
TypeScript, because it shares types with the frontend and runs on the same free
hosting.

The options were: start with both services; start all-TypeScript and never add
Python; or start all-TypeScript and add Python when the workload arrives.

## Decision

**All TypeScript through Phase 2. Add `services/ai` (Python + FastAPI) at
Phase 3.**

The trigger is Phase 3, because that is when Snap needs real document parsing and
`sympy`. Before then, none of the four workloads exists: Phase 1 ingestion is
heading-aware text chunking (fine in TS), and Phase 2 mastery is Elo (arithmetic).

## Consequences

Good:

- One language, one build, one deploy, one dependency tree for the first ten
  weeks — the weeks where velocity matters most and the loop isn't proven yet.
- Types are shared end to end via `@grasp/schema`; no cross-language contract to
  maintain until there's something worth maintaining it for.
- The Phase 3 boundary is natural: `services/ai` is stateless, owns no
  collections, and reads and writes through the existing contracts. It can be
  added without touching the surfaces.

Bad, accepted:

- Phase 1 ingestion is layout-naive. PDFs with multi-column layouts or heavy math
  will chunk poorly, and retrieval quality will show it. Accepted: Phase 1 ingests
  one textbook chapter chosen for being clean, and the retrieval eval will
  quantify the damage before Phase 3 fixes it.
- Phase 2 answer checking is restricted to MCQ and exact-match numerics. No
  free-form algebraic answers until `sympy` arrives. This shapes which card types
  ship first, which is a real product constraint and is recorded in
  [07-phases.md](../07-phases.md).
- Reranking in Phase 1 runs through Ollama rather than a proper cross-encoder
  library — slower and slightly worse.

## What would change our mind

- Retrieval quality being blocked by chunking before Phase 3, badly enough that
  the Phase 1 gate can't pass. Then pull `services/ai` forward and ship only the
  parser.
- Deciding the learner model needs IRT rather than Elo earlier than Phase 3 —
  unlikely, since fitting IRT needs attempt data that only exists once Phase 2 is
  running.

## Note

The temptation will be to add Python "properly, up front, since we'll need it
anyway." Resist it. Two services on day one is two deploys, two CI paths, and a
contract to keep in sync, in exchange for capability that has no consumer for ten
weeks.
