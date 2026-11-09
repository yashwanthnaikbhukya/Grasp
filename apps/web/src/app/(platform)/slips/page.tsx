import type { Metadata } from 'next';
import { loadSlips } from '@/lib/data/slips';
import { requireOnboarded } from '@/lib/session';
import { SlipsView } from './view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Slips' };

/**
 * Slips — every mistake clustered by *why*, not by topic.
 *
 * The most differentiated surface in the product and nearly free to build: the
 * evidence already exists once Reps is running. See docs/01-product.md.
 * Rendered with its data — no second round trip.
 */
export default async function SlipsPage() {
  const session = await requireOnboarded('/slips');
  return <SlipsView initial={await loadSlips(session)} />;
}
