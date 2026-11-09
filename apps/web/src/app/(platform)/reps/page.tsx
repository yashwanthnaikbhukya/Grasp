import type { Metadata } from 'next';
import { ConceptId } from '@grasp/schema';
import { loadFeed } from '@/lib/data/feed';
import { requireOnboarded } from '@/lib/session';
import { RepsFeed } from './feed';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reps' };

/**
 * Reps — the practice feed.
 *
 * Looks like the least sophisticated surface and is the most important one: every
 * swipe is a labelled observation of ability, which is what the entire learner
 * model is built from. See docs/01-product.md#why-reps-is-the-centrepiece.
 *
 * The first set of cards is composed here and arrives with the page; fetching it
 * from the browser after mount cost a second round trip on every visit.
 */
export default async function RepsPage({ searchParams }: { searchParams: Promise<{ concept?: string }> }) {
  const session = await requireOnboarded('/reps');
  const { concept } = await searchParams;
  const focus = concept && ConceptId.safeParse(concept).success ? concept : undefined;
  const initial = await loadFeed(session, { count: 12, concept: focus });
  return <RepsFeed initial={initial} />;
}
