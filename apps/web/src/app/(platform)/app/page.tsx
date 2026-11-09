import type { Metadata } from 'next';
import Link from 'next/link';
import {
  collections,
  currentP,
  loadGraph,
  masteryFromDoc,
  RESERVE_AFTER_MS,
  ROOT_CAUSE_LABEL,
} from '@grasp/core';
import { stageLabel, type RootCause } from '@grasp/schema';
import { FEATURES, FeatureBadge } from '@/components/brand/features';
import { ArrowRightIcon } from '@/components/brand/icons';
import { conceptLabel, subjectLabel } from '@/lib/labels';
import { requireOnboarded } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Today' };

/**
 * Today — the learner's home (docs/11-experience.md — Today).
 *
 * One primary action, then the few things worth knowing right now: how today
 * is going, what to fix first, where they left off, their pattern. Each block
 * hides when it has nothing true to say. Every read goes through the learner's
 * own scope.
 */

const DAY = 86_400_000;

/** "Physics, Chemistry, Biology +2 more" — a subtitle, not a timetable. */
const subjectSummary = (subjects: string[]) =>
  subjects.length <= 3
    ? subjects.map(subjectLabel).join(', ')
    : `${subjects.slice(0, 3).map(subjectLabel).join(', ')} +${subjects.length - 3} more`;
/** Matches /api/slips: low-confidence labels are not shown to the learner. */
const MIN_SLIP_CONFIDENCE = 0.4;

export default async function Today() {
  const session = await requireOnboarded('/app');
  const { profile, scope } = session;
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [masteryRows, graph, attemptsToday, recentAttempts, lastChat, slips, bankIds, justAnswered] =
    await Promise.all([
      scope.mastery().find({}).toArray(),
      loadGraph(),
      scope.attempts().find({ ts: { $gte: startOfDay } } as never).project({ correct: 1 }).toArray(),
      scope.attempts().find({ ts: { $gte: new Date(now.getTime() - 7 * DAY) } } as never).project({ ts: 1 }).toArray(),
      scope
        .chatSessions()
        .find({ archivedAt: null, title: { $ne: 'New chat' } } as never)
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray(),
      scope.slips().find({ confidence: { $gte: MIN_SLIP_CONFIDENCE } } as never).project({ rootCause: 1 }).toArray(),
      // Ids only, so "cards ready" can subtract what was just answered in memory
      // instead of a second, dependent query (one fewer round trip — 2026-11-09).
      collections
        .questions()
        .find(
          {
            verificationStatus: 'verified',
            type: 'mcq',
            ...(profile.subjects.length > 0 ? { subject: { $in: profile.subjects } } : {}),
          } as never,
          { projection: { _id: 1 } },
        )
        .limit(2_000)
        .toArray(),
      // What the feed holds back (RESERVE_AFTER_MS) — so "cards ready" matches
      // what Reps will actually serve.
      scope
        .attempts()
        .find({ ts: { $gte: new Date(now.getTime() - RESERVE_AFTER_MS) } } as never)
        .project({ questionId: 1 })
        .toArray(),
    ]);

  const answeredIds = new Set(justAnswered.map((a) => String(a.questionId)));
  const cardsInBank = bankIds.length;
  const cardsReady = bankIds.filter((q) => !answeredIds.has(String(q._id))).length;

  const nameOf = (id: string) => conceptLabel(graph.find((c) => c._id === id)?.name ?? id);

  // --- learner state -----------------------------------------------------------
  const started = masteryRows.filter((m) => Number(m.attempts ?? 0) > 0);
  const mastered = started.filter((m) => m.state === 'mastered').length;
  const due = started.filter((m) => new Date(String(m.nextDueAt)) <= now).length;
  const weakest = started
    .map((m) => ({ id: String(m.conceptId), p: currentP(masteryFromDoc(m, now), now) }))
    .sort((a, b) => a.p - b.p)[0];

  const answeredToday = attemptsToday.length;
  const correctToday = attemptsToday.filter((a) => a.correct).length;
  const activeDays = new Set(recentAttempts.map((a) => new Date(String(a.ts)).toDateString())).size;

  const causeCounts = new Map<string, number>();
  for (const s of slips) causeCounts.set(String(s.rootCause), (causeCounts.get(String(s.rootCause)) ?? 0) + 1);
  const topCause = [...causeCounts].sort((a, b) => b[1] - a[1])[0];

  const chat = lastChat[0];
  const firstName = (session.name || '').split(' ')[0] || 'there';
  // "Welcome back" only means something to someone who has been here before.
  const returning = started.length > 0 || Boolean(chat) || recentAttempts.length > 0;
  const examIn = profile.goal.examDate
    ? Math.ceil((new Date(profile.goal.examDate).getTime() - now.getTime()) / DAY)
    : null;
  const level = profile.stage !== null ? stageLabel(profile.stage, profile.region) : 'Self-study';

  // --- the one next action ----------------------------------------------------
  const batch = Math.min(12, cardsReady);
  const next =
    cardsInBank === 0
      ? { title: 'Ask your first question', body: 'Practice cards for your subjects are on their way — the tutor is ready now.', href: '/ask', cta: 'Open Ask' }
      : cardsReady === 0
        ? { title: 'All caught up for today', body: 'You have answered every card that is ready. Ask the tutor about anything that felt shaky.', href: '/ask', cta: 'Open Ask' }
      : started.length === 0
        ? { title: 'Start your first practice', body: `${batch} short cards, about ${Math.max(2, Math.round(batch / 2))} minutes. They show Grasp where you are.`, href: '/reps', cta: 'Start practice' }
        : due > 0
          ? { title: `${due} idea${due > 1 ? 's' : ''} due for review`, body: 'A quick round now is what keeps them from fading.', href: '/reps', cta: 'Review now' }
          : { title: 'Keep the momentum', body: `${batch} cards ready — new ideas and the ones you are building.`, href: '/reps', cta: 'Continue practice' };

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Today</p>
          <h1 className="page-title">
            {returning ? 'Welcome back' : 'Welcome'}, {firstName}
          </h1>
          <p className="page-sub">
            {level} · {subjectSummary(profile.subjects)} · {profile.minutesPerDay} min a day
          </p>
          {examIn !== null && examIn >= 0 && (
            <p className="exam-chip">
              {profile.goal.label || 'Your exam'} in <strong>{examIn}</strong> day{examIn === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </header>

      <section className="hero-card" aria-labelledby="next-title">
        <FeatureBadge id={next.href === '/ask' ? 'ask' : 'reps'} size={52} />
        <div className="hero-body">
          <h2 id="next-title">{next.title}</h2>
          <p>{next.body}</p>
        </div>
        <Link href={next.href} className="btn hero-cta">
          {next.cta} <ArrowRightIcon size={18} />
        </Link>
      </section>

      <section className="stat-row" aria-label="Your progress">
        <div className="stat">
          <span className="stat-label">Today</span>
          <span className="stat-value">{answeredToday}</span>
          <span className="stat-note">
            {answeredToday === 0 ? 'cards answered' : `answered · ${Math.round((correctToday / answeredToday) * 100)}% right`}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">This week</span>
          <span className="stat-value">{activeDays}/7</span>
          <span className="stat-note">days you practiced</span>
        </div>
        <div className="stat">
          <span className="stat-label">Ideas</span>
          <span className="stat-value">
            {started.length}
            <span className="stat-of">/{graph.length}</span>
          </span>
          <span className="stat-note">{mastered > 0 ? `started · ${mastered} mastered` : 'started'}</span>
        </div>
      </section>

      <div className="tile-grid">
        {weakest && (
          <section className="tile" aria-labelledby="fix-title">
            <p className="eyebrow">Fix this first</p>
            <h2 id="fix-title" className="tile-title">{nameOf(weakest.id)}</h2>
            <div className="meter" role="img" aria-label={`${Math.round(weakest.p * 100)}% held`}>
              <span style={{ width: `${Math.max(4, Math.round(weakest.p * 100))}%` }} />
            </div>
            <p className="tile-note">{Math.round(weakest.p * 100)}% held — your weakest idea so far.</p>
            <div className="tile-actions">
              <Link href={`/reps?concept=${encodeURIComponent(weakest.id)}`} className="btn btn-sm">Practice it</Link>
              <Link href={`/ask?q=${encodeURIComponent(`Explain ${nameOf(weakest.id).toLowerCase()} to me`)}`} className="btn btn-ghost btn-sm">
                Ask about it
              </Link>
            </div>
          </section>
        )}

        {chat && (
          <section className="tile" aria-labelledby="chat-title">
            <p className="eyebrow">Pick up where you left off</p>
            <h2 id="chat-title" className="tile-title">{String(chat.title)}</h2>
            <p className="tile-note">Your last conversation with the tutor.</p>
            <div className="tile-actions">
              <Link href={`/ask?session=${String(chat._id)}`} className="btn btn-ghost btn-sm">Continue chat</Link>
            </div>
          </section>
        )}

        {topCause && (
          <section className="tile" aria-labelledby="pattern-title">
            <p className="eyebrow">Your pattern</p>
            <h2 id="pattern-title" className="tile-title">
              {ROOT_CAUSE_LABEL[topCause[0] as RootCause] ?? topCause[0]}
            </h2>
            <p className="tile-note">
              Behind {topCause[1]} of your {slips.length} classified slip{slips.length > 1 ? 's' : ''}.
            </p>
            <div className="tile-actions">
              <Link href="/slips" className="btn btn-ghost btn-sm">See your slips</Link>
            </div>
          </section>
        )}
      </div>

      <section aria-labelledby="explore-title">
        <h2 id="explore-title" className="section-title">Explore Grasp</h2>
        <div className="feature-grid">
          {FEATURES.filter((f) => f.id !== 'today').map((f) => (
            <Link key={f.id} href={f.href} className="feature-card">
              <FeatureBadge id={f.id} size={44} />
              <span>
                <strong>{f.name}</strong>
                <span className="feature-line">{f.line}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
