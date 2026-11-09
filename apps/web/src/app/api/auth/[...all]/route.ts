import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@grasp/core';

/**
 * Better Auth's own endpoints: sign-up, sign-in, sign-out, session, etc.
 *
 * The handler is built on the first request, never at import. Next evaluates
 * route modules while collecting page data, and `getAuth()` needs MONGODB_URI
 * and AUTH_SECRET — calling it at module level made `next build` fail wherever
 * those are not set (CI). Found by building without the env file, 2026-11-09.
 */
export const dynamic = 'force-dynamic';

let handler: ReturnType<typeof toNextJsHandler> | undefined;
const auth = () => (handler ??= toNextJsHandler(getAuth()));

export const GET = (req: Request) => auth().GET(req);
export const POST = (req: Request) => auth().POST(req);
