/**
 * `pnpm ingest <file.md> [--subject=mathematics] [--curriculum=id]`
 * `pnpm ingest --all`   ingests everything in data/corpus/
 *
 * The same code path the background job will use, driven by hand so you can
 * watch it and check its judgement.
 */
import './load-env';
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeMongo, env, ingestMarkdown } from '@grasp/core';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

const args = process.argv.slice(2);
const flag = (name: string, dflt = '') =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt;

const corpusDir = fileURLToPath(new URL('../data/corpus/', import.meta.url));

const files = args.includes('--all')
  ? (await readdir(corpusDir)).filter((f) => f.endsWith('.md')).map((f) => join(corpusDir, f))
  : args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error(
    '\nUsage:\n  pnpm ingest --all\n  pnpm ingest data/corpus/trigonometry.md\n',
  );
  process.exit(1);
}

if (!env.mongo.uri) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

const subject = flag('subject', env.seed.subject);
const curriculum = flag('curriculum', env.seed.curriculumId);

for (const file of files) {
  const markdown = await readFile(file, 'utf8');
  const title = basename(file, '.md').replace(/[-_]/g, ' ');
  console.log(`\n${BOLD}Ingesting${OFF} ${title} ${DIM}(${subject} · ${curriculum})${OFF}`);

  const r = await ingestMarkdown({
    markdown,
    title,
    subject,
    // The seed curriculum tags the corpus, but an empty list means
    // curriculum-neutral — eligible for every learner.
    curriculumIds: curriculum === 'self-study' ? [] : [curriculum],
    kind: 'textbook',
    onProgress: (m) => console.log(`  ${DIM}${m}${OFF}`),
  });

  console.log(
    `${GREEN}✓${OFF} ${r.chunksWritten} chunks in ${(r.latencyMs / 1000).toFixed(1)}s`,
  );
  console.log(
    `  ${DIM}tagged ${r.conceptsTagged}/${r.chunksWritten}` +
      (r.untagged ? ` · ${r.untagged} untagged` : '') +
      (r.deferred ? ` · ${r.deferred} deferred (rate limit)` : '') +
      OFF,
  );
  if (r.conceptsCreated.length > 0) {
    console.log(`  ${DIM}new concepts: ${r.conceptsCreated.join(', ')}${OFF}`);
  }
  if (r.untagged > r.chunksWritten / 2) {
    console.log(
      `  ${YELLOW}over half the chunks are untagged${OFF} ${DIM}— still retrievable, but they\n` +
        `  cannot feed Reps, Map or gap detection. Re-run to continue tagging.${OFF}`,
    );
  }
}

console.log('');
await closeMongo();
