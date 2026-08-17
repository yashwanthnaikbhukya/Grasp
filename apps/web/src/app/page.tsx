import { env, flags } from '@grasp/core';

export const dynamic = 'force-dynamic';

const SURFACES = [
  { key: 'ask', name: 'Ask', desc: 'Socratic tutor grounded in your syllabus', phase: 1 },
  { key: 'reps', name: 'Reps', desc: 'Bite-size practice, scheduled by mastery', phase: 2 },
  { key: 'snap', name: 'Snap', desc: 'Photo of a doubt → guided walkthrough', phase: 3 },
  { key: 'slips', name: 'Slips', desc: 'Mistakes clustered by root cause', phase: 3 },
  { key: 'duel', name: 'Duel', desc: 'Shared code, frozen question set', phase: 4 },
  { key: 'map', name: 'Map', desc: 'Concept graph with mastery heat', phase: 4 },
] as const;

export default function Home() {
  return (
    <main className="wrap">
      <p className="eyebrow">Phase 0 · foundations</p>
      <h1 style={{ fontSize: '2.5rem', letterSpacing: '0.14em', margin: '0 0 var(--s4)' }}>
        GRASP<span style={{ color: 'var(--cobalt)' }}>.</span>
      </h1>
      <p style={{ fontSize: '1.15rem', color: 'var(--ink-2)', maxWidth: '34ch', margin: 0 }}>
        One learner model, many surfaces.
      </p>

      <div className="card" style={{ marginTop: 'var(--s7)' }}>
        <p className="eyebrow">Content scope</p>
        <p className="mono" style={{ margin: 0, fontSize: '1.05rem' }}>
          {env.scope.board} · Class {env.scope.grade} · {env.scope.subject}
        </p>
        <p className="muted" style={{ margin: 'var(--s2) 0 0', fontSize: '0.9rem' }}>
          Narrow by design — it&apos;s the mechanism that makes retrieval good enough to be
          useful, not a limitation of the prototype.
        </p>
      </div>

      <h2 style={{ fontSize: '1.4rem', marginTop: 'var(--s7)' }}>Surfaces</h2>
      <table>
        <thead>
          <tr>
            <th>Surface</th>
            <th>What it is</th>
            <th>Phase</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {SURFACES.map((s) => {
            const on = flags[s.key];
            return (
              <tr key={s.key}>
                <td>{s.name}</td>
                <td>{s.desc}</td>
                <td className="mono">{s.phase}</td>
                <td>
                  <span className={on ? 'pill pill-info' : 'pill pill-warn'}>
                    {on ? 'flag on' : 'not built'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={{ fontSize: '1.4rem', marginTop: 'var(--s7)' }}>Phase 0 gate</h2>
      <p style={{ color: 'var(--ink-2)' }}>
        The spine exists and is observable. Verify it on the{' '}
        <a href="/debug/gateway">gateway debug page</a> — it runs a schema-constrained task, then
        deliberately breaks the primary provider to prove failover actually works.
      </p>
      <p className="muted" style={{ fontSize: '0.9rem' }}>
        Not yet configured? Run <code>pnpm setup:check</code>, then see{' '}
        <code>docs/08-setup.md</code>.
      </p>
    </main>
  );
}
