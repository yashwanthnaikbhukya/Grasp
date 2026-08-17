import { NextResponse } from 'next/server';
import { LearnerProfileSchema } from '@grasp/schema';
import { updateLearnerProfile } from '@grasp/core';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Save the learner profile from onboarding.
 *
 * Partial by design — onboarding is progressive and skippable, so this merges
 * whatever it is given over what is already stored. See docs/10-onboarding.md.
 * The merge itself lives in @grasp/core; this handler only authenticates and
 * validates.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'expected JSON' }, { status: 400 });
  }

  const parsed = LearnerProfileSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'that profile is not valid',
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join('.') || '(root)',
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const profile = await updateLearnerProfile(session.userId, parsed.data);
  return NextResponse.json({ ok: true, profile });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  return NextResponse.json({ profile: session.profile, onboarded: session.onboarded });
}
