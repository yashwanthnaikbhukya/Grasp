import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load the env from the REPO ROOT, not from apps/web.
 *
 * Next only reads `.env*` files sitting beside the app it's running. In a
 * monorepo that means the app silently runs on schema defaults while
 * `pnpm setup:check` — which reads the root file — reports everything as fine.
 * One env file for scripts and app both; this closes the gap.
 *
 * `override: false` keeps a real shell env var winning over the file, which is
 * what CI and Vercel need.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const file of ['.env.local', '.env']) {
  const path = join(repoRoot, file);
  if (existsSync(path)) config({ path, override: false, quiet: true });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source directly — no build step in the
  // monorepo. Next compiles them as part of the app.
  transpilePackages: ['@grasp/core', '@grasp/schema', '@grasp/prompts'],

  // The Mongo driver must not be bundled into the server output.
  serverExternalPackages: ['mongodb'],

  webpack: (webpackConfig, { isServer }) => {
    if (isServer) {
      // The Mongo driver lazily requires optional native deps for auth methods
      // and wire compression we don't use (Kerberos, AWS IAM auth, Snappy…).
      // Webpack still traces the require sites and warns on every build.
      //
      // Left alone this is a permanent warning, which is worse than it looks: a
      // build that always warns trains you to stop reading warnings.
      webpackConfig.externals = [
        ...(webpackConfig.externals ?? []),
        'aws4',
        'kerberos',
        'snappy',
        'socks',
        '@mongodb-js/zstd',
        'mongodb-client-encryption',
        'gcp-metadata',
      ];
    }
    return webpackConfig;
  },
};

export default nextConfig;
