import { NextResponse } from 'next/server';
import { FeedQuerySchema } from '@grasp/schema';
import { loadFeed } from '@/lib/data/feed';
import { badRequest } from '@/lib/http';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The Reps feed.
 *
 * **No model call on this path.** Cards are pre-generated and verified offline;
 * this only selects and orders them. If a swipe ever waits on a model, that is a
 * bug — see CLAUDE.md rule 5.
 *
 * Answers are deliberately withheld: the client receives options but never which
 * one is correct, so a learner reading the network tab cannot cheat and, more
 * usefully, grading stays server-side where the attempt can be recorded honestly.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const query = FeedQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return badRequest(query.error);
  return NextResponse.json(await loadFeed(session, query.data));
}
