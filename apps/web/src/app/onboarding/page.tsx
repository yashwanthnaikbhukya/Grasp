import { collections } from '@grasp/core';
import { stageOptions, type Curriculum } from '@grasp/schema';
import { requireUser } from '@/lib/session';
import { OnboardingFlow } from './flow';

export const dynamic = 'force-dynamic';

/**
 * Onboarding — Phase 1 deliverable 1.0. Spec: docs/10-onboarding.md.
 *
 * Built before chat because the learner card is empty until it exists.
 * Progressive and skippable: three screens capture enough to start, and nothing
 * blocks on completeness.
 */
export default async function OnboardingPage() {
  const session = await requireUser('/onboarding');

  // Every active curriculum, sent once. A few dozen rows — filtering client-side
  // as the learner picks a region beats a round trip per keystroke.
  const curricula = (await collections
    .curricula()
    .find({ active: true }, { projection: { _id: 1, name: 1, authority: 1, regions: 1, subject: 1, stageRange: 1 } })
    .toArray()) as unknown as Curriculum[];

  return (
    <OnboardingFlow
      name={session.name}
      initial={session.profile}
      curricula={curricula.map((c) => ({
        id: String(c._id),
        name: c.name,
        authority: c.authority,
        regions: c.regions,
        subject: c.subject,
        stageMin: c.stageRange.min,
        stageMax: c.stageRange.max,
      }))}
      stageLadders={Object.fromEntries(
        ['IN', 'US', 'GB', 'AU', 'SG', 'NG', 'GH', 'ZA', 'KE', 'BR', 'MX', 'ID', 'PH', 'VN', 'PK', 'BD', 'EG', 'AE', 'CA', 'DE', 'FR', 'JP', 'MY', 'NZ', 'IE', 'XX'].map(
          (r) => [r, stageOptions(r)],
        ),
      )}
    />
  );
}
