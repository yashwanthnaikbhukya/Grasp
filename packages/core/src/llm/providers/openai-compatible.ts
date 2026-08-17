import type { ModelTier, ProviderName } from '@grasp/schema';
import { env } from '../../env';
import type { ChatRequest, ChatResponse, ProviderAdapter } from '../types';
import { asNumber, asString, pick, postJson } from './http';

/**
 * Groq and OpenRouter both speak the OpenAI chat-completions dialect, so one
 * factory covers both. Adding any other OpenAI-compatible provider is one call
 * to this function.
 */
function makeAdapter(cfg: {
  name: ProviderName;
  baseUrl: string;
  apiKey: () => string;
  models: (tier: ModelTier) => string;
  extraHeaders?: () => Record<string, string>;
}): ProviderAdapter {
  return {
    name: cfg.name,

    available(tier: ModelTier) {
      return Boolean(cfg.apiKey()) && Boolean(cfg.models(tier));
    },

    modelFor(tier: ModelTier) {
      return cfg.models(tier);
    },

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const model = cfg.models(req.tier);

      const messages: { role: string; content: string }[] = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      for (const m of req.messages) messages.push({ role: m.role, content: m.content });

      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: req.maxOutputTokens,
      };

      // Reasoning tokens are drawn from the same budget as the response, so on a
      // schema-constrained call they can consume it entirely and leave truncated
      // JSON — which comes back as a 400 `json_validate_failed` with an empty
      // body, not as a length error. Unknown fields are ignored by providers
      // that do not support this.
      if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;

      if (req.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'result', strict: false, schema: req.jsonSchema },
        };
      }

      const json = await postJson(`${cfg.baseUrl}/chat/completions`, body, {
        headers: {
          authorization: `Bearer ${cfg.apiKey()}`,
          ...(cfg.extraHeaders?.() ?? {}),
        },
        timeoutMs: req.timeoutMs,
        signal: req.signal,
        provider: cfg.name,
      });

      return {
        text: asString(pick(json, ['choices', 0, 'message', 'content'])),
        model: asString(pick(json, ['model']), model),
        usage: {
          inputTokens: asNumber(pick(json, ['usage', 'prompt_tokens'])),
          outputTokens: asNumber(pick(json, ['usage', 'completion_tokens'])),
          cachedInputTokens: asNumber(
            pick(json, ['usage', 'prompt_tokens_details', 'cached_tokens']),
          ),
        },
      };
    },
  };
}

/** Very fast inference on open models — what makes `fast`-tier tasks feel instant. */
export const groqAdapter = makeAdapter({
  name: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: () => env.groq.apiKey,
  models: (tier) => (tier === 'fast' ? env.groq.modelFast : env.groq.modelMid),
});

/** Third failover leg. Point OPENROUTER_MODEL_MID at a `:free` model id. */
export const openrouterAdapter = makeAdapter({
  name: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: () => env.openrouter.apiKey,
  models: () => env.openrouter.modelMid,
  extraHeaders: () => ({
    'HTTP-Referer': env.appUrl,
    'X-Title': 'Grasp',
  }),
});
