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
import { restoreLatexDeep } from './latex';
import { newTraceId, trace } from './trace';
import type {
  ChatMessage,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  FileKind,
  InlineFile,
  ProviderAdapter,
} from './types';

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
 * with Gemini — on its lightest model (`GEMINI_MODEL_MID`, flash-lite), which
 * keeps the free-tier quota from running out and streamed its first token in
 * ~1 s when the full flash model was overloaded (decided 2026-11-08 from ttftMs). `best` has **no local leg** — a small local model
 * cannot do judgments that get written into the learner graph, and a wrong label
 * persists for weeks. Failing is the better outcome.
 */
const CHAINS: Record<ModelTier, ProviderName[]> = {
  fast: ['groq', 'gemini', 'openrouter', 'ollama'],
  mid: ['gemini', 'groq', 'openrouter', 'ollama'],
  best: ['gemini', 'openrouter', 'groq'],
};

/** The kind of an inline file, by MIME type. */
export function fileKind(mime: string): FileKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return null;
}

/** True when this adapter can read every file in these messages. */
export function readsAll(adapter: ProviderAdapter, files: readonly InlineFile[]): boolean {
  return files.every((f) => {
    const kind = fileKind(f.mime);
    return kind !== null && (adapter.reads ?? []).includes(kind);
  });
}

/**
 * The messages as this adapter should get them: files it cannot read are
 * dropped (their transcript is already in the text), and nothing is sent to a
 * text-only provider that it would reject.
 */
export function filesFor(messages: ChatMessage[], adapter: ProviderAdapter): ChatMessage[] {
  return messages.map((m) => {
    if (!m.files?.length) return m;
    const kept = m.files.filter((f) => readsAll(adapter, [f]));
    const { files: _dropped, ...rest } = m;
    return kept.length > 0 ? { ...rest, files: kept } : rest;
  });
}

export function chainFor(tier: ModelTier, exclude: ProviderName[] = []): ProviderAdapter[] {
  const available = CHAINS[tier]
    .filter((n) => !exclude.includes(n))
    .map((n) => ALL[n])
    .filter((a) => a.available(tier));
  return orderByHealth(available, tier);
}

// ---- Provider health ------------------------------------------------------

/**
 * A provider that just failed transiently sinks to the back of its tier's chain
 * for a while.
 *
 * Without this, every request re-discovers the same outage: an overloaded
 * provider costs each learner its full timeout (10 s on a stream's first token)
 * before failover even starts. Cooling providers are re-ordered, never removed —
 * if everything else is down too, they still get their turn.
 *
 * Per tier, because each tier is a different model: `gemini-flash-latest` can be
 * overloaded while `gemini-flash-lite-latest` is fine. In-memory and
 * per-instance on purpose — best-effort routing, not shared state worth a store.
 */
const COOLDOWN_MS = 60_000;
/**
 * Back-off cap. A provider that keeps failing cools for 1, 2, 4, 8… minutes, up
 * to this. Seen on 2026-11-08: `gemini-flash-latest` was overloaded for hours,
 * and a flat 60 s cooldown made every tutor turn after each expiry pay the full
 * 10 s first-token deadline again.
 */
const MAX_COOLDOWN_MS = 10 * 60_000;
const coolingUntil = new Map<string, number>();
const consecutiveFailures = new Map<string, number>();
const healthKey = (provider: ProviderName, tier: ModelTier) => `${provider}:${tier}`;

/** Transient kinds that say something about the provider's health right now. */
const HEALTH_KINDS = new Set(['rate_limit', 'server', 'timeout', 'connection']);

export function noteProviderFailure(provider: ProviderName, tier: ModelTier, now = Date.now()) {
  const key = healthKey(provider, tier);
  const failures = (consecutiveFailures.get(key) ?? 0) + 1;
  consecutiveFailures.set(key, failures);
  coolingUntil.set(key, now + Math.min(COOLDOWN_MS * 2 ** (failures - 1), MAX_COOLDOWN_MS));
}

export function noteProviderSuccess(provider: ProviderName, tier: ModelTier) {
  const key = healthKey(provider, tier);
  coolingUntil.delete(key);
  consecutiveFailures.delete(key);
}

/** Test seam. */
export function resetProviderHealth() {
  coolingUntil.clear();
  consecutiveFailures.clear();
}

/** Stable: healthy providers keep their configured order, then cooling ones. */
export function orderByHealth<T extends { name: ProviderName }>(
  adapters: readonly T[],
  tier: ModelTier,
  now = Date.now(),
): T[] {
  const cooling = (a: T) => (coolingUntil.get(healthKey(a.name, tier)) ?? 0) > now;
  return [...adapters.filter((a) => !cooling(a)), ...adapters.filter(cooling)];
}

/** Whether an error should cool the provider down (not schema, not our bug). */
export function isHealthFailure(e: unknown): boolean {
  return e instanceof ProviderTransientError && HEALTH_KINDS.has(String(e.meta.kind));
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
  /**
   * Providers this one call must not use, on top of the task's own exclusions.
   * The eval judge uses it so a model never grades its own family's output
   * (docs/09-conventions.md — Evals, rule 1).
   */
  excludeProviders?: ProviderName[];
  /** Files for this turn, attached to the rendered message. */
  files?: InlineFile[];
  /**
   * The files are the whole point (reading an attachment): only providers that
   * can read them are tried. Otherwise they are optional, as in a stream.
   */
  filesRequired?: boolean;
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

/**
 * Re-escape LaTeX backslashes that JSON would silently turn into control chars.
 *
 * A model writing maths inside a JSON string often emits `"\theta"` instead of
 * `"\\theta"`. That is *valid* JSON — `\t` is a tab — so it parses without
 * complaint and `θ` arrives as TAB + "heta". It shipped that way: two verified
 * cards rendered "sin heta". Same trap for `\times \tan \frac \beta \rho \neq`…
 *
 * The other half: `\sin \le \cdot \underline` are not JSON escapes at all, so
 * the parse throws and a good card costs a repair round trip or gets rejected.
 *
 * Re-escaped: any backslash JSON cannot read (`\s`, `\l`, `\u` without 4 hex
 * digits…), and `\b \f \t \r` + a letter, which is never what a model meant in
 * prose. `\n` + letters is usually a real newline, so only the LaTeX commands
 * that start with n, as whole words, are touched.
 */
const LATEX_IN_JSON =
  /(?<!\\)\\(?=[^"\\/bfnrtu]|u(?![0-9a-fA-F]{4})|[bftr][a-zA-Z]|n(?:abla|eq|eg|mid|ot|u|e)(?![a-zA-Z]))/g;

export function repairLatexEscapes(json: string): string {
  return json.replace(LATEX_IN_JSON, '\\\\');
}

/**
 * Exported for tests: fence/prose stripping + LaTeX repair, then parse, then put
 * back the backslashes a strict-schema decoder never let through (./latex.ts).
 */
export function parseModelJson(text: string): unknown {
  return restoreLatexDeep(JSON.parse(repairLatexEscapes(extractJson(text))));
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

  const chain = chainFor(cfg.tier, [
    ...(cfg.excludeProviders ?? []),
    ...(args.excludeProviders ?? []),
  ]).filter((a) => !args.filesRequired || readsAll(a, args.files ?? []));
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

      const messages: ChatMessage[] = filesFor(
        [
          ...(args.messages ?? []),
          { role: 'user', content: rendered, ...(args.files?.length ? { files: args.files } : {}) },
        ],
        adapter,
      );

      const callWithBackoff = async (msgs: ChatMessage[]): Promise<ChatResponse> => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await adapter.chat({
              tier: cfg.tier,
              system: template.system,
              messages: msgs,
              jsonSchema,
              maxOutputTokens: cfg.maxOutputTokens,
              reasoningEffort: cfg.reasoningEffort,
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
              // Versioned like every other prompt (rule 2).
              { role: 'user', content: getPrompt('schema.repair@1').render({ error: parsed.error }) },
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
      noteProviderSuccess(adapter.name, cfg.tier);

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
      // The caller gave up (learner navigated away, request aborted). Trying the
      // next provider would spend its quota on an answer nobody is waiting for.
      if (args.signal?.aborted) throw e;

      const kind = errorKind(e);
      const message = e instanceof Error ? e.message : String(e);
      attempts.push({ provider: adapter.name, error: message });
      if (isHealthFailure(e)) noteProviderFailure(adapter.name, cfg.tier);

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
    json = parseModelJson(text);
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
