# 08 — Setup

Everything here has a real free tier. Nothing needs a credit card except
Cloudflare R2 (which asks for one but does not charge inside the free tier), and
that isn't needed until Phase 1.

**Do steps 1–7 now.** Step 8 onward is Phase 1+ and `pnpm setup:check` will nag
you when the time comes.

> Provider dashboards get redesigned. If a menu path below doesn't match what you
> see, the *thing you're looking for* is still named the same — search for it.

---

## 0 — What you need before anything

```bash
node -v            # need ≥ 20; repo is developed on 22
corepack enable pnpm
pnpm -v
```

If `node` isn't found but you have nvm:

```bash
nvm use 22
# or persist it for this repo — .nvmrc is committed
```

Then:

```bash
cd grasp
pnpm install
cp .env.example .env.local
```

Keep `.env.local` open — you'll be pasting into it for the next twenty minutes.

---

## 1 — Ollama (local embeddings) · required

This is what makes the project genuinely free: embeddings and reranking run on
your Mac, unmetered, and no learner text ever leaves the machine.

```bash
brew install ollama
brew services start ollama        # or: ollama serve

ollama pull nomic-embed-text      # 768-dim embeddings, ~275 MB
ollama pull llama3.2              # small local chat model = offline failover floor
```

Verify:

```bash
curl -s http://localhost:11434/api/tags | head -c 300
```

`.env.local` — the defaults are already correct if Ollama is on the standard port:

```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_EMBED_DIM=768
```

> **`OLLAMA_EMBED_DIM` is load-bearing.** It's written into the Atlas vector index
> definition. Changing the embedding model later means re-embedding the entire
> corpus *and* recreating that index. Decide now.

---

## 2 — MongoDB Atlas · required

**Cost: free forever on M0. No card.**

1. Sign up at [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register).
2. **Create a cluster** → choose **M0 / Free**. Pick the region closest to you
   (`ap-south-1` Mumbai if you're in India — it measurably affects latency).
   Name it `grasp`.
3. **Database user** (Security → Database Access → Add New Database User):
   - Authentication: Password
   - Username: `grasp_app`
   - Password: click **Autogenerate** and **copy it now**
   - Role: `Read and write to any database`
4. **Network access** (Security → Network Access → Add IP Address):
   - For local dev: **Allow access from anywhere** (`0.0.0.0/0`).
   - This is acceptable *only* because the credential is strong and the data is
     synthetic. Before this ever holds real learner data, restrict it to your
     deploy egress IPs.
5. **Connection string** (Cluster → Connect → Drivers → Node.js):

```
mongodb+srv://grasp_app:<password>@grasp.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

Paste into `.env.local`, replacing `<password>` with the real one. **URL-encode
any special characters in the password** — `@`, `/`, `:`, `?`, `#` will break the
URI silently. If autogenerate gave you something with symbols, regenerate until
it's alphanumeric; it's not worth debugging.

```
MONGODB_URI=mongodb+srv://grasp_app:REALPASSWORD@grasp.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=grasp
```

Test the connection:

```bash
pnpm setup:check
```

---

## 3 — Gemini API key · required (or Groq)

**Cost: free tier, no card.**

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. **Create API key** → pick or create a Google Cloud project.
3. Copy it.

```
GEMINI_API_KEY=AIza...
```

> **Free-tier data policy.** On the free tier, Google may use your prompts to
> improve their models. Check the current terms on that page. While that's true:
> **never send real student names, phone numbers, or school details through this
> key.** Use synthetic learners during the POC. This is the single most important
> line in this document.

Model names in `.env.example` are current-as-of-writing defaults. If a call 404s
with "model not found", check
[ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
and update `GEMINI_MODEL_MID` / `GEMINI_MODEL_FAST`.

---

## 4 — Groq API key · strongly recommended

**Cost: free tier, no card.** Very fast inference on open models — this is what
makes `fast`-tier tasks (query rewriting on every message, bulk card generation)
feel instant.

1. [console.groq.com/keys](https://console.groq.com/keys) → sign in → **Create API Key**.

```
GROQ_API_KEY=gsk_...
```

Having both Gemini and Groq is the point: when one rate-limits, the gateway uses
the other. With only one key you *will* hit a wall mid-session.

### 4b — OpenRouter · optional third leg

[openrouter.ai/keys](https://openrouter.ai/keys). Set
`OPENROUTER_MODEL_MID` to a model whose id ends in `:free` (browse
[openrouter.ai/models?max_price=0](https://openrouter.ai/models?max_price=0) — the
free lineup rotates).

---

## 5 — Create the two Atlas Search indexes · required for Phase 1

Regular indexes are created by `pnpm db:indexes`. **Atlas Search and Vector
Search are separate resources** that the driver cannot create — you make them in
the Atlas UI once.

First create the collections and regular indexes:

```bash
pnpm db:indexes
```

That command also **prints the exact JSON** for the two search indexes. Then:

Atlas → your cluster → **Atlas Search** tab → **Create Search Index**.

### 5a — Vector index

- Type: **Atlas Vector Search** → **JSON Editor**
- Database/collection: `grasp` / `docChunks`
- Index name: **`grasp_chunks_vec`** (exact — the code references it)

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "ownerScope" },
    { "type": "filter", "path": "ownerId" },
    { "type": "filter", "path": "conceptIds" },
    { "type": "filter", "path": "board" },
    { "type": "filter", "path": "grade" },
    { "type": "filter", "path": "subject" }
  ]
}
```

`numDimensions` **must** equal `OLLAMA_EMBED_DIM`. The filter paths are what let
the scope filter run inside the vector search instead of after it — without them
you'd retrieve then discard, which wrecks recall.

### 5b — Full-text index

- Type: **Atlas Search** → **JSON Editor**
- Database/collection: `grasp` / `docChunks`
- Index name: **`grasp_chunks_text`**

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "text":        { "type": "string", "analyzer": "lucene.standard" },
      "headingPath": { "type": "string", "analyzer": "lucene.standard" },
      "ownerScope":  { "type": "token" },
      "ownerId":     { "type": "token" },
      "conceptIds":  { "type": "token" },
      "board":       { "type": "token" },
      "grade":       { "type": "token" },
      "subject":     { "type": "token" }
    }
  }
}
```

Both take a few minutes to build. Status shows **Active** when ready.

> **M0 has a small cap on search indexes** (a handful). You've now used two. The
> third is `grasp_messages_text` for cross-session chat search in Phase 1 — that
> may be your last. If you hit the cap, cross-session search is the one to drop
> or move to a regular text index.

---

## 6 — Langfuse · recommended now

**Cost: free tier.** Without tracing you're guessing about your own system —
including whether a prompt change helped.

1. [cloud.langfuse.com](https://cloud.langfuse.com) → sign up → **New Project** (`grasp`).
2. Settings → **API Keys** → **Create**.

```
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

Leave blank and the gateway logs structured lines to stdout instead. It never
fails a request because tracing failed.

---

## 7 — Verify Phase 0 · required

```bash
pnpm setup:check
```

Expected: Mongo ✓, Ollama ✓ with the embed model present, at least one hosted
provider ✓.

Then the real gate:

```bash
pnpm dev
# open http://localhost:3000/debug/gateway
```

That page runs a structured-output task, then deliberately breaks the primary
provider to prove failover works, and shows `failoverDepth` for both. **When both
rows are green, Phase 0's gate is passed.**

---

## 8 — Upstash Redis · Phase 1

Cache, rate limiting, and the pre-generated card queue. HTTP-based, so it works
from serverless with no connection pooling.

1. [console.upstash.com](https://console.upstash.com) → **Create Database** →
   Redis → region near your Vercel region → Free tier.
2. Database page → **REST API** → copy both values.

```
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=Axxx...
```

## 9 — Cloudflare R2 · Phase 1

Attachment storage. 10 GB and **zero egress fees**, which is why it beats S3 here.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2** → enable (asks for
   a card; free tier does not charge).
2. **Create bucket**: `grasp-uploads`.
3. **Manage R2 API Tokens** → **Create API Token** → *Object Read & Write*,
   scoped to that bucket. Copy the Access Key ID and Secret **now** — the secret
   is shown once.
4. Account ID is in the R2 sidebar.

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=grasp-uploads
```

Do **not** make the bucket public. Uploads use presigned PUTs; reads go through
presigned GETs from your server.

## 10 — Auth secret · Phase 1

```bash
openssl rand -base64 32
```

```
AUTH_SECRET=<paste>
```

## 11 — Inngest · Phase 1

Durable step functions for ingestion, card pre-generation, and the study-plan
agent. Retries and replay for free — this is why it's here instead of cron.

[app.inngest.com](https://app.inngest.com) → new app → **Manage → Keys**.

```
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=signkey-...
```

Local dev needs no keys — `npx inngest-cli@latest dev` runs a local devserver.

## 12 — Resend · Phase 1 (magic links)

[resend.com/api-keys](https://resend.com/api-keys). Free tier sends from a shared
domain, which is fine for dev.

## 13 — PostHog · Phase 2

You need retention curves on the Reps feed from the day it ships.
[posthog.com](https://posthog.com) → project → **Project API Key**.

```
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

## 14 — Pusher · Phase 4

Duel presence only, never game logic ([ADR 0005](adr/0005-duel-is-a-replay.md)).
[dashboard.pusher.com](https://dashboard.pusher.com) → Channels → new app →
**App Keys**.

---

## Cost ceiling and what breaks first

Everything above is $0. In rough order of what you'll exhaust:

| # | Limit | Symptom | Response |
| --- | --- | --- | --- |
| 1 | Hosted model daily/minute quotas | `failoverDepth` climbing in traces | Add the third provider; move tasks down a tier; turn on response caching |
| 2 | Atlas M0 512 MB | Write errors on ingest | Chunks only in Mongo (files in R2), TTL session chunks, prune `llmCalls` |
| 3 | Atlas M0 search-index cap | Can't create the third index | Drop cross-session search, or upgrade to M10 |
| 4 | Upstash daily commands | Rate limiter fails open | Batch card pre-generation; longer cache TTLs |
| 5 | Inngest step count | Jobs queue | Fewer, coarser steps per job |

**The embedding budget is the real constraint on M0.** 768 floats as BSON doubles
≈ 6 KB per chunk. 10,000 chunks ≈ 60 MB. That's comfortable for one subject and
one grade — and it's another reason the narrow scope is a mechanism rather than a
compromise.

---

## Security checklist before any real learner touches this

Nothing below matters during the POC. All of it matters the moment a real student
signs up — write it down now so it isn't rediscovered later.

- ☐ Atlas network access restricted from `0.0.0.0/0` to deploy egress IPs
- ☐ Move off any model tier whose terms permit training on submitted data
- ☐ Learner PII (name, phone, school) never enters a prompt — refer to learners
      by opaque id inside the learner card
- ☐ Rate limits per user on every model-backed route
- ☐ R2 bucket confirmed private; presigned URLs short-lived
- ☐ Retrieval scope filter has a passing integration test proving cross-user
      isolation
- ☐ Parental-consent flow if any user is under 18 (which, for K–12, is all of them)
