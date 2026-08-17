/**
 * `pnpm setup:check`
 *
 * Reports exactly what is wired and what isn't, phase by phase, and prints the
 * next concrete action. This is the answer to "do I need to set up a key?" —
 * run it any time you're unsure.
 */
import { isPlaceholder } from './load-env';
import { closeMongo, configuredProviders, env, ollamaStatus, pingMongo } from '@grasp/core';

type State = 'ok' | 'warn' | 'missing';

interface Check {
  phase: 0 | 1 | 2 | 3 | 4;
  name: string;
  state: State;
  detail: string;
  fix?: string;
}

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

const MARK: Record<State, string> = {
  ok: `${GREEN}✓${OFF}`,
  warn: `${YELLOW}!${OFF}`,
  missing: `${RED}✗${OFF}`,
};

/** Set to a real value — a copied-but-unedited placeholder does not count. */
function present(v: string): boolean {
  return Boolean(v && v.trim()) && !isPlaceholder(v);
}

async function collect(): Promise<Check[]> {
  const checks: Check[] = [];

  // ---- Phase 0 -------------------------------------------------------------

  checks.push({
    phase: 0,
    name: 'Content scope',
    state: 'ok',
    detail: `${env.scope.board} · Class ${env.scope.grade} · ${env.scope.subject}`,
    fix: 'Change with GRASP_BOARD / GRASP_GRADE / GRASP_SUBJECT',
  });

  if (!present(env.mongo.uri)) {
    const stillTemplate = Boolean(env.mongo.uri.trim());
    checks.push({
      phase: 0,
      name: 'MongoDB Atlas',
      state: 'missing',
      detail: stillTemplate
        ? 'MONGODB_URI is still the .env.example placeholder'
        : 'MONGODB_URI not set',
      fix: 'docs/08-setup.md § 2 — create a free M0 cluster (about 5 minutes)',
    });
  } else {
    try {
      const { ms } = await pingMongo();
      checks.push({
        phase: 0,
        name: 'MongoDB Atlas',
        state: 'ok',
        detail: `connected in ${ms} ms · db "${env.mongo.db}"`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const auth = /auth|password|credential/i.test(msg);
      const net = /ENOTFOUND|timed out|ETIMEDOUT|whitelist|not allowed/i.test(msg);
      checks.push({
        phase: 0,
        name: 'MongoDB Atlas',
        state: 'missing',
        detail: msg.split('\n')[0] ?? msg,
        fix: auth
          ? 'Password wrong, or has URI-unsafe characters — regenerate an alphanumeric one'
          : net
            ? 'Add your IP under Atlas → Network Access (0.0.0.0/0 for local dev)'
            : 'docs/08-setup.md § 2',
      });
    }
  }

  const providers = configuredProviders();
  if (providers.length === 0) {
    checks.push({
      phase: 0,
      name: 'Model providers',
      state: 'missing',
      detail: 'no hosted provider key set',
      fix: 'docs/08-setup.md § 3 and § 4 — Gemini and Groq, both free, ~2 minutes each',
    });
  } else if (providers.length === 1) {
    checks.push({
      phase: 0,
      name: 'Model providers',
      state: 'warn',
      detail: `only ${providers[0]} — no failover leg`,
      fix: 'Add a second key. With one you will hit a rate limit mid-session and stop.',
    });
  } else {
    checks.push({
      phase: 0,
      name: 'Model providers',
      state: 'ok',
      detail: `${providers.join(', ')} — failover available`,
    });
  }

  const ollama = await ollamaStatus();
  if (!ollama.reachable) {
    checks.push({
      phase: 0,
      name: 'Ollama (embeddings)',
      state: 'missing',
      detail: ollama.error ?? `unreachable at ${env.ollama.baseUrl}`,
      fix: 'brew install ollama && brew services start ollama — docs/08-setup.md § 1',
    });
  } else {
    const hasEmbed = ollama.models.some((m) => m.startsWith(env.ollama.embedModel));
    const hasChat = ollama.models.some((m) => m.startsWith(env.ollama.chatModel));
    checks.push({
      phase: 0,
      name: 'Ollama (embeddings)',
      state: hasEmbed ? 'ok' : 'missing',
      detail: hasEmbed
        ? `${env.ollama.embedModel} present · ${env.ollama.embedDim} dims`
        : `running, but ${env.ollama.embedModel} not pulled`,
      fix: hasEmbed ? undefined : `ollama pull ${env.ollama.embedModel}`,
    });
    if (!hasChat) {
      checks.push({
        phase: 0,
        name: 'Ollama (offline failover)',
        state: 'warn',
        detail: `${env.ollama.chatModel} not pulled — no offline floor`,
        fix: `ollama pull ${env.ollama.chatModel}`,
      });
    }
  }

  checks.push({
    phase: 0,
    name: 'Tracing',
    state: present(env.langfuse.secretKey) ? 'ok' : 'warn',
    detail: present(env.langfuse.secretKey) ? 'Langfuse configured' : 'stdout only',
    fix: present(env.langfuse.secretKey)
      ? undefined
      : 'docs/08-setup.md § 6 — recommended now; without it you are guessing about your own system',
  });

  // ---- Later phases --------------------------------------------------------

  const later: { phase: 1 | 2 | 4; name: string; ok: boolean; detail: string; ref: string }[] = [
    {
      phase: 1,
      name: 'Upstash Redis',
      ok: present(env.redis.url) && present(env.redis.token),
      detail: 'cache, rate limit, card queue',
      ref: '§ 8',
    },
    {
      phase: 1,
      name: 'Cloudflare R2',
      ok: present(process.env.R2_ACCESS_KEY_ID ?? ''),
      detail: 'attachment storage',
      ref: '§ 9',
    },
    {
      phase: 1,
      name: 'Auth secret',
      ok: present(process.env.AUTH_SECRET ?? ''),
      detail: 'openssl rand -base64 32',
      ref: '§ 10',
    },
    {
      phase: 1,
      name: 'Inngest',
      ok: present(process.env.INNGEST_EVENT_KEY ?? ''),
      detail: 'durable jobs (local devserver needs no keys)',
      ref: '§ 11',
    },
    {
      phase: 2,
      name: 'PostHog',
      ok: present(process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''),
      detail: 'retention on the Reps feed',
      ref: '§ 13',
    },
    {
      phase: 4,
      name: 'Pusher',
      ok: present(process.env.PUSHER_SECRET ?? ''),
      detail: 'duel presence only',
      ref: '§ 14',
    },
  ];

  for (const l of later) {
    checks.push({
      phase: l.phase,
      name: l.name,
      state: l.ok ? 'ok' : 'warn',
      detail: l.detail,
      fix: l.ok ? undefined : `docs/08-setup.md ${l.ref} — needed for Phase ${l.phase}`,
    });
  }

  return checks;
}

function render(checks: Check[]): void {
  console.log(`\n${BOLD}Grasp — setup check${OFF}\n`);

  for (const phase of [0, 1, 2, 3, 4] as const) {
    const group = checks.filter((c) => c.phase === phase);
    if (group.length === 0) continue;

    const label = phase === 0 ? 'Phase 0 — required now' : `Phase ${phase} — needed later`;
    console.log(`${DIM}${label}${OFF}`);

    for (const c of group) {
      console.log(`  ${MARK[c.state]} ${c.name.padEnd(24)} ${DIM}${c.detail}${OFF}`);
      if (c.fix && c.state !== 'ok') console.log(`      ${DIM}→ ${c.fix}${OFF}`);
    }
    console.log('');
  }

  const p0 = checks.filter((c) => c.phase === 0);
  const blocking = p0.filter((c) => c.state === 'missing');

  if (blocking.length === 0) {
    console.log(`${GREEN}${BOLD}Phase 0 dependencies are all wired.${OFF}\n`);
    console.log('Next:');
    console.log(`  ${DIM}1.${OFF} pnpm db:indexes        ${DIM}# then paste the two Atlas index defs it prints${OFF}`);
    console.log(`  ${DIM}2.${OFF} pnpm dev               ${DIM}# then open /debug/gateway${OFF}`);
    console.log(`  ${DIM}3.${OFF} Author data/concepts.seed.json  ${DIM}# the real Phase 0 work — docs/07-phases.md § 0.2${OFF}\n`);
  } else {
    console.log(`${RED}${BOLD}${blocking.length} thing(s) still needed for Phase 0:${OFF}\n`);
    for (const c of blocking) console.log(`  ${RED}✗${OFF} ${c.name} — ${c.fix ?? ''}`);
    console.log(`\n${DIM}Full walkthrough: docs/08-setup.md${OFF}\n`);
  }
}

const checks = await collect();
render(checks);
await closeMongo();
process.exit(checks.some((c) => c.phase === 0 && c.state === 'missing') ? 1 : 0);
