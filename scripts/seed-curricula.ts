/**
 * `pnpm db:seed:curricula`
 *
 * Loads `data/curricula.seed.json` — the curriculum overlays on the universal
 * concept graph. See docs/adr/0006-curriculum-agnostic-concepts.md.
 *
 * Adding a curriculum is adding a row to that file. Only the curricula you
 * actually serve need concept mappings; an unmapped concept degrades to the
 * universal default rather than disappearing.
 */
import { isPlaceholder } from './load-env';
import { readFile } from 'node:fs/promises';
import {
  CURRICULUM_KIND_NAME,
  CurriculumSeedSchema,
  SELF_STUDY_CURRICULUM_ID,
  stageLabel,
  subjectInfo,
  supportedRegions,
} from '@grasp/schema';
import { closeMongo, collections, env } from '@grasp/core';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

if (!env.mongo.uri || isPlaceholder(env.mongo.uri)) {
  console.error(`${YELLOW}MONGODB_URI is not set. See docs/08-setup.md § 2${OFF}`);
  process.exit(1);
}

const raw = await readFile(new URL('../data/curricula.seed.json', import.meta.url), 'utf8');
const seed = CurriculumSeedSchema.parse(JSON.parse(raw));

// ---- Validate ------------------------------------------------------------

const ids = new Set(seed.curricula.map((c) => c._id));

if (!ids.has(SELF_STUDY_CURRICULUM_ID)) {
  console.error(
    `${RED}The seed must include "${SELF_STUDY_CURRICULUM_ID}".${OFF}\n` +
      `A learner with no matching curriculum is a first-class case, not an error\n` +
      `state — without this row they have nowhere to land.\n`,
  );
  process.exit(1);
}

const badMappings = seed.mappings.filter((m) => !ids.has(m.curriculumId));
if (badMappings.length > 0) {
  console.error(`${RED}Mappings reference unknown curricula:${OFF}`);
  for (const m of badMappings) console.error(`  ${m.curriculumId} → ${m.conceptId}`);
  process.exit(1);
}

// A subject id outside the catalogue would show as raw text at onboarding.
const unknownSubjects = seed.curricula.flatMap((c) =>
  c.subjects.filter((s) => !subjectInfo(s)).map((s) => `${c._id} → ${s}`),
);
if (unknownSubjects.length > 0) {
  console.error(`${RED}Subjects not in packages/schema/src/subjects.ts:${OFF}`);
  for (const u of unknownSubjects) console.error(`  ${u}`);
  process.exit(1);
}

// A curriculum nobody can reach from onboarding is almost always a typo'd region.
const known = new Set(supportedRegions());
for (const c of seed.curricula) {
  const unknown = c.regions.filter((r) => r !== '*' && !known.has(r));
  if (unknown.length > 0) {
    console.log(
      `${DIM}note: ${c._id} lists region(s) ${unknown.join(', ')} with no hand-checked ` +
        `stage ladder — they fall back to "Grade N", which works but may read oddly.${OFF}`,
    );
  }
}

// ---- Write ---------------------------------------------------------------

// Replace, not $set: a row is exactly what the seed says. ($set left the old
// single `subject` field behind when programmes moved to `subjects[]`.)
const curriculumOps = seed.curricula.map((c) => ({
  replaceOne: { filter: { _id: c._id }, replacement: c, upsert: true },
}));
const cRes = await collections.curricula().bulkWrite(curriculumOps as never);

let mRes = { upsertedCount: 0, modifiedCount: 0 };
if (seed.mappings.length > 0) {
  // Fall back to declaration order when sequenceIndex is omitted.
  const perCurriculum = new Map<string, number>();
  const mappingOps = seed.mappings.map((m) => {
    const n = perCurriculum.get(m.curriculumId) ?? 0;
    perCurriculum.set(m.curriculumId, n + 1);
    return {
      updateOne: {
        filter: { curriculumId: m.curriculumId, conceptId: m.conceptId },
        update: { $set: { ...m, sequenceIndex: m.sequenceIndex ?? n } },
        upsert: true,
      },
    };
  });
  mRes = await collections.curriculumMappings().bulkWrite(mappingOps as never);
}

// ---- Report --------------------------------------------------------------

console.log(`\n${GREEN}✓${OFF} ${BOLD}${seed.curricula.length} curricula${OFF} loaded`);
console.log(`  ${DIM}upserted ${cRes.upsertedCount} · modified ${cRes.modifiedCount}${OFF}`);

for (const [kind, label] of Object.entries(CURRICULUM_KIND_NAME)) {
  const n = seed.curricula.filter((c) => c.kind === kind).length;
  if (n > 0) console.log(`  ${DIM}${String(n).padStart(3)} · ${label}${OFF}`);
}
const international = seed.curricula.filter((c) => c.regions.includes('*')).length;
const regions = new Set(seed.curricula.flatMap((c) => c.regions).filter((r) => r !== '*'));
console.log(
  `  ${DIM}${regions.size} regions covered · ${international} international curricula${OFF}`,
);

if (seed.mappings.length === 0) {
  console.log(
    `\n${DIM}No concept mappings yet. Until they exist, every concept is treated as\n` +
      `in-scope for every curriculum — a broader experience, not a broken one.\n` +
      `Author mappings for the seed curriculum first: ${env.seed.curriculumId}${OFF}`,
  );
} else {
  console.log(
    `  ${DIM}${seed.mappings.length} concept mappings · upserted ${mRes.upsertedCount}${OFF}`,
  );
}

// Sanity check the ladder against a couple of real curricula, so a wrong
// stageRange is visible here rather than confusing a learner at onboarding.
console.log(`\n${DIM}Stage ladder spot-check:${OFF}`);
for (const c of seed.curricula.slice(1, 5)) {
  const region = c.regions.find((r) => r !== '*') ?? undefined;
  const lo = stageLabel(c.stageRange.min, region);
  const hi = stageLabel(c.stageRange.max, region);
  console.log(`  ${DIM}${c._id.padEnd(28)} ${lo} → ${hi}${OFF}`);
}
console.log('');

await closeMongo();
