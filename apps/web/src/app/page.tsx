import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The front door.
 *
 * Signed-in learners never see it — they go straight to where they left off.
 * Everyone else gets what Grasp does and two ways in. The developer status page
 * that used to live here is at /debug (and does not exist in production).
 * Spec: docs/11-experience.md — Information architecture.
 */

const SURFACES = [
  {
    name: 'Ask',
    line: 'A tutor for any subject that asks before it tells, pitched at your level.',
  },
  {
    name: 'Reps',
    line: 'Short practice bursts, picked for what you are about to forget or have not got yet.',
  },
  {
    name: 'Map',
    line: 'Every idea and what it depends on, colored by how well you hold it.',
  },
  {
    name: 'Slips',
    line: 'Your mistakes grouped by why they happened, not by chapter.',
  },
] as const;

const STEPS = [
  ['Tell us where you are', 'Country, year and what you are studying — about a minute.'],
  ['Ask and practice', 'Every question and every answer is evidence about what you know.'],
  ['Grasp adapts', 'Explanations, practice and the map all change as you do.'],
] as const;

export default async function Landing() {
  const session = await getSession().catch(() => null);
  if (session) redirect(session.onboarded ? '/app' : '/onboarding');

  return (
    <main className="wrap" style={{ maxWidth: '58rem' }}>
      <p className="eyebrow">Grasp</p>
      <h1
        style={{
          fontSize: 'clamp(2rem, 6vw, 3.1rem)',
          lineHeight: 1.12,
          margin: '0 0 var(--s4)',
          maxWidth: '18ch',
        }}
      >
        Study help that knows what you know<span style={{ color: 'var(--cobalt)' }}>.</span>
      </h1>
      <p style={{ fontSize: '1.15rem', color: 'var(--ink-2)', maxWidth: '46ch', margin: 0 }}>
        Ask questions, practice in short bursts, and see exactly which ideas are holding you back.
        Everything you do teaches Grasp how to help you next.
      </p>

      <div className="row" style={{ marginTop: 'var(--s6)', alignItems: 'center' }}>
        <a className="btn" href="/login?mode=signup" style={{ textDecoration: 'none' }}>
          Get started
        </a>
        <a className="btn btn-ghost" href="/login" style={{ textDecoration: 'none' }}>
          Sign in
        </a>
      </div>

      <section
        aria-label="What you can do"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
          gap: 'var(--s4)',
          marginTop: 'var(--s8)',
        }}
      >
        {SURFACES.map((s) => (
          <div key={s.name} className="card" style={{ margin: 0 }}>
            <h2 style={{ fontSize: '1.15rem', margin: '0 0 var(--s2)' }}>{s.name}</h2>
            <p style={{ margin: 0, color: 'var(--ink-2)' }}>{s.line}</p>
          </div>
        ))}
      </section>

      <h2 style={{ fontSize: '1.3rem', marginTop: 'var(--s8)' }}>How it works</h2>
      <ol style={{ paddingLeft: '1.2rem', color: 'var(--ink-2)', margin: 0 }}>
        {STEPS.map(([title, line]) => (
          <li key={title} style={{ marginBottom: 'var(--s3)' }}>
            <strong style={{ color: 'var(--ink)' }}>{title}.</strong> {line}
          </li>
        ))}
      </ol>

      <p className="muted" style={{ marginTop: 'var(--s7)', fontSize: '0.9rem' }}>
        {/* Keep this true: the tutor takes any subject, but practice cards and the
            map exist only where there is material — math, so far. */}
        Early preview. Ask the tutor about any subject, from school to university. Practice
        cards and the map start with math, with more subjects on the way.
      </p>
    </main>
  );
}
