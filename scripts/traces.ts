/**
 * `pnpm traces` — the last N gateway calls, from Mongo.
 *
 * The local record that survives without a third party. Two things to watch:
 *
 *   failoverDepth  a rising average means your primary free tier is saturating.
 *                  There is no other signal for this.
 *   ok=false rate  which provider is actually flaky, and with what error kind.
 *
 * Langfuse is the rich view; this is the one that works with no keys set.
 */
import './load-env';
import { closeMongo, collections, env } from '@grasp/core';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 15);

if (!env.mongo.uri) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

const col = collections.llmCalls();
const total = await col.countDocuments();

if (total === 0) {
  console.log(
    `\n${YELLOW}No traces yet.${OFF} ${DIM}Run \`pnpm smoke\` or use the app, then try again.${OFF}\n`,
  );
  await closeMongo();
  process.exit(0);
}

const rows = await col.find({}).sort({ createdAt: -1 }).limit(limit).toArray();

console.log(`\n${BOLD}Last ${rows.length} gateway calls${OFF} ${DIM}of ${total} total${OFF}\n`);
console.log(
  `  ${DIM}${'task'.padEnd(20)}${'provider/model'.padEnd(36)}${'ms'.padEnd(7)}${'tokens'.padEnd(14)}fo${OFF}`,
);

for (const r of rows) {
  const mark = r.ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`;
  const fo = r.failoverDepth > 0 ? `${YELLOW}${r.failoverDepth}${OFF}` : `${DIM}0${OFF}`;
  console.log(
    `  ${mark} ${String(r.task).padEnd(18)}` +
      `${DIM}${`${r.provider}/${r.model}`.slice(0, 34).padEnd(36)}${OFF}` +
      `${String(r.latencyMs).padEnd(7)}` +
      `${DIM}${`${r.inputTokens}→${r.outputTokens}`.padEnd(14)}${OFF}` +
      `${fo}${r.ok ? '' : ` ${DIM}${r.errorKind}${OFF}`}`,
  );
}

// ---- Aggregate the two numbers that actually matter -----------------------

const byProvider = new Map<string, { n: number; ok: number; ms: number; fo: number }>();
for (const r of rows) {
  const k = String(r.provider);
  const cur = byProvider.get(k) ?? { n: 0, ok: 0, ms: 0, fo: 0 };
  cur.n++;
  if (r.ok) {
    cur.ok++;
    cur.ms += r.latencyMs;
  }
  cur.fo += r.failoverDepth;
  byProvider.set(k, cur);
}

console.log(`\n${BOLD}By provider${OFF}`);
for (const [provider, s] of byProvider) {
  const avgMs = s.ok > 0 ? Math.round(s.ms / s.ok) : 0;
  const rate = Math.round((s.ok / s.n) * 100);
  console.log(
    `  ${provider.padEnd(12)} ${DIM}${s.n} calls · ${rate}% ok · ${avgMs} ms avg` +
      ` · failover sum ${s.fo}${OFF}`,
  );
}

const avgFailover = rows.reduce((a, r) => a + r.failoverDepth, 0) / rows.length;
if (avgFailover > 0.3) {
  console.log(
    `\n${YELLOW}Average failover depth is ${avgFailover.toFixed(2)}.${OFF} ${DIM}Your primary\n` +
      `provider is being skipped often — reorder the chain in llm/gateway.ts, move a\n` +
      `task down a tier, or add response caching.${OFF}`,
  );
}
console.log('');

await closeMongo();
