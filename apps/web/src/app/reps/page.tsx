import { requireOnboarded } from '@/lib/session';
import { RepsFeed } from './feed';

export const dynamic = 'force-dynamic';

/**
 * Reps — the practice feed.
 *
 * Looks like the least sophisticated surface and is the most important one: every
 * swipe is a labelled observation of ability, which is what the entire learner
 * model is built from. See docs/01-product.md#why-reps-is-the-centrepiece.
 */
export default async function RepsPage() {
  const session = await requireOnboarded('/reps');
  return <RepsFeed learnerName={session.name} />;
}
