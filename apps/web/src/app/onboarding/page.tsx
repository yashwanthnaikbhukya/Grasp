import { collections } from '@grasp/core';
import type { Curriculum } from '@grasp/schema';
import { COUNTRY_CODES, countryName } from '@/lib/countries';
import { requireUser } from '@/lib/session';
import { OnboardingFlow, type ProgrammeOption } from './flow';

export const dynamic = 'force-dynamic';

/**
 * Onboarding — Phase 1 deliverable 1.0. Spec: docs/10-onboarding.md.
 *
 * Built before chat because the learner card is empty until it exists.
 * Progressive and skippable: every screen saves as it goes, and nothing blocks
 * on completeness.
 */
export default async function OnboardingPage() {
  const session = await requireUser('/onboarding');

  // Every active programme, sent once — about a hundred small rows. Filtering by
  // region and stage on the client beats a round trip per tap.
  const curricula = (await collections
    .curricula()
    .find(
      { active: true },
      { projection: { _id: 1, name: 1, authority: 1, regions: 1, kind: 1, subjects: 1, stageRange: 1, exam: 1 } },
    )
    .toArray()) as unknown as Curriculum[];

  const programmes: ProgrammeOption[] = curricula.map((c) => ({
    id: String(c._id),
    name: c.name,
    authority: c.authority,
    regions: c.regions,
    kind: c.kind ?? 'school',
    subjects: c.subjects ?? [],
    stageMin: c.stageRange.min,
    stageMax: c.stageRange.max,
    exam: c.exam?.name ?? null,
  }));

  // Named here, once: the server's and the browser's ICU data disagree on a few
  // names ("Falkland Islands (Islas Malvinas)"), and computing them on both sides
  // broke hydration.
  const countries = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }))
    .filter((c) => c.name !== c.code)
    .sort((a, b) => a.name.localeCompare(b.name));

  return <OnboardingFlow name={session.name} initial={session.profile} programmes={programmes} countries={countries} />;
}
