import { FEATURES, FeatureBadge } from '@/components/brand/features';
import { GraspLogo, GraspMark } from '@/components/brand/logo';

/**
 * The brand sheet — every form of the logo and every feature badge, at the sizes
 * they are used, side by side in a light and a dark panel. For reviewing the
 * identity in one place. Developer-only (debug/layout.tsx 404s in production).
 */

function Panel({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <section data-theme={theme} className="brand-panel">
      <p className="eyebrow">{theme}</p>

      <div className="brand-row">
        <GraspLogo size={44} />
        <GraspLogo size={28} />
        <GraspLogo size={20} />
      </div>

      <div className="brand-row">
        {[96, 64, 40, 24, 16].map((s) => (
          <GraspMark key={s} size={s} title={`Grasp mark, ${s}px`} />
        ))}
        <span className="brand-sep" />
        {[96, 48, 32, 16].map((s) => (
          <GraspMark key={`t${s}`} size={s} variant="tile" title={`App icon, ${s}px`} />
        ))}
        <span className="brand-sep" />
        <span style={{ color: 'var(--ink-2)' }}>
          <GraspMark size={40} variant="mono" title="Single-color mark" />
        </span>
      </div>

      <div className="brand-features">
        {FEATURES.map((f) => (
          <div key={f.id} className="brand-feature">
            <FeatureBadge id={f.id} size={48} />
            <div>
              <strong>{f.name}</strong>
              <p className="muted">{f.line}</p>
            </div>
            <span className="brand-nav-sample" style={{ color: `var(${f.color})` }}>
              <f.Icon size={22} />
            </span>
            <span className="brand-nav-sample">
              <f.Icon size={22} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function BrandPage() {
  return (
    <main className="wrap">
      <p className="eyebrow">Developer · brand</p>
      <h1 style={{ fontSize: '1.8rem' }}>The Grasp identity</h1>
      <p className="muted" style={{ maxWidth: '60ch' }}>
        A rounded <strong>G</strong> drawn as one open stroke — a hand closing around an idea. The
        crossbar holds the idea (the warm node); the open end is an edge in a graph, the learner
        model underneath every feature. Each feature icon carries the same node.
      </p>
      <div className="brand-grid">
        <Panel theme="light" />
        <Panel theme="dark" />
      </div>
    </main>
  );
}
