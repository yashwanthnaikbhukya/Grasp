import { configuredProviders, env, ollamaStatus, pingMongo } from '@grasp/core';

export const dynamic = 'force-dynamic';

/** Liveness + dependency check. Safe to expose — reports presence, never values. */
export async function GET() {
  const providers = configuredProviders();

  const mongo = env.mongo.uri
    ? await pingMongo().then(
        (r) => ({ configured: true, ok: true as const, ms: r.ms }),
        (e: unknown) => ({
          configured: true,
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }),
      )
    : { configured: false, ok: false as const, error: 'MONGODB_URI not set' };

  const ollama = await ollamaStatus();
  const embedModelPresent = ollama.models.some((m) => m.startsWith(env.ollama.embedModel));

  const ready = mongo.ok && providers.length > 0 && ollama.reachable && embedModelPresent;

  return Response.json(
    {
      ready,
      scope: env.scope,
      mongo,
      providers: {
        configured: providers,
        // With one provider you will hit a rate limit mid-session and stop.
        redundant: providers.length >= 2,
      },
      ollama: {
        reachable: ollama.reachable,
        embedModel: env.ollama.embedModel,
        embedModelPresent,
        embedDim: env.ollama.embedDim,
        error: ollama.error,
      },
      tracing: env.langfuse.secretKey ? 'langfuse' : 'stdout',
    },
    { status: ready ? 200 : 503 },
  );
}
