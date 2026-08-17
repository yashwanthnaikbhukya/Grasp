/**
 * Env loading for standalone scripts.
 *
 * Next.js loads `.env.local` automatically; `tsx` does not. Import this first in
 * every script, or you get the confusing failure mode of a script reporting a
 * value as unset while the app sees it fine.
 *
 * Precedence matches Next.js: `.env.local` wins over `.env`.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const file of ['.env.local', '.env']) {
  const path = join(repoRoot, file);
  if (existsSync(path)) config({ path, override: false, quiet: true });
}

/**
 * True when a value is still the placeholder shipped in `.env.example`.
 *
 * Without this, `setup:check` cheerfully reports a copied-but-unedited
 * `.env.local` as configured, and the first real failure lands somewhere far
 * less obvious.
 */
export function isPlaceholder(value: string): boolean {
  if (!value.trim()) return true;
  return /\b(USER:PASSWORD|CLUSTER\.xxxxx|xxxxx\.mongodb|YOUR_|CHANGEME|<password>|paste)\b/i.test(
    value,
  );
}
