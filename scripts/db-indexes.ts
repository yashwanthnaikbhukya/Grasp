/**
 * `pnpm db:indexes`
 *
 * Creates every regular index (idempotent — safe to re-run), then prints the two
 * Atlas Search definitions to paste into the Atlas UI. Those are separate
 * resources the driver cannot create; see docs/08-setup.md § 5.
 */
import { isPlaceholder } from './load-env';
import { closeMongo, ensureIndexes, env, searchIndexDefinitions } from '@grasp/core';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

if (!env.mongo.uri || isPlaceholder(env.mongo.uri)) {
  console.error(
    `${YELLOW}MONGODB_URI ${env.mongo.uri ? 'is still the .env.example placeholder' : 'is not set'}.${OFF}\n\n` +
      `Create a free Atlas M0 cluster and paste its connection string into .env.local.\n` +
      `Walkthrough: docs/08-setup.md § 2   ·   Then re-run: pnpm setup:check\n`,
  );
  process.exit(1);
}

console.log(`\n${BOLD}Creating regular indexes${OFF} ${DIM}on ${env.mongo.db}${OFF}\n`);

let results;
try {
  results = await ensureIndexes();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`${YELLOW}Could not reach MongoDB:${OFF} ${msg.split('\n')[0]}\n`);
  console.error(`${DIM}Run 'pnpm setup:check' — it diagnoses auth vs network problems.${OFF}\n`);
  await closeMongo();
  process.exit(1);
}

let created = 0;
for (const r of results) {
  if (r.note) {
    console.log(`  ${YELLOW}!${OFF} ${r.collection.padEnd(18)} ${DIM}${r.note}${OFF}`);
  } else {
    created += r.created.length;
    console.log(`  ${GREEN}✓${OFF} ${r.collection.padEnd(18)} ${DIM}${r.created.join(', ')}${OFF}`);
  }
}

console.log(`\n${DIM}${created} index definitions applied across ${results.length} collections.${OFF}`);

// ---- Atlas Search / Vector Search -----------------------------------------

console.log(`\n${BOLD}Atlas Search indexes — create these once, in the Atlas UI${OFF}`);
console.log(
  `${DIM}Atlas → your cluster → Atlas Search → Create Search Index → JSON Editor.
The driver cannot create these; they are separate resources.${OFF}\n`,
);

for (const idx of searchIndexDefinitions()) {
  console.log(`${BOLD}${idx.name}${OFF}`);
  console.log(`  ${DIM}type       ${OFF}${idx.type}`);
  console.log(`  ${DIM}collection ${OFF}${env.mongo.db}.${idx.collection}`);
  console.log(`  ${DIM}definition${OFF}`);
  console.log(
    JSON.stringify(idx.definition, null, 2)
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n'),
  );
  console.log('');
}

console.log(
  `${YELLOW}numDimensions is ${env.ollama.embedDim}${OFF} ${DIM}(from OLLAMA_EMBED_DIM).
Changing the embedding model later means re-embedding the corpus AND recreating
this index — the mismatch is silent otherwise.${OFF}\n`,
);

await closeMongo();
