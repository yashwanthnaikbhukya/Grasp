'use client';

import Link from 'next/link';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRightIcon, CloseIcon } from '@/components/brand/icons';
import type { MapData } from '@/lib/data/map';
import { ConceptGraph } from './graph';

type Node = MapData['nodes'][number];

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

export function MapView({ initial }: { initial?: MapData }) {
  const [data, setData] = useState<MapData | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [selected, setSelected] = useState<string | null>(null);

  // Rendered with the page when the server sent it; fetched only otherwise.
  useEffect(() => {
    if (initial) return;
    void (async () => {
      const res = await fetch('/api/map');
      if (res.ok) setData((await res.json()) as MapData);
      setLoading(false);
    })();
  }, [initial]);

  const byId = useMemo(
    () => new Map((data?.nodes ?? []).map((n) => [n.id, n])),
    [data],
  );
  // What each idea leads to — the other half of "Builds on".
  const dependents = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const e of data?.edges ?? []) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    return out;
  }, [data]);

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
        <h1 style={{ fontSize: '1.7rem', marginBottom: 'var(--s3)' }}>Your map is still being drawn</h1>
        {/* A learner sees this whenever their subjects have no study material yet —
            most subjects today. It used to tell them to run `pnpm ingest`. */}
        <p className="muted">
          The map of ideas for your subjects grows as study material for them is added. The tutor already
          works for every subject — ask it anything in the meantime.
        </p>
        <p className="row" style={{ gap: 'var(--s3)', marginTop: 'var(--s5)' }}>
          <Link className="btn" href="/ask">
            Ask the tutor
          </Link>
          <Link className="btn btn-ghost" href="/profile">
            Check your subjects
          </Link>
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
          {/* Left to right, in the order to learn them — the chain arrives
              weakest-first, and a ← read right-to-left needed a caption to explain it. */}
          <ol className="map-chain">
            {[...chainNames].reverse().map((n, i) => (
              <li key={n}>
                {i > 0 && <ArrowRightIcon size={16} className="map-chain-arrow" />}
                <strong>{n}</strong>
              </li>
            ))}
          </ol>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.83rem' }}>
            Start on the left — each idea unlocks the next.
          </p>
        </div>
      )}

      <div className={`map-body${node ? ' has-detail' : ''}`}>
        <div className="map-canvas card">
          <ConceptGraph
            nodes={data.nodes}
            edges={data.edges}
            focusChain={data.focusChain ?? []}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        {/* Beside the graph on wide screens, a sheet over its foot on narrow ones —
            never on top of the graph's controls (it used to stick to the viewport
            bottom and cover them, 2026-11-09). Always mounted on wide screens so
            picking an idea never shifts the layout. */}
        <aside className="card map-detail" aria-label="Selected idea">
          {node ? (
            <div key={node.id} className="map-detail-inner fade" aria-live="polite">
              <div className="map-detail-head">
                <span className={`pill pill-${node.heat === 'strong' ? 'ok' : node.heat === 'weak' ? 'bad' : node.heat === 'partial' ? 'warn' : 'info'}`}>
                  {node.attempts === 0 ? 'not started' : `${Math.round(node.p * 100)}% · ${node.heat}`}
                </span>
                <button
                  type="button"
                  className="map-detail-close"
                  aria-label="Close"
                  title="Close"
                  onClick={() => setSelected(null)}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
              <h2 className="map-detail-title">{node.name}</h2>
              <p className="muted map-detail-note">
                {node.attempts === 0
                  ? 'You have not practiced this yet.'
                  : `${node.attempts} attempt${node.attempts > 1 ? 's' : ''} so far.`}
                {node.isBlocker && ' Something you are working on depends on it.'}
              </p>

              <ConceptLinks label="Builds on" ids={node.prereqIds} byId={byId} onPick={setSelected} />
              <ConceptLinks label="Leads to" ids={dependents.get(node.id) ?? []} byId={byId} onPick={setSelected} />

              {/* Hand the idea to the other features — one platform, not three tools. */}
              <div className="map-detail-actions">
                <Link className="btn" href={`/reps?concept=${encodeURIComponent(node.id)}`}>
                  Practice this
                </Link>
                <Link className="btn btn-ghost" href={`/ask?q=${encodeURIComponent(`Help me understand: ${node.name}`)}`}>
                  Ask about it
                </Link>
              </div>
            </div>
          ) : (
            <p className="map-detail-empty muted">Pick an idea on the map to see how you are doing and what it builds on.</p>
          )}
        </aside>
      </div>
    </main>
  );
}

/** Neighboring ideas as chips — picking one moves the selection along the map. */
function ConceptLinks({
  label,
  ids,
  byId,
  onPick,
}: {
  label: string;
  ids: string[];
  byId: Map<string, Node>;
  onPick: (id: string) => void;
}) {
  const known = ids.filter((id) => byId.has(id));
  if (known.length === 0) return null;
  return (
    <div className="map-links">
      <p className="map-links-label">{label}</p>
      <ul>
        {known.map((id) => {
          const n = byId.get(id) as Node;
          return (
            <li key={id}>
              <button type="button" className={`map-link heat-${n.heat}`} onClick={() => onPick(id)}>
                {n.name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
