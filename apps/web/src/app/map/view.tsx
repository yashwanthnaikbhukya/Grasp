'use client';

import { useEffect, useMemo, useState } from 'react';

interface Node {
  id: string;
  name: string;
  x: number;
  y: number;
  p: number;
  state: string;
  attempts: number;
  depth: number;
  isBlocker: boolean;
  heat: 'unseen' | 'weak' | 'partial' | 'strong';
  prereqIds: string[];
}

interface Edge { from: string; to: string; critical: boolean }

interface MapData {
  nodes: Node[];
  edges: Edge[];
  width: number;
  height: number;
  focusChain: string[];
  empty?: boolean;
  stats: { total: number; touched: number; mastered: number; blockers: number };
}

const HEAT_FILL: Record<Node['heat'], string> = {
  unseen: 'var(--glass-subtle)',
  weak: 'var(--bad-soft)',
  partial: 'var(--ochre-soft)',
  strong: 'var(--ok-soft)',
};
const HEAT_STROKE: Record<Node['heat'], string> = {
  unseen: 'var(--rule-strong)',
  weak: 'var(--bad)',
  partial: 'var(--ochre)',
  strong: 'var(--ok)',
};

export function MapView() {
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/map');
      if (res.ok) setData((await res.json()) as MapData);
      setLoading(false);
    })();
  }, []);

  const byId = useMemo(
    () => new Map((data?.nodes ?? []).map((n) => [n.id, n])),
    [data],
  );

  // Selecting a node dims everything not connected to it, which is the only way
  // a graph this dense stays readable.
  const related = useMemo(() => {
    if (!selected || !data) return null;
    const keep = new Set<string>([selected]);
    for (const e of data.edges) {
      if (e.to === selected) keep.add(e.from);
      if (e.from === selected) keep.add(e.to);
    }
    return keep;
  }, [selected, data]);

  const focus = new Set(data?.focusChain ?? []);

  if (loading) {
    return (
      <main className="wrap">
        <div className="card"><div className="reps-skeleton" /><div className="reps-skeleton short" /></div>
      </main>
    );
  }

  if (!data || data.empty || data.nodes.length === 0) {
    return (
      <main className="wrap rise" style={{ maxWidth: '40rem' }}>
        <p className="eyebrow">Map</p>
        <h1 style={{ fontSize: '1.7rem', marginBottom: 'var(--s3)' }}>No concepts yet</h1>
        <p className="muted">
          The graph fills itself as material is ingested. Run <code>pnpm ingest --all</code>.
        </p>
        <p style={{ marginTop: 'var(--s5)' }}>
          <a className="btn btn-ghost" href="/app" style={{ textDecoration: 'none' }}>Back</a>
        </p>
      </main>
    );
  }

  const node = selected ? byId.get(selected) : null;
  const chainNames = (data.focusChain ?? []).map((id) => byId.get(id)?.name ?? id);

  return (
    <main className="map-page">
      <header className="map-head">
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>Map</p>
          <h1 style={{ fontSize: '1.5rem' }}>What you hold</h1>
        </div>
        <a className="btn btn-ghost" href="/app" style={{ textDecoration: 'none' }}>Back</a>
      </header>

      <div className="map-legend">
        {(['unseen', 'weak', 'partial', 'strong'] as const).map((h) => (
          <span key={h} className="map-key">
            <i style={{ background: HEAT_FILL[h], borderColor: HEAT_STROKE[h] }} />
            {h === 'unseen' ? 'not started' : h}
          </span>
        ))}
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {data.stats.touched}/{data.stats.total} started · {data.stats.mastered} mastered
          {data.stats.blockers > 0 && ` · ${data.stats.blockers} blocking`}
        </span>
      </div>

      {chainNames.length > 1 && (
        <div className="card map-focus">
          <p className="eyebrow" style={{ margin: 0 }}>Fix this first</p>
          <p style={{ margin: '4px 0 0' }}>
            {chainNames.map((n, i) => (
              <span key={n}>
                {i > 0 && <span className="muted"> ← </span>}
                <strong>{n}</strong>
              </span>
            ))}
          </p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.83rem' }}>
            Reading right to left: the rightmost is what actually needs work.
          </p>
        </div>
      )}

      <div className="map-canvas card">
        <svg
          viewBox={`0 0 ${data.width} ${data.height}`}
          className="map-svg"
          role="img"
          aria-label="Concept graph coloured by your mastery"
        >
          {data.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const dim = related ? !(related.has(e.from) && related.has(e.to)) : false;
            const inFocus = focus.has(e.from) && focus.has(e.to);
            return (
              <line
                key={`${e.from}-${e.to}`}
                x1={a.x} y1={a.y + 16} x2={b.x} y2={b.y - 16}
                className={`map-edge${e.critical ? ' critical' : ''}${inFocus ? ' focus' : ''}${dim ? ' dim' : ''}`}
              />
            );
          })}

          {data.nodes.map((n) => {
            const dim = related ? !related.has(n.id) : false;
            return (
              <g
                key={n.id}
                className={`map-node${dim ? ' dim' : ''}${focus.has(n.id) ? ' focus' : ''}`}
                transform={`translate(${n.x} ${n.y})`}
                onClick={() => setSelected(selected === n.id ? null : n.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    setSelected(selected === n.id ? null : n.id);
                  }
                }}
              >
                <rect
                  x={-78} y={-16} width={156} height={32} rx={16}
                  fill={HEAT_FILL[n.heat]}
                  stroke={n.isBlocker ? 'var(--bad)' : HEAT_STROKE[n.heat]}
                  strokeWidth={n.isBlocker || selected === n.id ? 2 : 1}
                />
                <text className="map-label" textAnchor="middle" dy="0.34em">
                  {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {node && (
        <div className="card map-detail slide-in">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '1.1rem' }}>{node.name}</h2>
            <span className={`pill pill-${node.heat === 'strong' ? 'ok' : node.heat === 'weak' ? 'bad' : 'warn'}`}>
              {node.attempts === 0 ? 'not started' : `${Math.round(node.p * 100)}%`}
            </span>
          </div>
          <p className="muted" style={{ fontSize: '0.86rem', margin: 'var(--s2) 0 0' }}>
            {node.attempts === 0
              ? 'You have not practised this yet.'
              : `${node.attempts} attempt${node.attempts > 1 ? 's' : ''} · ${node.state}`}
            {node.prereqIds.length > 0 && (
              <> · needs {node.prereqIds.map((id) => byId.get(id)?.name ?? id).join(', ')}</>
            )}
          </p>
          <p className="row" style={{ gap: 'var(--s3)', marginTop: 'var(--s4)', marginBottom: 0 }}>
            <a className="btn" href="/reps" style={{ textDecoration: 'none' }}>Practise</a>
            <a className="btn btn-ghost" href="/ask" style={{ textDecoration: 'none' }}>Ask about it</a>
          </p>
        </div>
      )}
    </main>
  );
}
