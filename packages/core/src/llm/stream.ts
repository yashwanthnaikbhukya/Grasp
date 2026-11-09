import { getPrompt } from '@grasp/prompts';
import type { ProviderName } from '@grasp/schema';
import { GatewayExhaustedError, ProviderRequestError, ProviderTransientError } from '../errors';
import { env } from '../env';
import { chainFor, filesFor, isHealthFailure, noteProviderFailure, noteProviderSuccess } from './gateway';
import { geminiParts } from './providers/gemini';
import { tierForLearner } from './budget';
import { taskConfig, type TaskId } from './registry';
import { newTraceId, trace } from './trace';
import type { ChatMessage, InlineFile } from './types';

/**
 * Streaming generation.
 *
 * Separate from `generate()` because the shapes genuinely differ: a stream has no
 * single response to validate against a schema, so streaming tasks are prose-only
 * by construction. Trying to unify them would mean either buffering the stream
 * (defeating the point) or pretending a partial JSON document is valid.
 *
 * Failover still applies, but only *before the first token*. Once bytes have
 * reached the learner, switching providers mid-answer would splice two different
 * completions together — worse than surfacing the error.
 */

export interface StreamArgs {
  task: TaskId;
  input: Record<string, unknown>;
  messages?: ChatMessage[];
  /**
   * Files for this turn (attached to the rendered message). Optional to the
   * model: a provider that cannot read them gets the turn without them, so the
   * caller must also put their transcript in `input`.
   */
  files?: InlineFile[];
  userId?: string;
  signal?: AbortSignal;
}

export interface StreamChunk {
  type: 'token' | 'done' | 'error';
  text?: string;
  provider?: ProviderName;
  model?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * How long a provider may hold a stream open without sending a single token
 * before we fail over. An overloaded provider does not always answer 503 — it
 * can accept the request and then say nothing, and without this deadline the
 * learner waits forever on a blinking cursor. Capped by the task's `timeoutMs`.
 */
const FIRST_TOKEN_TIMEOUT_MS = 10_000;

/** Parse an SSE byte stream into `data:` payload strings. */
async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; a chunk boundary can land
      // anywhere, so only complete events are emitted.
      for (let idx = buffer.indexOf('\n'); idx >= 0; idx = buffer.indexOf('\n')) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function pluck(obj: unknown, path: readonly (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

async function* streamGemini(
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.gemini.apiKey },
    signal,
    body: JSON.stringify({
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: geminiParts(m),
      })),
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const meta = { provider: 'gemini', status: res.status, body: text.slice(0, 300) };
    if (res.status === 429 || res.status >= 500) {
      throw new ProviderTransientError(`gemini ${res.status}`, meta);
    }
    throw new ProviderRequestError(`gemini ${res.status}`, meta);
  }

  let input = 0;
  let output = 0;

  for await (const payload of sseLines(res.body)) {
    if (!payload || payload === '[DONE]') continue;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const parts = pluck(json, ['candidates', 0, 'content', 'parts']);
    if (Array.isArray(parts)) {
      const text = parts.map((p) => String(pluck(p, ['text']) ?? '')).join('');
      if (text) yield { type: 'token', text };
    }
    const pt = pluck(json, ['usageMetadata', 'promptTokenCount']);
    const ct = pluck(json, ['usageMetadata', 'candidatesTokenCount']);
    if (typeof pt === 'number') input = pt;
    if (typeof ct === 'number') output = ct;
  }

  yield { type: 'done', usage: { inputTokens: input, outputTokens: output } };
}

async function* streamOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  provider: string,
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const payloadMessages: { role: string; content: string }[] = [];
  if (system) payloadMessages.push({ role: 'system', content: system });
  for (const m of messages) payloadMessages.push({ role: m.role, content: m.content });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    signal,
    body: JSON.stringify({
      model,
      messages: payloadMessages,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const meta = { provider, status: res.status, body: text.slice(0, 300) };
    if (res.status === 429 || res.status >= 500) {
      throw new ProviderTransientError(`${provider} ${res.status}`, meta);
    }
    throw new ProviderRequestError(`${provider} ${res.status}`, meta);
  }

  let input = 0;
  let output = 0;

  for await (const payload of sseLines(res.body)) {
    if (!payload || payload === '[DONE]') continue;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const text = pluck(json, ['choices', 0, 'delta', 'content']);
    if (typeof text === 'string' && text) yield { type: 'token', text };

    const pt = pluck(json, ['usage', 'prompt_tokens']);
    const ct = pluck(json, ['usage', 'completion_tokens']);
    if (typeof pt === 'number') input = pt;
    if (typeof ct === 'number') output = ct;
  }

  yield { type: 'done', usage: { inputTokens: input, outputTokens: output } };
}

/**
 * Stream a prose task through the provider chain.
 *
 * Failover happens only while no token has been emitted. After that the stream is
 * committed to its provider — splicing two completions together would produce
 * text that contradicts itself mid-sentence.
 */
export async function* generateStream(args: StreamArgs): AsyncGenerator<StreamChunk> {
  const cfg = taskConfig(args.task);
  if (cfg.schema) {
    throw new Error(
      `Task "${args.task}" declares a schema; streaming tasks must be prose-only. Use generate().`,
    );
  }

  const template = getPrompt(cfg.prompt);
  const rendered = template.render(args.input);
  const traceId = newTraceId();

  const turn: ChatMessage[] = [
    ...(args.messages ?? []),
    { role: 'user', content: rendered, ...(args.files?.length ? { files: args.files } : {}) },
  ];
  // The cost guard: a learner past today's output-token budget is served on the
  // fast tier. Tutor turns are where per-learner spend lives (llm/budget.ts).
  const tier = await tierForLearner(cfg.tier, args.userId);
  const chain = chainFor(tier, cfg.excludeProviders ? [...cfg.excludeProviders] : []);

  if (chain.length === 0) {
    throw new GatewayExhaustedError(`No provider available for tier "${tier}"`, {
      task: args.task,
    });
  }

  const attempts: string[] = [];

  for (let depth = 0; depth < chain.length; depth++) {
    const adapter = chain[depth];
    if (!adapter) continue;

    const model = adapter.modelFor(tier);
    const started = Date.now();
    let emitted = false;
    const messages = filesFor(turn, adapter);

    // One abort per attempt, fed by three things: the learner's Stop, a
    // first-token deadline, and the task's overall timeout. Mirrors postJson()
    // on the non-streaming path, which always had both timeouts.
    const attempt = new AbortController();
    const onCallerAbort = () => attempt.abort();
    args.signal?.addEventListener('abort', onCallerAbort, { once: true });
    const firstTokenMs = Math.min(FIRST_TOKEN_TIMEOUT_MS, cfg.timeoutMs);
    const firstTokenTimer = setTimeout(() => attempt.abort(), firstTokenMs);
    const totalTimer = setTimeout(() => attempt.abort(), cfg.timeoutMs);

    try {
      const iter =
        adapter.name === 'gemini'
          ? streamGemini(model, template.system, messages, cfg.maxOutputTokens, attempt.signal)
          : adapter.name === 'ollama'
            ? streamOpenAICompatible(
                `${env.ollama.baseUrl}/v1`,
                'ollama',
                'ollama',
                model,
                template.system,
                messages,
                cfg.maxOutputTokens,
                attempt.signal,
              )
            : streamOpenAICompatible(
                adapter.name === 'groq'
                  ? 'https://api.groq.com/openai/v1'
                  : 'https://openrouter.ai/api/v1',
                adapter.name === 'groq' ? env.groq.apiKey : env.openrouter.apiKey,
                adapter.name,
                model,
                template.system,
                messages,
                cfg.maxOutputTokens,
                attempt.signal,
              );

      for await (const chunk of iter) {
        if (chunk.type === 'token') {
          if (!emitted) clearTimeout(firstTokenTimer);
          emitted = true;
          yield chunk;
        } else if (chunk.type === 'done') {
          noteProviderSuccess(adapter.name, tier);
          void trace({
            task: args.task,
            tier: tier,
            provider: adapter.name,
            model,
            promptVersion: cfg.prompt,
            inputTokens: chunk.usage?.inputTokens ?? 0,
            outputTokens: chunk.usage?.outputTokens ?? 0,
            cachedInputTokens: 0,
            latencyMs: Date.now() - started,
            ok: true,
            failoverDepth: depth,
            userId: args.userId,
            traceId,
          });
          yield { ...chunk, provider: adapter.name, model };
          return;
        }
      }
      return;
    } catch (e) {
      // The learner pressed Stop. That is not a provider failure — failing over
      // would spend a second provider's quota on an answer nobody is waiting for.
      if (args.signal?.aborted) return;

      const timedOut = attempt.signal.aborted;
      const message = timedOut
        ? emitted
          ? `timed out mid-answer after ${cfg.timeoutMs} ms`
          : `no first token within ${firstTokenMs} ms`
        : e instanceof Error
          ? e.message
          : String(e);
      attempts.push(`${adapter.name}: ${message}`);
      if (timedOut || isHealthFailure(e)) noteProviderFailure(adapter.name, tier);

      void trace({
        task: args.task,
        tier: tier,
        provider: adapter.name,
        model,
        promptVersion: cfg.prompt,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        latencyMs: Date.now() - started,
        ok: false,
        errorKind: timedOut || e instanceof ProviderTransientError ? 'transient' : 'request',
        errorMessage: message.slice(0, 300),
        failoverDepth: depth,
        userId: args.userId,
        traceId,
      });

      // Committed once the learner has seen text.
      if (emitted) {
        yield { type: 'error', error: 'The connection dropped mid-answer. Try again.' };
        return;
      }
      if (e instanceof ProviderRequestError) throw e;
    } finally {
      clearTimeout(firstTokenTimer);
      clearTimeout(totalTimer);
      args.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  throw new GatewayExhaustedError(`All providers failed streaming "${args.task}"`, {
    task: args.task,
    attempts,
  });
}
