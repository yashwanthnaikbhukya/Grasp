import type { ModelTier } from '@grasp/schema';
import { env } from '../../env';
import { ProviderRequestError } from '../../errors';
import type { ChatRequest, ChatResponse, ProviderAdapter } from '../types';
import { asNumber, asString, pick, postJson } from './http';

/**
 * Google AI Studio / Gemini.
 *
 * Free tier, generous limits, native structured output via `responseSchema`.
 *
 * Note on free-tier data policy: prompts may be used to improve their models.
 * Never route real learner PII here. See docs/08-setup.md#3.
 */

/** Gemini's schema dialect rejects several JSON Schema keywords. Strip them. */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const drop = new Set([
    '$schema',
    '$ref',
    '$defs',
    'definitions',
    'additionalProperties',
    'default',
    'const',
    'examples',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'patternProperties',
  ]);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (drop.has(k)) continue;
      // Gemini has no union support; collapse to the first branch.
      if (k === 'anyOf' || k === 'oneOf') {
        const first = Array.isArray(v) ? v[0] : undefined;
        if (first !== undefined) Object.assign(out, walk(first) as Record<string, unknown>);
        continue;
      }
      out[k] = walk(v);
    }
    return out;
  };

  return walk(schema) as Record<string, unknown>;
}

export const geminiAdapter: ProviderAdapter = {
  name: 'gemini',

  available() {
    return Boolean(env.gemini.apiKey);
  },

  modelFor(tier: ModelTier) {
    // In the dev profile `best` collapses onto the mid model — small models
    // everywhere, quota goes further. See env.modelProfile.
    if (env.modelProfile === 'dev') {
      return tier === 'fast' ? env.gemini.modelFast : env.gemini.modelMid;
    }
    if (tier === 'fast') return env.gemini.modelFast;
    return tier === 'mid' ? env.gemini.modelMid : env.gemini.modelBest;
  },

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = this.modelFor(req.tier);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const body: Record<string, unknown> = {
      contents: req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens,
        ...(req.jsonSchema
          ? {
              responseMimeType: 'application/json',
              responseSchema: toGeminiSchema(req.jsonSchema),
            }
          : {}),
      },
    };

    if (req.system) {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }

    const json = await postJson(url, body, {
      headers: { 'x-goog-api-key': env.gemini.apiKey },
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      provider: 'gemini',
    });

    const finishReason = asString(pick(json, ['candidates', 0, 'finishReason']));
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      // Not transient — retrying elsewhere is unlikely to help and would mask it.
      throw new ProviderRequestError('gemini refused the request', {
        provider: 'gemini',
        finishReason,
      });
    }

    const parts = pick(json, ['candidates', 0, 'content', 'parts']);
    const text = Array.isArray(parts)
      ? parts.map((p) => asString(pick(p, ['text']))).join('')
      : '';

    return {
      text,
      model,
      usage: {
        inputTokens: asNumber(pick(json, ['usageMetadata', 'promptTokenCount'])),
        outputTokens: asNumber(pick(json, ['usageMetadata', 'candidatesTokenCount'])),
        cachedInputTokens: asNumber(pick(json, ['usageMetadata', 'cachedContentTokenCount'])),
      },
    };
  },
};
