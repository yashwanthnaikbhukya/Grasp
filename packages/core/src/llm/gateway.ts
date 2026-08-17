import { getPrompt } from '@grasp/prompts';
import type { ModelTier, ProviderName } from '@grasp/schema';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

import {
  GatewayExhaustedError,
  ProviderRequestError,
  ProviderTransientError,
  SchemaValidationError,
} from '../errors';
import { geminiAdapter } from './providers/gemini';
import { groqAdapter, openrouterAdapter } from './providers/openai-compatible';
import { ollamaAdapter, ollamaEmbed } from './providers/ollama';
import { taskConfig, type TaskId } from './registry';
import { newTraceId, trace } from './trace';
import type { ChatMessage, ChatResponse, EmbedRequest, EmbedResponse, ProviderAdapter } from './types';

/**
 * The single entry point for every model call in Grasp.
 *
 * Feature code never imports a provider, never names a model, never writes a
 * prompt inline. See docs/04-llm-gateway.md for why the indirection is
 * load-bearing rather than ceremony.
 */

const ALL: Record<ProviderName, ProviderAdapter> = {
  gemini: geminiAdapter,
  groq: groqAdapter,
  openrouter: openrouterAdapter,
  ollama: ollamaAdapter,
};

/**
 * Provider order per tier.
 *
 * `fast` leads with Groq for latency (it runs on every message). `mid` leads
 * with Gemini for quality. `best` has **no local leg** — a small local model
 * cannot do judgments that get written into the learner graph, and a wrong label
 * persists for weeks. Failing is the better outcome.
 */
const CHAINS: Record<ModelTier, ProviderName[]> = {
  fast: ['groq', 'gemini', 'openrouter', 'ollama'],
  mid: ['gemini', 'groq', 'openrouter', 'ollama'],
  best: ['gemini', 'openrouter', 'groq'],
};

export function chainFor(tier: ModelTier, exclude: ProviderName[] = []): ProviderAdapter[] {
  return CHAINS[tier]
    .filter((n) => !exclude.includes(n))
    .map((n) => ALL[n])
    .filter((a) => a.available(tier));
}

export interface GenerateArgs {
  task: TaskId;
  input: Record<string, unknown>;
  /** For the cost guard and per-learner trace attribution. */
  userId?: string;
  /** Prior turns, for tasks that need them. */
  messages?: ChatMessage[];
  signal?: AbortSignal;
  /**
   * Testing / the Phase 0 gate: pretend these providers are down, to prove
   * failover actually works rather than assuming it.
   */
  simulateFailFor?: ProviderName[];
}

export interface GenerateResult<T> {
  /** Validated and typed when the task declares a schema; `undefined` otherwise. */
  data: T | undefined;
  text: string;
  provider: ProviderName;
  model: string;
  promptVersion: string;
  failoverDepth: number;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  latencyMs: number;
  traceId: string;
  /** Providers that were tried and failed, with why. Useful in the debug UI. */
  attempts: { provider: ProviderName; error: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How many times to retry the *same* provider before moving down the chain.
 *
 * A 429 means "wait", not "this provider is broken" — and on free tiers it is the
 * single most common response. Failing straight over burns the next provider's
 * quota too, so a short backoff first keeps more headroom overall. A 5xx gets one
 * retry; anything else moves on immediately.
 */
const SAME_PROVIDER_RETRIES = 2;
const BASE_BACKOFF_MS = 1_200;

function retryDelay(e: unknown, attempt: number): number | null {
  if (!(e instanceof ProviderTransientError)) return null;
  const kind = e.meta.kind;
  if (kind !== 'rate_limit' && kind !== 'server') return null;
  if (attempt >= SAME_PROVIDER_RETRIES) return null;

  const advertised = e.meta.retryAfterMs;
  if (typeof advertised === 'number' && advertised > 0) return Math.min(advertised, 20_000);
  // Exponential with jitter, so parallel callers don't retry in lockstep.
  return BASE_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * 400);
}

function errorKind(e: unknown): string {
  if (e instanceof SchemaValidationError) return 'schema';
  if (e instanceof ProviderTransientError) return String(e.meta.kind ?? 'transient');
  if (e instanceof ProviderRequestError) return 'request';
  return 'unknown';
}

/** Models sometimes wrap JSON in prose or a fence despite being told not to. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();

  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace > 0) {
    const lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export async function generate<T = unknown>(args: GenerateArgs): Promise<GenerateResult<T>> {
  const cfg = taskConfig(args.task);
  const template = getPrompt(cfg.prompt);
  const traceId = newTraceId();

  const rendered = template.render(args.input);
  const jsonSchema = cfg.schema
    ? (zodToJsonSchema(cfg.schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<
        string,
        unknown
      >)
    : undefined;

  const chain = chainFor(cfg.tier, cfg.excludeProviders ? [...cfg.excludeProviders] : []);
  if (chain.length === 0) {
    throw new GatewayExhaustedError(
      `No provider available for tier "${cfg.tier}". Set at least one API key — see docs/08-setup.md`,
      { task: args.task, tier: cfg.tier },
    );
  }

  const attempts: { provider: ProviderName; error: string }[] = [];

  for (let depth = 0; depth < chain.length; depth++) {
    const adapter = chain[depth];
    if (!adapter) continue;

    const started = Date.now();

    try {
      if (args.simulateFailFor?.includes(adapter.name)) {
        throw new ProviderTransientError(`simulated failure for ${adapter.name}`, {
          provider: adapter.name,
          kind: 'simulated',
        });
      }

      const messages: ChatMessage[] = [
        ...(args.messages ?? []),
        { role: 'user', content: rendered },
      ];

      const callWithBackoff = async (msgs: ChatMessage[]): Promise<ChatResponse> => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await adapter.chat({
              tier: cfg.tier,
              system: template.system,
              messages: msgs,
              jsonSchema,
              maxOutputTokens: cfg.maxOutputTokens,
              timeoutMs: cfg.timeoutMs,
              signal: args.signal,
            });
          } catch (err) {
            const wait = retryDelay(err, attempt);
            if (wait === null) throw err;
            await sleep(wait);
          }
        }
      };

      let res: ChatResponse = await callWithBackoff(messages);

      let data: T | undefined;

      if (cfg.schema) {
        const parsed = tryValidate(cfg.schema, res.text);

        if (!parsed.ok) {
          // One repair attempt, same provider, with the validation error shown.
          res = await callWithBackoff([
              ...messages,
              { role: 'assistant', content: res.text },
              {
                role: 'user',
                content:
                  `That response did not match the required schema:\n${parsed.error}\n\n` +
                  `Return only corrected JSON matching the schema. No prose, no code fence.`,
              },
          ]);

          const repaired = tryValidate(cfg.schema, res.text);
          if (!repaired.ok) {
            throw new SchemaValidationError(`schema invalid after repair: ${repaired.error}`, {
              provider: adapter.name,
              task: args.task,
            });
          }
          data = repaired.value as T;
        } else {
          data = parsed.value as T;
        }
      }

      const latencyMs = Date.now() - started;

      void trace({
        task: args.task,
        tier: cfg.tier,
        provider: adapter.name,
        model: res.model,
        promptVersion: cfg.prompt,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        cachedInputTokens: res.usage.cachedInputTokens,
        latencyMs,
        ok: true,
        failoverDepth: depth,
        userId: args.userId,
        traceId,
      });

      return {
        data,
        text: res.text,
        provider: adapter.name,
        model: res.model,
        promptVersion: cfg.prompt,
        failoverDepth: depth,
        usage: res.usage,
        latencyMs,
        traceId,
        attempts,
      };
    } catch (e) {
      const kind = errorKind(e);
      const message = e instanceof Error ? e.message : String(e);
      attempts.push({ provider: adapter.name, error: message });

      void trace({
        task: args.task,
        tier: cfg.tier,
        provider: adapter.name,
        model: adapter.modelFor(cfg.tier),
        promptVersion: cfg.prompt,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        latencyMs: Date.now() - started,
        ok: false,
        errorKind: kind,
        errorMessage: message.slice(0, 300),
        failoverDepth: depth,
        userId: args.userId,
        traceId,
      });

      // A malformed request is our bug. Failing over would mask it against every
      // provider in turn and produce a confusing "all providers failed".
      if (e instanceof ProviderRequestError) throw e;

      // Otherwise (429 / 5xx / timeout / schema) → next provider.
    }
  }

  throw new GatewayExhaustedError(
    `All ${chain.length} provider(s) failed for task "${args.task}"`,
    { task: args.task, tier: cfg.tier, attempts },
  );
}

function tryValidate(
  schema: z.ZodTypeAny,
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };

  const issues = result.error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return { ok: false, error: issues };
}

/**
 * Embeddings. Local only, by design — free, unmetered, and no learner text
 * leaves the machine.
 */
export async function embed(req: EmbedRequest): Promise<EmbedResponse> {
  return ollamaEmbed(req);
}
