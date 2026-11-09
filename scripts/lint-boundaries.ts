/**
 * `pnpm lint:boundaries`
 *
 * The hard rules in CLAUDE.md that a generic linter can't express, enforced
 * instead of remembered. Runs in CI next to `biome lint`.
 *
 *   1. No model call outside the gateway — provider hosts and SDKs appear only
 *      under packages/core/src/llm/ (and env defaults).
 *   2. Dependency arrows never reverse — core/schema/prompts never import the app.
 *   3. Never a field named `grade` in a schema (rule 10: store `stage`).
 *
 * Plain text scanning, deliberately: fast, no config, and a false positive is
 * fixed by moving code to where it belongs, which is the point.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...walk(join(root, 'apps')), ...walk(join(root, 'packages')), ...walk(join(root, 'scripts'))];
const rel = (p: string) => relative(root, p).split(sep).join('/');

interface Violation {
  rule: string;
  file: string;
  line: number;
  text: string;
}
const violations: Violation[] = [];

const PROVIDER =
  /(generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai\/api|api\.openai\.com|api\.anthropic\.com|from ['"](openai|groq-sdk|@google\/generative-ai|@google\/genai|@anthropic-ai\/sdk)['"])/;
const MAY_TALK_TO_PROVIDERS = (f: string) =>
  f.startsWith('packages/core/src/llm/') ||
  f === 'packages/core/src/env.ts' ||
  f === 'scripts/models-check.ts' || // lists what a key can access — setup tooling, not a model call
  f === 'scripts/lint-boundaries.ts';

const IMPORTS_APP = /from ['"](@grasp\/web|\.\.\/.*apps\/web)/;
const GRADE_FIELD = /^\s*grade\s*[:?]/;

for (const file of files) {
  const f = rel(file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((text, i) => {
    if (PROVIDER.test(text) && !MAY_TALK_TO_PROVIDERS(f)) {
      violations.push({ rule: 'rule 1 — model call outside the gateway', file: f, line: i + 1, text });
    }
    if (f.startsWith('packages/') && IMPORTS_APP.test(text)) {
      violations.push({ rule: 'boundary — a package imports the app', file: f, line: i + 1, text });
    }
    if (f.startsWith('packages/schema/src/') && GRADE_FIELD.test(text)) {
      violations.push({ rule: 'rule 10 — a field named `grade`', file: f, line: i + 1, text });
    }
  });
}

console.log(`\n${BOLD}Boundary check${OFF} ${DIM}${files.length} files${OFF}\n`);
if (violations.length === 0) {
  console.log(`  ${GREEN}✓${OFF} no model calls outside the gateway`);
  console.log(`  ${GREEN}✓${OFF} no package imports the app`);
  console.log(`  ${GREEN}✓${OFF} no \`grade\` field in a schema\n`);
  process.exit(0);
}
for (const v of violations) {
  console.log(`  ${RED}✗${OFF} ${v.file}:${v.line} ${DIM}${v.rule}${OFF}\n      ${v.text.trim().slice(0, 120)}`);
}
console.log(`\n${RED}${violations.length} violation(s).${OFF} See CLAUDE.md — Hard rules.\n`);
process.exit(1);
