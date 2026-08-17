import { env } from '../env';
import { collections } from '../db/collections';

/**
 * Tracing. Never fails a request because tracing failed.
 *
 * Writes to `llmCalls` in Mongo always, and to Langfuse when keys are present.
 * The Mongo record is the one that survives without a third party and powers the
 * cost guard; Langfuse is the rich view.
 */

export interface TraceRecord {
  task: string;
  tier: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latencyMs: number;
  ok: boolean;
  errorKind?: string;
  /** Provider's message, truncated. Without it, debugging 'transient' is guesswork. */
  errorMessage?: string;
  /**
   * How many providers had to be skipped. A rising average means the primary
   * free tier is saturated — a signal available nowhere else.
   */
  failoverDepth: number;
  userId?: string;
  traceId: string;
  evalTags?: string[];
}

export function newTraceId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function trace(rec: TraceRecord): Promise<void> {
  const line = {
    ...rec,
    createdAt: new Date(),
  };

  // Local record first — this one must be cheap and must not throw.
  try {
    if (env.mongo.uri) {
      await collections.llmCalls().insertOne(line);
    }
  } catch {
    // Swallow: a failed trace write must never fail the learner's request.
  }

  if (!env.langfuse.publicKey || !env.langfuse.secretKey) {
    // No Langfuse configured — one structured stdout line instead.
    const flag = rec.ok ? 'ok' : `ERR(${rec.errorKind ?? 'unknown'}${rec.errorMessage ? `: ${rec.errorMessage.slice(0, 70)}` : ''})`;
    const fo = rec.failoverDepth > 0 ? ` failover=${rec.failoverDepth}` : '';
    // eslint-disable-next-line no-console
    console.log(
      `[llm] ${rec.task} ${flag} ${rec.provider}/${rec.model} ` +
        `${rec.latencyMs}ms in=${rec.inputTokens} out=${rec.outputTokens}${fo} ${rec.traceId}`,
    );
    return;
  }

  try {
    const auth = Buffer.from(`${env.langfuse.publicKey}:${env.langfuse.secretKey}`).toString(
      'base64',
    );
    await fetch(`${env.langfuse.baseUrl}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(4_000),
      body: JSON.stringify({
        batch: [
          {
            id: rec.traceId,
            type: 'generation-create',
            timestamp: new Date().toISOString(),
            body: {
              id: rec.traceId,
              name: rec.task,
              model: `${rec.provider}/${rec.model}`,
              usage: {
                input: rec.inputTokens,
                output: rec.outputTokens,
                unit: 'TOKENS',
              },
              metadata: {
                tier: rec.tier,
                promptVersion: rec.promptVersion,
                failoverDepth: rec.failoverDepth,
                ok: rec.ok,
                errorKind: rec.errorKind,
                evalTags: rec.evalTags,
              },
              userId: rec.userId,
              latency: rec.latencyMs,
            },
          },
        ],
      }),
    });
  } catch {
    // Same rule.
  }
}
