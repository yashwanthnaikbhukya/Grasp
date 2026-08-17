/**
 * `pnpm models:check`
 *
 * Asks each provider what models **your key** can actually use, and verifies the
 * ids configured in `.env.local` exist.
 *
 * Model ids churn — providers retire and rename them without much warning, and
 * the failure mode is a 404 halfway through a session. This removes the guessing:
 * run it whenever a call 404s with "model not found", or before changing a tier.
 */
import { isPlaceholder } from './load-env';
import { env } from '@grasp/core';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

interface Report {
  provider: string;
  ok: boolean;
  models: string[];
  error?: string;
  /** (env var, configured id) pairs this provider is expected to serve. */
  configured: [string, string][];
}

/**
 * Provider model lists mix in things that cannot answer a chat completion —
 * speech-to-text, text-to-speech, image and music generation, safety
 * classifiers, embedding models. Suggesting one of those as "the smallest
 * available" sends you off to debug a model that was never going to work.
 */
const NOT_CHAT =
  /whisper|tts|orpheus|prompt-guard|safeguard|embedding|-image|nano-banana|lyria|robotics|computer-use|native-audio|\blive\b|veo|imagen/i;

function chatOnly(models: string[]): string[] {
  return models.filter((m) => !NOT_CHAT.test(m));
}

/** Small-first ordering, so the cheap dev-stage options surface at the top. */
function smallFirst(models: string[]): string[] {
  const size = (m: string): number => {
    const b = /(\d+)\s*b\b/i.exec(m);
    if (b?.[1]) return Number(b[1]);
    if (/lite|mini|small|instant|flash-8/i.test(m)) return 1;
    if (/flash/i.test(m)) return 10;
    if (/pro|large|opus|ultra/i.test(m)) return 1000;
    return 100;
  };
  return [...models].sort((a, b) => size(a) - size(b) || a.localeCompare(b));
}

async function checkGemini(): Promise<Report | null> {
  const configured: [string, string][] = [
    ['GEMINI_MODEL_FAST', env.gemini.modelFast],
    ['GEMINI_MODEL_MID', env.gemini.modelMid],
    ['GEMINI_MODEL_BEST', env.gemini.modelBest],
  ];
  if (!env.gemini.apiKey || isPlaceholder(env.gemini.apiKey)) return null;

  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': env.gemini.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        provider: 'gemini',
        ok: false,
        models: [],
        configured,
        error: `HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`,
      };
    }
    const json = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    const models = (json.models ?? [])
      // Only models that can actually answer a generateContent call.
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);
    return { provider: 'gemini', ok: true, models, configured };
  } catch (e) {
    return {
      provider: 'gemini',
      ok: false,
      models: [],
      configured,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkOpenAICompatible(
  provider: string,
  baseUrl: string,
  apiKey: string,
  configured: [string, string][],
): Promise<Report | null> {
  if (!apiKey || isPlaceholder(apiKey)) return null;

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        provider,
        ok: false,
        models: [],
        configured,
        error: `HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`,
      };
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    const models = (json.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    return { provider, ok: true, models, configured };
  } catch (e) {
    return {
      provider,
      ok: false,
      models: [],
      configured,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------

console.log(`\n${BOLD}Grasp — model availability${OFF}`);
console.log(`${DIM}profile: ${env.modelProfile}${
  env.modelProfile === 'dev' ? ' (best tier collapses onto the mid model)' : ''
}${OFF}\n`);

const reports = (
  await Promise.all([
    checkGemini(),
    checkOpenAICompatible('groq', 'https://api.groq.com/openai/v1', env.groq.apiKey, [
      ['GROQ_MODEL_FAST', env.groq.modelFast],
      ['GROQ_MODEL_MID', env.groq.modelMid],
    ]),
    checkOpenAICompatible(
      'openrouter',
      'https://openrouter.ai/api/v1',
      env.openrouter.apiKey,
      [['OPENROUTER_MODEL_MID', env.openrouter.modelMid]],
    ),
  ])
).filter((r): r is Report => r !== null);

if (reports.length === 0) {
  console.log(
    `${YELLOW}No provider keys set.${OFF} Add GEMINI_API_KEY and/or GROQ_API_KEY to\n` +
      `.env.local — docs/08-setup.md § 3 and § 4.\n`,
  );
  process.exit(1);
}

let anyBadConfig = false;

for (const r of reports) {
  if (!r.ok) {
    console.log(`${RED}✗ ${r.provider}${OFF} ${DIM}${r.error}${OFF}`);
    console.log(`  ${DIM}A 401/403 here means the key is wrong or revoked.${OFF}\n`);
    anyBadConfig = true;
    continue;
  }

  console.log(`${GREEN}✓ ${r.provider}${OFF} ${DIM}${r.models.length} models available${OFF}`);

  // Do the configured ids actually exist?
  for (const [envVar, id] of r.configured) {
    if (!id) {
      console.log(`  ${DIM}·${OFF} ${envVar.padEnd(22)} ${DIM}(unset)${OFF}`);
      continue;
    }
    const exists = r.models.includes(id);
    if (!exists) anyBadConfig = true;
    console.log(
      `  ${exists ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`} ${envVar.padEnd(22)} ${id}` +
        (exists ? '' : `  ${RED}← not available on this key${OFF}`),
    );
  }

  const suggestions = smallFirst(chatOnly(r.models)).slice(0, 6);
  console.log(`  ${DIM}smallest chat-capable: ${suggestions.join(', ')}${OFF}\n`);
}

if (anyBadConfig) {
  console.log(
    `${YELLOW}Fix the ✗ rows above by copying an available id into .env.local.${OFF}\n` +
      `${DIM}Prefer the smallest model that does the job while you're in dev — the free\n` +
      `tiers are rate-limited per minute, and a small model on a fast provider is\n` +
      `what makes the query-rewrite step feel instant.${OFF}\n`,
  );
  process.exit(1);
}

console.log(`${GREEN}${BOLD}Every configured model id is available.${OFF}\n`);
