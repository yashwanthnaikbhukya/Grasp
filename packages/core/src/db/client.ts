import { MongoClient, type Db } from 'mongodb';
import { env, requireEnv } from '../env';

/**
 * One client per process, reused across hot reloads in dev.
 *
 * Next.js dev recreates modules on every change; without the global cache you
 * leak a connection pool per edit and Atlas M0's connection cap is low enough
 * that you will notice.
 */

declare global {
  // eslint-disable-next-line no-var
  var __graspMongo: { client: MongoClient; db: Db } | undefined;
}

export function getMongo(): { client: MongoClient; db: Db } {
  if (globalThis.__graspMongo) return globalThis.__graspMongo;

  const uri = requireEnv(env.mongo.uri, 'MONGODB_URI', 'any database access');
  const client = new MongoClient(uri, {
    // M0 connection cap is low; keep the pool small and let it idle out.
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8_000,
    retryWrites: true,
  });

  const handle = { client, db: client.db(env.mongo.db) };
  globalThis.__graspMongo = handle;
  return handle;
}

export function db(): Db {
  return getMongo().db;
}

export async function pingMongo(): Promise<{ ok: true; ms: number }> {
  const started = Date.now();
  await db().command({ ping: 1 });
  return { ok: true, ms: Date.now() - started };
}

export async function closeMongo(): Promise<void> {
  const handle = globalThis.__graspMongo;
  if (!handle) return;
  globalThis.__graspMongo = undefined;
  await handle.client.close();
}
