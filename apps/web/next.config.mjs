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

  // The Mongo driver must not be bundled into the server output — and neither
  // may anything that checks `instanceof ObjectId` against it. Better Auth's
  // Mongo adapter does exactly that when it reads a user back; bundled, it got
  // its own copy of the class, every ObjectId failed the check, and **sign-in
  // returned 500 "Invalid id value"** while sign-up (which never hits that path)
  // kept working. One module instance for all three, loaded from node_modules.
  serverExternalPackages: ['mongodb', 'better-auth', '@better-auth/mongo-adapter'],

  // Baseline response headers (the 2026-11-09 test pass found none). Grasp has
  // destructive one-click controls (delete chat, sign out), so it must never be
  // framed. A CSP is the next step and needs care: KaTeX sets inline styles and
  // the theme script runs before paint — see docs/07-phases.md, Phase H.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Microphone for Ask's dictation, on our own pages only. `microphone=()`
          // (from the 2026-11-09 security pass) silently blocked it.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=()' },
        ],
      },
    ];
  },

  // `pnpm dev` runs on Turbopack (fast compiles and refresh), which has no use
  // for this hook and warns when it is present; production builds use webpack.
  // Next sets TURBOPACK when it runs on Turbopack.
  ...(process.env.TURBOPACK ? {} : { webpack: webpackHook }),
};

/** Production builds (webpack) only — see the spread above. */
function webpackHook(webpackConfig, { isServer }) {
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
}

export default nextConfig;
