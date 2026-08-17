/**
 * Environment access.
 *
 * Deliberately lenient: Phase 0 must run with only a few values set, and
 * `pnpm setup:check` is what reports gaps — not a crash at import time. Use
 * `requireEnv` at the point of use so the error names the feature that needed it.
 */

function get(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: get('NODE_ENV', 'development'),
  appUrl: get('APP_URL', 'http://localhost:3000'),

  /**
   * Which corpus to ingest **first**. An ingestion setting only — it has no
   * effect on what a learner can be. Scope is a property of the learner
   * (`users.profile`), never of the deployment.
   *
   * Retrieval quality is a function of corpus coherence, so the first corpus is
   * deliberately narrow; the schema is global from day one. Widening is adding
   * rows, not changing types.
   * See docs/adr/0006-curriculum-agnostic-concepts.md.
   */
  seed: {
    curriculumId: get('GRASP_SEED_CURRICULUM', 'self-study'),
    subject: get('GRASP_SEED_SUBJECT', 'mathematics'),
  },

  mongo: {
    uri: get('MONGODB_URI'),
    db: get('MONGODB_DB', 'grasp'),
  },

  /**
   * `dev` collapses the `best` tier onto the mid model, so every call uses a
   * small model and the free-tier quota goes several times further. Correct while
   * there are no real learners and nothing is trusted yet.
   *
   * **Flip to `prod` before you trust a `slip.classify` label** — that one writes
   * into the learner graph and persists, so it wants the real `best` model.
   * See docs/04-llm-gateway.md#tiers.
   */
  modelProfile: (get('GRASP_MODEL_PROFILE', 'dev') === 'prod' ? 'prod' : 'dev') as 'dev' | 'prod',

  gemini: {
    apiKey: get('GEMINI_API_KEY'),
    modelFast: get('GEMINI_MODEL_FAST', 'gemini-2.0-flash-lite'),
    modelMid: get('GEMINI_MODEL_MID', 'gemini-2.0-flash'),
    modelBest: get('GEMINI_MODEL_BEST', 'gemini-2.5-flash'),
  },

  groq: {
    apiKey: get('GROQ_API_KEY'),
    modelFast: get('GROQ_MODEL_FAST', 'llama-3.1-8b-instant'),
    modelMid: get('GROQ_MODEL_MID', 'llama-3.3-70b-versatile'),
  },

  openrouter: {
    apiKey: get('OPENROUTER_API_KEY'),
    modelMid: get('OPENROUTER_MODEL_MID'),
  },

  ollama: {
    baseUrl: get('OLLAMA_BASE_URL', 'http://localhost:11434'),
    embedModel: get('OLLAMA_EMBED_MODEL', 'nomic-embed-text'),
    /**
     * Load-bearing: written into the Atlas vector index definition. Changing it
     * means re-embedding the corpus and recreating the index.
     */
    embedDim: num('OLLAMA_EMBED_DIM', 768),
    chatModel: get('OLLAMA_CHAT_MODEL', 'llama3.2'),
  },

  langfuse: {
    publicKey: get('LANGFUSE_PUBLIC_KEY'),
    secretKey: get('LANGFUSE_SECRET_KEY'),
    baseUrl: get('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com'),
  },

  redis: {
    url: get('UPSTASH_REDIS_REST_URL'),
    token: get('UPSTASH_REDIS_REST_TOKEN'),
  },

  /** Per-user daily output-token ceiling. Protects free-tier quota as much as cost. */
  dailyTokenBudget: num('GRASP_DAILY_TOKEN_BUDGET', 200_000),
} as const;

export function requireEnv(value: string, name: string, why: string): string {
  if (!value) {
    throw new Error(`Missing ${name} — needed for ${why}. See docs/08-setup.md`);
  }
  return value;
}

/** Which hosted model providers are usable given the keys actually present. */
export function configuredProviders(): string[] {
  const out: string[] = [];
  if (env.gemini.apiKey) out.push('gemini');
  if (env.groq.apiKey) out.push('groq');
  if (env.openrouter.apiKey && env.openrouter.modelMid) out.push('openrouter');
  return out;
}
