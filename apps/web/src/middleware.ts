import { NextResponse } from 'next/server';

/**
 * /debug does not exist in production — enforced here, before anything renders.
 *
 * `notFound()` in app/debug/layout.tsx was not enough: the App Router renders a
 * layout and its page in parallel, so the 404 went out while
 * /debug/gateway still made its two live model calls, for anyone, signed in or
 * not (2026-11-09 test pass). The layout guard stays as a second line.
 */
export function middleware() {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  return new NextResponse('Not found', { status: 404 });
}

export const config = { matcher: ['/debug', '/debug/:path*'] };
