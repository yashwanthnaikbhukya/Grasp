import { requireOnboarded } from '@/lib/session';
import { MapView } from './view';

export const dynamic = 'force-dynamic';

/**
 * Map — the concept graph with mastery heat.
 *
 * Makes the invisible personalization legible, which matters more for trust than
 * it sounds: a learner who can see *why* the system chose today's practice will
 * believe the next choice too.
 */
export default async function MapPage() {
  await requireOnboarded('/map');
  return <MapView />;
}
