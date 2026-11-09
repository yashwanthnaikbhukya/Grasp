import { NextResponse } from 'next/server';
import { loadMap } from '@/lib/data/map';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The concept graph, rendered with this learner's mastery on it.
 *
 * This is where the invisible personalization becomes legible: the same graph
 * every learner shares, coloured by what *this* one actually holds.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  return NextResponse.json(await loadMap(session));
}
