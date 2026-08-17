import { env } from '../../env';
import { ProviderTransientError } from '../../errors';
import type {
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderAdapter,
} from '../types';
import { asNumber, asString, pick, postJson } from './http';

/**
 * Local models via Ollama.
 *
 * Two jobs:
 *   1. Embeddings — free, unmetered, and no learner text leaves the machine.
 *      This is what makes the whole project genuinely free.
 *   2. The offline failover floor for `fast` and `mid`. When every hosted free
 *      tier is exhausted, the app degrades instead of dying.
 *
 * Deliberately absent from the `best` chain: a small local model cannot do the
 * judgments that write into the learner graph, and a wrong root-cause label
 * persists. Better to fail than to write it.
 */
export const ollamaAdapter: ProviderAdapter = {
  name: 'ollama',

  available() {
    // Presence of a base URL only — reachability is discovered on call and
    // surfaces as a transient error, which is the correct failover behaviour.
    return Boolean(env.ollama.baseUrl && env.ollama.chatModel);
  },

  modelFor() {
    return env.ollama.chatModel;
  },

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = env.ollama.chatModel;

    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const json = await postJson(
      `${env.ollama.baseUrl}/api/chat`,
      {
        model,
        messages,
        stream: false,
        // Ollama takes a JSON Schema directly in `format`.
        ...(req.jsonSchema ? { format: req.jsonSchema } : {}),
        options: { num_predict: req.maxOutputTokens },
      },
      { timeoutMs: req.timeoutMs, signal: req.signal, provider: 'ollama' },
    );

    return {
      text: asString(pick(json, ['message', 'content'])),
      model,
      usage: {
        inputTokens: asNumber(pick(json, ['prompt_eval_count'])),
        outputTokens: asNumber(pick(json, ['eval_count'])),
        cachedInputTokens: 0,
      },
    };
  },
};

/**
 * Embeddings. Dimension must match `OLLAMA_EMBED_DIM` and the Atlas vector index
 * — a mismatch is caught here rather than producing silently unsearchable chunks.
 */
export async function ollamaEmbed(req: EmbedRequest): Promise<EmbedResponse> {
  if (req.texts.length === 0) {
    return { vectors: [], model: env.ollama.embedModel, dim: env.ollama.embedDim };
  }

  const json = await postJson(
    `${env.ollama.baseUrl}/api/embed`,
    { model: env.ollama.embedModel, input: req.texts },
    { timeoutMs: 60_000, provider: 'ollama-embed' },
  );

  const raw = pick(json, ['embeddings']);
  if (!Array.isArray(raw)) {
    throw new ProviderTransientError('ollama returned no embeddings', {
      provider: 'ollama-embed',
      hint: `is the model pulled?  ollama pull ${env.ollama.embedModel}`,
    });
  }

  const vectors = raw.map((v) => (Array.isArray(v) ? (v as number[]) : []));
  const first = vectors[0];
  const dim = first ? first.length : 0;

  if (dim !== env.ollama.embedDim) {
    throw new ProviderTransientError(
      `embedding dimension mismatch: model returned ${dim}, OLLAMA_EMBED_DIM is ${env.ollama.embedDim}`,
      {
        provider: 'ollama-embed',
        hint: 'fix OLLAMA_EMBED_DIM and recreate the Atlas vector index — see docs/08-setup.md#5a',
      },
    );
  }

  return { vectors, model: env.ollama.embedModel, dim };
}

/** Used by `pnpm setup:check` to report Ollama state precisely. */
export async function ollamaStatus(): Promise<{
  reachable: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const res = await fetch(`${env.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return { reachable: false, models: [], error: `HTTP ${res.status}` };

    const json: unknown = await res.json();
    const models = pick(json, ['models']);
    const names = Array.isArray(models)
      ? models.map((m) => asString(pick(m, ['name']))).filter(Boolean)
      : [];
    return { reachable: true, models: names };
  } catch (e) {
    return { reachable: false, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}
