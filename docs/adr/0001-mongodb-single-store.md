# ADR 0001 — MongoDB as the single store

**Status:** accepted · 2026-08-17

## Context

Grasp needs four storage capabilities: documents (sessions, messages, questions,
mastery), full-text search (BM25 leg of hybrid retrieval, cross-session chat
search), vector search (semantic leg), and an append-only event log.

The conventional POC answer is Postgres + pgvector, with a separate search engine
if BM25 is wanted. The alternative considered was a dedicated vector database
(Qdrant, Pinecone) alongside a primary store.

## Decision

**MongoDB Atlas holds all four.** Atlas provides Atlas Search (Lucene-backed,
BM25) and Atlas Vector Search over the same collections as the document store.

## Consequences

Good:

- **One system, no sync job.** A chunk, its embedding, its full-text index entry,
  and its concept tags are one document. There is no window in which the vector
  store and the primary store disagree — a class of bug that eats real time.
- Hybrid retrieval reads from one place, so RRF fusion is a local operation.
- Scope filters (`ownerScope`, `ownerId`, board/grade/subject) can be declared as
  filter paths *inside* the vector index, so filtering happens during search
  rather than after it. Post-filtering wrecks recall at small `k`.
- The document model genuinely fits chat sessions, message trees, and
  heterogeneous question types (a discriminated union per `type` is awkward
  relational and natural in documents).
- Free M0 tier covers the whole POC.

Bad, accepted:

- **Schema flexibility is a footgun.** Mitigated by Zod validation at every
  boundary plus `$jsonSchema` validators on the collections. This is a discipline
  cost, and discipline erodes.
- **Analytics will be harder later.** Cohort mastery rollups, funnel analysis, and
  item-response calibration are more work in the aggregation pipeline than in SQL.
  Accepted because those are Phase 5 concerns and PostHog covers the product
  funnel.
- **M0 is 512 MB and caps search indexes at a handful.** Forces real storage
  discipline (files in R2, TTL on session chunks) — which is arguably good — but
  it will be the first ceiling hit.
- Atlas-specific. Self-hosted MongoDB has no Atlas Search, so this is a
  vendor-coupled decision, not merely a MongoDB one.

## What would change our mind

- Needing SQL-grade analytical queries over attempts before Phase 5.
- Hitting the M0 index cap in a way that blocks a required surface *and* the
  upgrade cost being unjustified.
- Retrieval quality plateauing for reasons traceable to Atlas Search's ranking
  rather than to chunking or concept tagging. (Check chunking first — it's almost
  always chunking.)

## Rejected alternatives

**Postgres + pgvector.** Better analytics story, mature ecosystem. Rejected
because it needs a separate BM25 solution for the hybrid retrieval that
[05-context-broker.md](../05-context-broker.md) treats as mandatory, and
`tsvector` is a meaningfully worse BM25 than Lucene.

**Dedicated vector DB + Postgres.** Best retrieval ceiling. Rejected for a
solo-built POC: two stores means a sync path, and a sync path means a category of
bug that costs more than the retrieval gain is worth at this scale.
