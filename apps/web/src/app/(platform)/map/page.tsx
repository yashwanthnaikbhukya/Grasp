import type { Metadata } from 'next';
import { loadMap } from '@/lib/data/map';
import { requireOnboarded } from '@/lib/session';
import { MapView } from './view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Map' };

/**
 * Map — the concept graph with mastery heat.
 *
 * Makes the invisible personalization legible, which matters more for trust than
 * it sounds: a learner who can see *why* the system chose today's practice will
 * believe the next choice too. Rendered with its data — no second round trip.
 */
export default async function MapPage() {
  const session = await requireOnboarded('/map');
  return <MapView initial={await loadMap(session)} />;
}
