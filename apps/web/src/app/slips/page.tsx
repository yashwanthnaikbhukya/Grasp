import { requireOnboarded } from '@/lib/session';
import { SlipsView } from './view';

export const dynamic = 'force-dynamic';

/**
 * Slips — every mistake clustered by *why*, not by topic.
 *
 * The most differentiated surface in the product and nearly free to build: the
 * evidence already exists once Reps is running. See docs/01-product.md.
 */
export default async function SlipsPage() {
  await requireOnboarded('/slips');
  return <SlipsView />;
}
