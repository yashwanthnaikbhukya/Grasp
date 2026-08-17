import { stageLabel } from '@grasp/schema';
import { collections } from '@grasp/core';
import { requireOnboarded } from '@/lib/session';
import { SignOutButton } from './sign-out';

export const dynamic = 'force-dynamic';

/**
 * The signed-in home.
 *
 * Everything below is read through `session.scope` — the user-scoped accessors
 * from packages/core/src/auth/scope.ts. A query without an owner filter cannot
 * be expressed here.
 */
export default async function AppHome() {
  const session = await requireOnboarded('/app');
  const { profile, scope } = session;

  // All learner-owned reads. Each is automatically filtered to this user.
  const [sessionCount, attemptCount, masteryCount, eventCount] = await Promise.all([
    scope.chatSessions().countDocuments(),
    scope.attempts().countDocuments(),
    scope.mastery().countDocuments(),
    scope.events().countDocuments(),
  ]);

  const curricula = profile.curriculumIds.length
    ? await collections
        .curricula()
        .find({ _id: { $in: profile.curriculumIds } } as never, { projection: { name: 1 } })
        .toArray()
    : [];

  const daysToExam = profile.goal.examDate
    ? Math.ceil((new Date(profile.goal.examDate).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <main className="wrap">
      <div className="stagger" style={{ display: 'grid' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p className="eyebrow">Signed in</p>
          <h1 style={{ fontSize: '1.9rem', margin: '0 0 var(--s2)' }}>
            {session.name || session.email}
          </h1>
        </div>
        <SignOutButton />
      </div>

      <div className="card card-hover">
        <p className="eyebrow">Your learner profile</p>
        <table>
          <tbody>
            <tr>
              <td>Where</td>
              <td className="mono">{profile.region}</td>
            </tr>
            <tr>
              <td>Stage</td>
              <td>
                {profile.stage !== null ? (
                  <>
                    <span className="mono">{stageLabel(profile.stage, profile.region)}</span>{' '}
                    <span className="muted">
                      (stored as stage {profile.stage} — labelled per region)
                    </span>
                  </>
                ) : (
                  <span className="muted">not in formal education</span>
                )}
              </td>
            </tr>
            <tr>
              <td>Age</td>
              <td className="mono">{profile.age ?? '—'}</td>
            </tr>
            <tr>
              <td>Curricula</td>
              <td>
                {curricula.length
                  ? curricula.map((c) => String((c as { name?: unknown }).name)).join(' · ')
                  : 'Self-study'}
              </td>
            </tr>
            <tr>
              <td>Subjects</td>
              <td>{profile.subjects.join(', ') || '—'}</td>
            </tr>
            <tr>
              <td>Goal</td>
              <td>
                {profile.goal.label || profile.goal.kind}
                {daysToExam !== null && (
                  <span className="muted"> · {daysToExam} days away</span>
                )}
              </td>
            </tr>
            <tr>
              <td>Language</td>
              <td className="mono">
                {profile.language.instruction}
                {profile.language.codeSwitch ? ` + ${profile.language.codeSwitch}` : ''}
              </td>
            </tr>
            <tr>
              <td>Study time</td>
              <td className="mono">{profile.minutesPerDay} min/day</td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: 'var(--s4)', marginBottom: 0 }}>
          <a href="/onboarding">Change any of this</a>
        </p>
      </div>

      <div className="card card-hover">
        <p className="eyebrow">Your data</p>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
          Read through user-scoped accessors — a query without your id cannot be written.
        </p>
        <table>
          <tbody>
            <tr><td>Chat sessions</td><td className="mono">{sessionCount}</td></tr>
            <tr><td>Attempts</td><td className="mono">{attemptCount}</td></tr>
            <tr><td>Concepts with mastery</td><td className="mono">{masteryCount}</td></tr>
            <tr><td>Events recorded</td><td className="mono">{eventCount}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card card-hover">
        <p className="eyebrow">Surfaces</p>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          Auth and onboarding are done. <strong>Ask</strong> is next — retrieval, the context
          broker, and streaming chat. Everything after that reads the profile above.
        </p>
        <p className="row" style={{ gap: 'var(--s2)', margin: 0 }}>
          {['Ask', 'Reps', 'Snap', 'Duel', 'Map', 'Slips'].map((s) => (
            <span key={s} className="pill pill-warn">{s} — not built</span>
          ))}
        </p>
      </div>
      </div>
    </main>
  );
}
