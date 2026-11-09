import { notFound } from 'next/navigation';
import { chainFor, generate, type GenerateResult } from '@grasp/core';
import type { ProviderName, QueryUnderstanding } from '@grasp/schema';

export const dynamic = 'force-dynamic';

/**
 * The Phase 0 gate, made verifiable.
 *
 * Runs `query.understand` twice: once normally, once with the primary provider
 * forced to fail. Both must succeed, and the second must report
 * failoverDepth > 0 — otherwise failover is untested rather than working.
 */

const SAMPLE = {
  query: 'explain that identity again, the one with sin and cos',
  history: [
    { role: 'user', text: 'how do I prove sin²θ + cos²θ = 1?' },
    { role: 'assistant', text: 'Start from the unit circle and the Pythagorean theorem…' },
  ],
  conceptCatalog: [
    'sin-cos-identities — the Pythagorean and addition identities',
    'radian-measure — angles in radians, conversion from degrees',
    'unit-circle — definition of sine and cosine on the unit circle',
    'quadratic-formula — roots of a quadratic',
  ].join('\n'),
};

type Outcome =
  | { ok: true; result: GenerateResult<QueryUnderstanding> }
  | { ok: false; error: string };

async function run(simulateFailFor: ProviderName[]): Promise<Outcome> {
  try {
    const result = await generate<QueryUnderstanding>({
      task: 'query.understand',
      input: SAMPLE,
      simulateFailFor,
    });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row" style={{ borderBottom: '1px solid var(--rule)', padding: '6px 0' }}>
      <span
        className="mono muted"
        style={{ minWidth: '11rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}
      >
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{value}</span>
    </div>
  );
}

function Result({
  title,
  note,
  outcome,
  expectFailover,
}: {
  title: string;
  note: string;
  outcome: Outcome;
  expectFailover: boolean;
}) {
  if (!outcome.ok) {
    return (
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h3>
          <span className="pill pill-bad">failed</span>
        </div>
        <p className="muted" style={{ fontSize: '0.9rem' }}>{note}</p>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{outcome.error}</pre>
      </div>
    );
  }

  const r = outcome.result;
  const failoverOk = expectFailover ? r.failoverDepth > 0 : true;
  const passed = Boolean(r.data) && failoverOk;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h3>
        <span className={passed ? 'pill pill-ok' : 'pill pill-warn'}>
          {passed ? 'passed' : 'ran, gate not met'}
        </span>
      </div>
      <p className="muted" style={{ fontSize: '0.9rem', marginTop: 'var(--s1)' }}>{note}</p>

      <Row label="served by" value={<span className="mono">{r.provider} / {r.model}</span>} />
      <Row
        label="failover depth"
        value={
          <span className="mono">
            {r.failoverDepth}
            {expectFailover && r.failoverDepth === 0 ? (
              <span className="muted"> — expected &gt; 0; is a second provider configured?</span>
            ) : null}
          </span>
        }
      />
      <Row label="prompt version" value={<span className="mono">{r.promptVersion}</span>} />
      <Row label="latency" value={<span className="mono">{r.latencyMs} ms</span>} />
      <Row
        label="tokens"
        value={<span className="mono">in {r.usage.inputTokens} · out {r.usage.outputTokens}</span>}
      />
      <Row label="trace id" value={<span className="mono">{r.traceId}</span>} />
      {r.attempts.length > 0 && (
        <Row
          label="skipped"
          value={
            <span className="mono" style={{ fontSize: '0.8rem' }}>
              {r.attempts.map((a) => `${a.provider}: ${a.error}`).join(' · ')}
            </span>
          }
        />
      )}

      <p className="eyebrow" style={{ marginTop: 'var(--s5)' }}>Validated output</p>
      <pre style={{ margin: 0 }}>{JSON.stringify(r.data, null, 2)}</pre>
    </div>
  );
}

export default async function GatewayDebugPage() {
  // Second line behind middleware.ts: this page spends real model calls, and a
  // layout's notFound() does not stop a page rendering in parallel.
  if (process.env.NODE_ENV === 'production') notFound();
  const chain = chainFor('fast');
  const primary = chain[0]?.name;

  const [plain, failover] = await Promise.all([
    run([]),
    primary ? run([primary]) : Promise.resolve<Outcome>({ ok: false, error: 'No provider configured for tier "fast" — set GEMINI_API_KEY or GROQ_API_KEY. See docs/08-setup.md' }),
  ]);

  return (
    <main className="wrap">
      <p className="eyebrow">Debug · Phase 0 gate</p>
      <h1 style={{ fontSize: '2rem', margin: '0 0 var(--s3)' }}>Gateway</h1>
      <p style={{ color: 'var(--ink-2)', maxWidth: '60ch' }}>
        Both cards below must be green. The second one is the one that matters — free-tier
        providers rate-limit constantly, so failover is the normal operating path, not a
        resilience nicety.
      </p>

      <div className="card">
        <p className="eyebrow">Provider chain · tier fast</p>
        {chain.length === 0 ? (
          <p style={{ margin: 0 }}>
            <span className="pill pill-bad">none configured</span>{' '}
            <span className="muted">
              Set at least one key. Two is the real minimum — with one you&apos;ll hit a rate
              limit mid-session and stop.
            </span>
          </p>
        ) : (
          <p className="row" style={{ margin: 0, gap: 'var(--s2)' }}>
            {chain.map((a, i) => (
              <span key={a.name} className={i === 0 ? 'pill pill-info' : 'pill pill-warn'}>
                {i + 1}. {a.name}
              </span>
            ))}
          </p>
        )}
      </div>

      <Result
        title="1 — Structured output"
        note="Runs query.understand and validates the response against its Zod schema."
        outcome={plain}
        expectFailover={false}
      />

      <Result
        title={`2 — Failover${primary ? ` (${primary} forced down)` : ''}`}
        note="Same task with the primary provider simulated as unavailable. Must still succeed, from the next provider in the chain."
        outcome={failover}
        expectFailover
      />

      <p className="muted" style={{ fontSize: '0.9rem' }}>
        Dependency status: <a href="/api/health">/api/health</a> · Setup:{' '}
        <code>docs/08-setup.md</code>
      </p>
    </main>
  );
}
