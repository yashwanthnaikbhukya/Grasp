import { ProviderRequestError, ProviderTransientError } from '../../errors';

/**
 * Shared HTTP behaviour for provider adapters.
 *
 * The important line is the status classification: 429/5xx/timeout are
 * *transient* and trigger failover; 400/401/403 are our bug and must surface
 * immediately rather than being silently retried against another provider.
 */
export async function postJson(
  url: string,
  body: unknown,
  opts: {
    headers?: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
    provider: string;
  },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const meta = { provider: opts.provider, status: res.status, body: text.slice(0, 600) };

      if (res.status === 429 || res.status >= 500) {
        // Providers tell you how long to wait; honouring it beats guessing.
        const retryAfter = Number(res.headers.get('retry-after') ?? '');
        throw new ProviderTransientError(`${opts.provider} ${res.status}`, {
          ...meta,
          kind: res.status === 429 ? 'rate_limit' : 'server',
          retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
        });
      }
      // The body is the whole diagnostic for a 4xx — a bare status tells you
      // that the request was malformed but not which part.
      throw new ProviderRequestError(
        `${opts.provider} ${res.status}: ${text.slice(0, 400)}`,
        meta,
      );
    }

    return (await res.json()) as unknown;
  } catch (e) {
    if (e instanceof ProviderRequestError || e instanceof ProviderTransientError) throw e;

    // AbortError (our timeout or the caller's), DNS failure, connection reset.
    const name = e instanceof Error ? e.name : 'Error';
    const msg = e instanceof Error ? e.message : String(e);
    throw new ProviderTransientError(`${opts.provider} ${name}: ${msg}`, {
      provider: opts.provider,
      kind: name === 'AbortError' ? 'timeout' : 'connection',
    });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** Narrow an unknown JSON body without sprinkling `any` through the adapters. */
export function pick(obj: unknown, path: readonly (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

export function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
