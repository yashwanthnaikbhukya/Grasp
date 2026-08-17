/**
 * `pnpm concepts:reset` — delete model-proposed concepts, keep seeded ones.
 * A dev convenience for re-running growth against a known starting state.
 */
import './load-env';
import { closeMongo, collections, invalidateGraphCache } from '@grasp/core';
const r = await collections.concepts().deleteMany({ origin: 'llm' });
invalidateGraphCache();
console.log(`removed ${r.deletedCount} llm-origin concepts; seeded nodes kept`);
await closeMongo();
