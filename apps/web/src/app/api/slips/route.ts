import { NextResponse } from 'next/server';
import { loadSlips } from '@/lib/data/slips';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The mistake notebook — see lib/data/slips.ts.
 *
 * Low-confidence labels are stored but withheld from the learner-facing view —
 * a guess presented as a diagnosis is worse than saying nothing, and it is the
 * fastest way to lose trust in the whole feature.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  return NextResponse.json(await loadSlips(session));
}
