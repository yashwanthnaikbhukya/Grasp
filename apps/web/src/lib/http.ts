import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

/**
 * Shared route responses.
 *
 * Two rules: a request that fails its Zod schema gets a 400 naming the fields
 * (never a 500 deep inside a handler), and a server error is logged in full but
 * reaches the client as a fixed sentence — raw driver or provider messages leak
 * hostnames, collection names and stack shapes.
 */

export function badRequest(error: ZodError): NextResponse {
  return NextResponse.json(
    {
      error: 'invalid request',
      issues: error.issues
        .slice(0, 8)
        .map((i) => ({ path: i.path.join('.') || '(body)', message: i.message })),
    },
    { status: 400 },
  );
}

export function serverError(
  tag: string,
  e: unknown,
  status = 500,
  message = 'Something went wrong. Try again.',
): NextResponse {
  console.error(`[${tag}]`, e);
  return NextResponse.json({ error: message }, { status });
}

/** Parse a JSON body without throwing; `null` when it isn't JSON at all. */
export async function jsonBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
