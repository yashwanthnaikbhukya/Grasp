import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { LearnerProfileSchema, stageFromAge, type LearnerProfile } from '@grasp/schema';
import { db } from '../db/client';
import { env, requireEnv } from '../env';

/**
 * Authentication.
 *
 * Email + password for now — magic links need Resend, which is Phase 1's email
 * step. Better Auth handles the parts that are genuinely dangerous to hand-roll:
 * password hashing, session rotation, cookie flags, CSRF.
 *
 * Better Auth owns `user`, `session`, `account`, and `verification`; Grasp's own
 * `users` collection carries the learner profile, keyed by the auth user id. Two
 * collections rather than one so an auth upgrade can never migrate learner data.
 */

/**
 * Built lazily and cached. The config's exact generic type carries the
 * `additionalFields` shape, so it is inferred from this function rather than
 * annotated — annotating it as the base `Auth` type erases those fields.
 */
function build() {
  requireEnv(env.mongo.uri, 'MONGODB_URI', 'authentication');
  const secret = requireEnv(
    process.env.AUTH_SECRET ?? '',
    'AUTH_SECRET',
    'signing session cookies — generate one with: openssl rand -base64 32',
  );

  return betterAuth({
    database: mongodbAdapter(db()),
    secret,
    baseURL: env.appUrl,

    emailAndPassword: {
      enabled: true,
      // Verification needs an email provider; until Resend is wired, requiring it
      // would lock every account out. Turned on in Phase 1's email step.
      requireEmailVerification: false,
      minPasswordLength: 8,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },

    advanced: {
      // Same-site by default; the app and API share an origin.
      useSecureCookies: env.nodeEnv === 'production',
    },

    user: {
      additionalFields: {
        /** Mirrors onboarding completion so the UI can route without a second read. */
        onboarded: { type: 'boolean', defaultValue: false, input: false },
      },
    },
  });
}

let instance: ReturnType<typeof build> | null = null;

export function getAuth(): ReturnType<typeof build> {
  instance ??= build();
  return instance;
}

/**
 * The learner profile document, created lazily on first authenticated request.
 *
 * Deliberately not a signup hook: a learner who registers and abandons before
 * onboarding should not leave a half-built profile behind, and creating it on
 * first use keeps registration fast and failure-free.
 */
export async function ensureLearnerRecord(rawAuthId: unknown, email: string, name: string) {
  const { ObjectId } = await import('mongodb');
  const { collections } = await import('../db/collections');

  /**
   * Coerce the auth id to a string at the boundary.
   *
   * Better Auth's Mongo adapter hands back `user.id` as an **ObjectId**, not a
   * hex string, so a lookup on the stored string field silently matched nothing
   * and every request tried to create the learner record again — surfacing as a
   * duplicate-key error on `email` rather than anything resembling the cause.
   *
   * The project stores ids as strings everywhere (see auth/scope.ts), so the
   * conversion belongs here, once, rather than at each call site. This is the
   * fourth time a string/ObjectId mismatch has cost real debugging time; the
   * rule is that a foreign id is normalised the moment it crosses into Grasp.
   */
  const { toIdString } = await import('../db/oid');
  const authUserId = toIdString(rawAuthId);
  if (!authUserId) throw new Error('ensureLearnerRecord called without a usable auth id');

  const existing = await collections.users().findOne({ authId: authUserId } as never);
  if (existing) return existing;

  const doc = {
    _id: new ObjectId(authUserId.length === 24 ? authUserId : undefined),
    authId: authUserId,
    email,
    name,
    profile: LearnerProfileSchema.parse({}),
    streak: { current: 0, longest: 0, lastActiveDate: null },
    xp: 0,
    placementDoneAt: null,
    createdAt: new Date(),
  };

  try {
    await collections.users().insertOne(doc as never);
    return doc;
  } catch (e) {
    /**
     * Lost the race.
     *
     * The first authenticated page load fans out into several concurrent
     * requests — the page, its data routes — and each one calls this. All of
     * them find no record and all of them insert. The unique index on `email`
     * catches it, which is the index doing its job; the caller just needs the
     * winner's document rather than an error.
     */
    if (isDuplicateKey(e)) {
      const winner = await collections.users().findOne({ authId: authUserId } as never);
      if (winner) return winner;
    }
    throw e;
  }
}

function isDuplicateKey(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 11000
  );
}

/**
 * Merge a partial profile over the stored one.
 *
 * Lives here rather than in a route handler because `apps/web` owns no business
 * logic and must not reach for the Mongo driver — see docs/09-conventions.md.
 * Partial by design: onboarding is progressive and skippable.
 */
export async function updateLearnerProfile(
  userId: string,
  patch: Partial<LearnerProfile>,
): Promise<LearnerProfile> {
  const { ObjectId } = await import('mongodb');
  const { collections } = await import('../db/collections');

  const existing = await collections.users().findOne({ _id: new ObjectId(userId) } as never);
  const current = LearnerProfileSchema.parse(
    (existing as { profile?: unknown } | null)?.profile ?? {},
  );

  const merged = LearnerProfileSchema.parse({ ...current, ...patch });

  // A learner outside formal education has no stage; infer a band from age so
  // difficulty ranking still has something to work with.
  if (merged.stage === null && merged.age !== null && !merged.inFormalEducation) {
    merged.stage = stageFromAge(merged.age);
  }

  await collections
    .users()
    .updateOne({ _id: new ObjectId(userId) } as never, { $set: { profile: merged } });

  return merged;
}
