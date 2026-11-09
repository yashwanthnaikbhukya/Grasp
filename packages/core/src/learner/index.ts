export {
  initialMastery,
  updateMastery,
  currentP,
  expectedScore,
  retention,
  evidenceWeight,
  kFactor,
  nextState,
  brierScore,
} from './mastery';
export type { MasteryStateRecord, AttemptSignal } from './mastery';

export { composeFeed, poolsFor, diversify, placementNext, DEFAULT_FEED, RESERVE_AFTER_MS } from './scheduler';
export type { CandidateCard, ConceptState, ScheduledCard, FeedConfig, Pool } from './scheduler';

export { masteryFromDoc } from './mastery';
export { recordAttempt } from './record';
export type { RecordAttemptInput, RecordAttemptOutcome } from './record';
export { replayMastery, diffMastery } from './replay';
export type { ReplayAttempt, RebuiltMastery, MasteryDiff } from './replay';
