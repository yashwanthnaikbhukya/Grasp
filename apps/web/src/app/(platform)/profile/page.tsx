import type { Metadata } from 'next';
import Link from 'next/link';
import { collections } from '@grasp/core';
import { stageLabel } from '@grasp/schema';
import { ThemeSwitch } from '@/components/shell/theme';
import { goalLabel, initials, languageName, regionName, subjectLabel } from '@/lib/labels';
import { requireOnboarded } from '@/lib/session';
import { SignOutButton } from './sign-out';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Profile & settings' };

/**
 * Profile & settings — who Grasp thinks you are, in your words, and the few
 * controls that are yours: what you're studying (via onboarding), appearance,
 * and your account. No stored codes on screen (docs/11-experience.md §2).
 */
export default async function Profile() {
  const session = await requireOnboarded('/profile');
  const { profile } = session;

  const curricula = profile.curriculumIds.length
    ? await collections
        .curricula()
        .find({ _id: { $in: profile.curriculumIds } } as never, { projection: { name: 1 } })
        .toArray()
    : [];

  const examIn = profile.goal.examDate
    ? Math.ceil((new Date(profile.goal.examDate).getTime() - Date.now()) / 86_400_000)
    : null;

  const rows: [string, string][] = [
    ['Country', regionName(profile.region)],
    ['Year', profile.stage !== null ? stageLabel(profile.stage, profile.region) : 'Not in formal education'],
    ['Age', profile.age !== null ? String(profile.age) : 'Not set'],
    ['Studying', curricula.map((c) => String((c as { name?: unknown }).name)).join(', ') || 'Self-study'],
    ['Subjects', profile.subjects.map(subjectLabel).join(', ') || 'Not set'],
    ['Goal', goalLabel(profile.goal) + (examIn !== null && examIn >= 0 ? ` · in ${examIn} days` : '')],
    ['Daily time', `${profile.minutesPerDay} minutes`],
    [
      'Explanations in',
      languageName(profile.language.instruction) +
        (profile.language.codeSwitch ? `, mixed with ${languageName(profile.language.codeSwitch)}` : ''),
    ],
  ];

  return (
    <main className="page page-narrow">
      <header className="profile-head">
        <span className="avatar avatar-lg" aria-hidden="true">
          {initials(session.name, session.email)}
        </span>
        <div>
          <h1 className="page-title">{session.name || 'Your profile'}</h1>
          <p className="page-sub">{session.email}</p>
        </div>
      </header>

      <section className="settings-card" aria-labelledby="about-title">
        <div className="settings-head">
          <div>
            <h2 id="about-title">About you</h2>
            <p className="muted">This is how the tutor pitches explanations and how Reps picks your practice.</p>
          </div>
          <Link href="/onboarding" className="btn btn-ghost btn-sm">
            Edit answers
          </Link>
        </div>
        <dl className="kv">
          {rows.map(([k, v]) => (
            <div key={k} className="kv-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="settings-card" aria-labelledby="appearance-title">
        <div className="settings-head">
          <div>
            <h2 id="appearance-title">Appearance</h2>
            <p className="muted">System follows your device. Saved on this browser.</p>
          </div>
          <ThemeSwitch name="profile-theme" />
        </div>
      </section>

      <section className="settings-card" aria-labelledby="account-title">
        <div className="settings-head">
          <div>
            <h2 id="account-title">Account</h2>
            <p className="muted">Signed in as {session.email}</p>
          </div>
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
