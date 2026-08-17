import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@grasp/core';

/**
 * Better Auth's own endpoints: sign-up, sign-in, sign-out, session, etc.
 *
 * `getAuth()` is lazy so importing this route never opens a Mongo connection at
 * build time — Next evaluates route modules while collecting page data.
 */
export const dynamic = 'force-dynamic';

const handler = toNextJsHandler(getAuth());

export const GET = handler.GET;
export const POST = handler.POST;
