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

  /** The one narrow POC scope. See docs/01-product.md#scope. */
  scope: {
    board: get('GRASP_BOARD', 'CBSE'),
    grade: get('GRASP_GRADE', '10'),
    subject: get('GRASP_SUBJECT', 'Mathematics'),
  },

  mongo: {
    uri: get('MONGODB_URI'),
    db: get('MONGODB_DB', 'grasp'),
  },

  gemini: {
    apiKey: get('GEMINI_API_KEY'),
    modelMid: get('GEMINI_MODEL_MID', 'gemini-2.0-flash'),
    modelFast: get('GEMINI_MODEL_FAST', 'gemini-2.0-flash-lite'),
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
