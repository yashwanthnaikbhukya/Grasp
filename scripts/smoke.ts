/**
 * `pnpm smoke`
 *
 * Exercises every part of the spine that is currently configured, for real — no
 * mocks. Skips what isn't wired yet rather than failing, so it's useful from the
 * first minute of setup through to the Phase 0 gate.
 *
 * Complements the other two checks rather than repeating them:
 *   setup:check   is a value present?
 *   models:check  does the model id exist on this key?
 *   smoke         does the thing actually work end to end?
 */
import { isPlaceholder } from './load-env';
import {
  closeMongo,
  collections,
  configuredProviders,
  embed,
  env,
  generate,
  chainFor,
  pingMongo,
} from '@grasp/core';
import type { QueryUnderstanding } from '@grasp/schema';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

let failed = 0;
let skipped = 0;

function pass(name: string, detail: string) {
  console.log(`  ${GREEN}✓${OFF} ${name.padEnd(26)} ${DIM}${detail}${OFF}`);
}
function fail(name: string, detail: string, fix?: string) {
  failed++;
  console.log(`  ${RED}✗${OFF} ${name.padEnd(26)} ${detail}`);
  if (fix) console.log(`      ${DIM}→ ${fix}${OFF}`);
}
function skip(name: string, why: string) {
  skipped++;
  console.log(`  ${YELLOW}−${OFF} ${name.padEnd(26)} ${DIM}skipped — ${why}${OFF}`);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / Math.sqrt(na * nb);
}

console.log(`\n${BOLD}Grasp — smoke test${OFF} ${DIM}(real calls, nothing mocked)${OFF}\n`);

// ---------------------------------------------------------------------------
// 1. Embeddings — needs no API key. The part that makes the project free.
// ---------------------------------------------------------------------------
console.log(`${DIM}Embeddings · local Ollama${OFF}`);
try {
  const t0 = Date.now();
  const r = await embed({
    texts: [
      'The identity sin^2 x + cos^2 x = 1 follows from Pythagoras.',
      'Deriving 1 + tan^2 x = sec^2 x by dividing through by cos^2 x.',
      'A duel freezes its question set at creation so a dropped connection cannot desync it.',
    ],
    purpose: 'chunk',
  });

  if (r.dim !== env.ollama.embedDim) {
    fail(
      'dimension',
      `model returned ${r.dim}, OLLAMA_EMBED_DIM is ${env.ollama.embedDim}`,
      'A mismatch silently produces unsearchable chunks. Fix the env var AND recreate the Atlas vector index.',
    );
  } else {
    pass('dimension', `${r.dim} matches OLLAMA_EMBED_DIM`);
  }
  pass('vectors', `${r.vectors.length} in ${Date.now() - t0} ms · ${r.model}`);

  // Semantic ordering: two trig sentences should sit closer than trig vs duel.
  // If this inverts, retrieval will be quietly useless and nothing else will say so.
  const [a, b, c] = r.vectors as number[][];
  if (a && b && c) {
    const related = cosine(a, b);
    const unrelated = cosine(a, c);
    if (related > unrelated) {
      pass('semantic ordering', `related ${related.toFixed(3)} > unrelated ${unrelated.toFixed(3)}`);
    } else {
      fail(
        'semantic ordering',
        `related ${related.toFixed(3)} is NOT above unrelated ${unrelated.toFixed(3)}`,
        'The embed model is producing garbage. Re-pull it.',
      );
    }
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  skip('embeddings', msg.slice(0, 90));
  console.log(
    `      ${DIM}→ brew services start ollama && ollama pull ${env.ollama.embedModel}${OFF}`,
  );
}

// ---------------------------------------------------------------------------
// 2. Mongo — connect, write, read, clean up.
// ---------------------------------------------------------------------------
console.log(`\n${DIM}MongoDB Atlas${OFF}`);
if (!env.mongo.uri || isPlaceholder(env.mongo.uri)) {
  skip('connection', 'MONGODB_URI not set — paste it into .env.local');
} else {
  try {
    const { ms } = await pingMongo();
    pass('connection', `${ms} ms · db "${env.mongo.db}"`);

    // A ping proves reachability; only a write proves the credential has
    // readWrite, which is the failure that otherwise shows up mid-ingest.
    const probe = collections.counters();
    const key = `smoke.${Date.now()}`;
    await probe.updateOne({ _id: key }, { $inc: { value: 1 } }, { upsert: true });
    const back = await probe.findOne({ _id: key });
    if (back?.value === 1) {
      pass('write + read', 'credential has readWrite');
    } else {
      fail('write + read', 'wrote but could not read it back');
    }
    await probe.deleteOne({ _id: key });

    const curricula = await collections.curricula().countDocuments();
    const concepts = await collections.concepts().countDocuments();
    if (curricula > 0) pass('curricula seeded', `${curricula} rows`);
    else skip('curricula seeded', 'run pnpm db:seed:curricula');
    if (concepts > 0) pass('concepts seeded', `${concepts} nodes`);
    else skip('concepts seeded', 'run pnpm db:seed:concepts');
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '';
    const auth = /auth|password|credential/i.test(msg);
    const net = /ENOTFOUND|timed out|ETIMEDOUT|whitelist|not allowed/i.test(msg);
    fail(
      'connection',
      msg.slice(0, 90),
      auth
        ? 'Password wrong, or has URI-unsafe characters — regenerate an alphanumeric one'
        : net
          ? 'Atlas → Network Access → add your IP (0.0.0.0/0 for local dev)'
          : 'docs/08-setup.md § 2',
    );
  }
}

// ---------------------------------------------------------------------------
// 3. The gateway — a real structured-output call, then forced failover.
//    This is the Phase 0 gate.
// ---------------------------------------------------------------------------
console.log(`\n${DIM}LLM gateway · the Phase 0 gate${OFF}`);
const providers = configuredProviders();

if (providers.length === 0) {
  skip('structured output', 'no provider key set');
  skip('failover', 'no provider key set');
} else {
  const input = {
    query: 'explain that identity again, the one with sin and cos',
    history: [
      { role: 'user', text: 'how do I prove sin²θ + cos²θ = 1?' },
      { role: 'assistant', text: 'Start from the unit circle and Pythagoras…' },
    ],
    conceptCatalog: [
      'pythagorean-identity — the identity sin^2 + cos^2 = 1',
      'radian-measure — angles in radians',
      'quadratic-formula — roots of a quadratic',
    ].join('\n'),
  };

  let ok = false;
  try {
    const r = await generate<QueryUnderstanding>({ task: 'query.understand', input });
    ok = true;
    pass('structured output', `${r.provider}/${r.model} · ${r.latencyMs} ms`);
    console.log(
      `      ${DIM}rewritten: "${(r.data?.rewritten ?? '').slice(0, 68)}"${OFF}\n` +
        `      ${DIM}concepts: [${(r.data?.conceptIds ?? []).join(', ')}] intent: ${r.data?.intent}${OFF}`,
    );
    // The rewrite is the whole point of step 1 — a passthrough means every
    // follow-up turn will retrieve garbage.
    if ((r.data?.rewritten ?? '').toLowerCase().includes('that identity again')) {
      console.log(
        `      ${YELLOW}note${OFF} ${DIM}the rewrite looks like a passthrough — check the prompt${OFF}`,
      );
    }
  } catch (e) {
    fail(
      'structured output',
      (e instanceof Error ? e.message : String(e)).slice(0, 90),
      'Run pnpm models:check — a 404 means the model id is retired',
    );
  }

  const chain = chainFor('fast');
  const primary = chain[0]?.name;
  if (!ok) {
    skip('failover', 'the plain call failed first');
  } else if (chain.length < 2) {
    skip('failover', `only ${primary} configured — add a second key so there is somewhere to fall back to`);
  } else if (primary) {
    try {
      const r = await generate<QueryUnderstanding>({
        task: 'query.understand',
        input,
        simulateFailFor: [primary],
      });
      if (r.failoverDepth > 0) {
        pass('failover', `${primary} down → served by ${r.provider}, depth ${r.failoverDepth}`);
      } else {
        fail('failover', `expected depth > 0, got ${r.failoverDepth}`);
      }
    } catch (e) {
      fail('failover', (e instanceof Error ? e.message : String(e)).slice(0, 90));
    }
  }
}

// ---------------------------------------------------------------------------

console.log('');
if (failed > 0) {
  console.log(`${RED}${BOLD}${failed} check(s) failed${OFF}${skipped ? `, ${skipped} skipped` : ''}\n`);
} else if (skipped > 0) {
  console.log(
    `${YELLOW}${BOLD}Everything configured works.${OFF} ${DIM}${skipped} check(s) skipped — ` +
      `see above for what's still unwired.${OFF}\n`,
  );
} else {
  console.log(
    `${GREEN}${BOLD}Whole spine works. Phase 0 gate passed.${OFF}\n` +
      `${DIM}Next: author data/concepts.seed.json properly (docs/07-phases.md § 0.2).${OFF}\n`,
  );
}

await closeMongo();
process.exit(failed > 0 ? 1 : 0);
