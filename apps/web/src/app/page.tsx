import { env, flags } from '@grasp/core';
import { stageLabel } from '@grasp/schema';

export const dynamic = 'force-dynamic';

const SURFACES = [
  { key: 'ask', name: 'Ask', desc: 'Socratic tutor grounded in your syllabus', phase: 1 },
  { key: 'reps', name: 'Reps', desc: 'Bite-size practice, scheduled by mastery', phase: 2 },
  { key: 'snap', name: 'Snap', desc: 'Photo of a doubt → guided walkthrough', phase: 3 },
  { key: 'slips', name: 'Slips', desc: 'Mistakes clustered by root cause', phase: 3 },
  { key: 'duel', name: 'Duel', desc: 'Shared code, frozen question set', phase: 4 },
  { key: 'map', name: 'Map', desc: 'Concept graph with mastery heat', phase: 4 },
] as const;

/** The same stage, as a learner in each place would recognise it. */
const LADDER_DEMO = ['IN', 'US', 'GB', 'NG', 'BR', 'ID', 'SG'] as const;

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

      <div className="card card-hover" style={{ marginTop: 'var(--s7)' }}>
        <p className="eyebrow">Scope belongs to the learner</p>
        <p style={{ margin: '0 0 var(--s4)', color: 'var(--ink-2)' }}>
          There is no deployment-wide curriculum. Region, stage, curriculum, and language are
          discovered at onboarding and live on the learner — so students on different continents
          work in the same instance.
        </p>
        <p className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>
          Stage 10, as each region names it
        </p>
        <p className="row" style={{ margin: 0, gap: 'var(--s2)' }}>
          {LADDER_DEMO.map((r) => (
            <span key={r} className="pill pill-info">
              {r} · {stageLabel(10, r)}
            </span>
          ))}
        </p>
        <p className="muted" style={{ margin: 'var(--s4) 0 0', fontSize: '0.9rem' }}>
          All the same age band, all the same normalized <code>stage</code>. Note{' '}
          <strong>Year 11</strong> for the UK, not Year 10 — the off-by-one that makes any field
          named <code>grade</code> a bug waiting for its second country.
        </p>
      </div>

      <div className="card card-hover">
        <p className="eyebrow">First corpus to ingest</p>
        <p className="mono" style={{ margin: 0, fontSize: '1.05rem' }}>
          {env.seed.curriculumId} · {env.seed.subject}
        </p>
        <p className="muted" style={{ margin: 'var(--s2) 0 0', fontSize: '0.9rem' }}>
          An ingestion setting only — it has no effect on what a learner can be. Retrieval quality
          is a function of corpus coherence, so the first corpus is narrow while the schema is
          global.
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
        Not yet configured? Run <code>pnpm setup:check</code>, then see <code>docs/08-setup.md</code>
        .
      </p>
    </main>
  );
}
