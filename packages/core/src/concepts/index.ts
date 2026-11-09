export {
  resolveExisting,
  resolveOrCreate,
  knownConceptIds,
  loadGraph,
  invalidateGraphCache,
  cosine,
  slugify,
  uniqueSlug,
  normalizeAlias,
  wouldCycle,
  computeDepth,
  MERGE_THRESHOLD,
  REVIEW_THRESHOLD,
} from './resolve';
export type { Match, ResolveResult } from './resolve';
