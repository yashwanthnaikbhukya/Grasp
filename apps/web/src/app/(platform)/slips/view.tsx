'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SlipsData } from '@/lib/data/slips';

/** Derived from the loader, never hand-copied (rule 3). */
type Data = SlipsData;

export function SlipsView({ initial }: { initial?: Data }) {
  const [data, setData] = useState<Data | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [filter, setFilter] = useState<string | null>(null);

  // Rendered with the page when the server sent it; fetched only otherwise.
  useEffect(() => {
    if (initial) return;
    void (async () => {
      const res = await fetch('/api/slips');
      if (res.ok) setData((await res.json()) as Data);
      setLoading(false);
    })();
  }, [initial]);

  if (loading) {
    return (
      <main className="wrap">
        <div className="card"><div className="reps-skeleton" /><div className="reps-skeleton short" /></div>
      </main>
    );
  }

  if (!data || data.total === 0) {
    return (
      <main className="wrap rise" style={{ maxWidth: '40rem' }}>
        <p className="eyebrow">Slips</p>
        <h1 style={{ fontSize: '1.7rem', marginBottom: 'var(--s3)' }}>Nothing here yet</h1>
        <p className="muted">
          Once you have got a few things wrong in Reps, this page groups them by why it
          happened — not by topic.
        </p>
        <p style={{ marginTop: 'var(--s5)' }}>
          <Link className="btn" href="/reps">Go practice</Link>
        </p>
      </main>
    );
  }

  const shown = filter ? data.recent.filter((s) => s.rootCause === filter) : data.recent;
  const top = data.summary[0];

  return (
    <main className="wrap">
      {/* minmax(0, 1fr): an auto track grows to its widest child, and one long
          label pushed the page past a phone's edge (2026-11-09). */}
      <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div>
          <p className="eyebrow">Slips</p>
          <h1 style={{ fontSize: '1.9rem', marginBottom: 'var(--s2)' }}>Why you got things wrong</h1>
          {top && (
            <p style={{ color: 'var(--ink-2)', maxWidth: '46ch' }}>
              Most of your mistakes are <strong>{top.label.toLowerCase()}</strong> —{' '}
              {Math.round(top.share * 100)}% of them. {top.hint}
            </p>
          )}
        </div>

        <div className="card">
          <p className="eyebrow">The pattern</p>
          <div className="slip-bars">
            {data.summary.map((s) => (
              <button
                key={s.rootCause}
                type="button"
                className={`slip-bar${filter === s.rootCause ? ' on' : ''}`}
                aria-pressed={filter === s.rootCause}
                onClick={() => setFilter(filter === s.rootCause ? null : s.rootCause)}
              >
                <span className="slip-bar-label">{s.label}</span>
                <span className="slip-bar-track">
                  <i style={{ width: `${Math.max(s.share * 100, 4)}%` }} />
                </span>
                <span className="mono slip-bar-count">{s.count}</span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 0, marginTop: 'var(--s4)' }}>
            {filter ? 'Showing one cause — click again to clear.' : 'Click a cause to filter below.'}
            {data.lowConfidence > 0 &&
              ` ${data.lowConfidence} mistake${data.lowConfidence > 1 ? 's are' : ' is'} still unclassified.`}
          </p>
        </div>

        <div className="card">
          <p className="eyebrow">Recent</p>
          <div className="slip-list">
            {shown.map((s) => (
              <div key={s.id} className="slip-item">
                <span className="pill pill-warn">{s.label}</span>
                <div>
                  <p style={{ margin: 0 }}>{s.note}</p>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.8rem' }}>
                    {s.concept}
                    {s.upstream && <> · really about <strong>{s.upstream}</strong></>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="row" style={{ gap: 'var(--s3)' }}>
          <Link className="btn" href="/reps">Practice</Link>
        </p>
      </div>
    </main>
  );
}
