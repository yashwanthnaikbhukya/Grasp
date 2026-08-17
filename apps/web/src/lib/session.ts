import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ensureLearnerRecord, forUser, getAuth, type UserScope } from '@grasp/core';
import type { LearnerProfile } from '@grasp/schema';

/**
 * Server-side session access.
 *
 * `requireUser()` is the only sanctioned way a route or page gets a user id, and
 * it hands back a `UserScope` rather than a bare id — so the natural thing to
 * reach for is already scoped, and writing an unscoped query takes deliberate
 * effort. See packages/core/src/auth/scope.ts.
 */

export interface Session {
  userId: string;
  email: string;
  name: string;
  profile: LearnerProfile;
  onboarded: boolean;
  /** Everything this learner owns, pre-scoped. */
  scope: UserScope;
}

export async function getSession(): Promise<Session | null> {
  const raw = await getAuth().api.getSession({ headers: await headers() });
  if (!raw?.user) return null;

  const learner = await ensureLearnerRecord(raw.user.id, raw.user.email, raw.user.name ?? '');
  const profile = (learner as { profile?: LearnerProfile }).profile;

  return {
    userId: String((learner as { _id?: unknown })._id ?? raw.user.id),
    email: raw.user.email,
    name: raw.user.name ?? '',
    profile: profile as LearnerProfile,
    // A profile with no subjects has not been through onboarding, whatever the
    // auth record says — derived, so the two can't drift.
    onboarded: Boolean(profile?.subjects?.length),
    scope: forUser(String((learner as { _id?: unknown })._id ?? raw.user.id)),
  };
}

/** Redirects to sign-in when absent. Use in pages and route handlers alike. */
export async function requireUser(next?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  }
  return session;
}

/** Requires a finished profile too — for surfaces that need learner context. */
export async function requireOnboarded(next?: string): Promise<Session> {
  const session = await requireUser(next);
  if (!session.onboarded) redirect('/onboarding');
  return session;
}
