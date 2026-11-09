import type { PromptTemplate } from './types';
import { attachmentReadV1 } from './templates/attachment-read.v1';
import { cardGenerateV1 } from './templates/card-generate.v1';
import { cardSolveV1 } from './templates/card-solve.v1';
import { conceptProposeV1 } from './templates/concept-propose.v1';
import { conceptProposeV2 } from './templates/concept-propose.v2';
import { conceptTagV1 } from './templates/concept-tag.v1';
import { queryUnderstandV1 } from './templates/query-understand.v1';
import { queryUnderstandV2 } from './templates/query-understand.v2';
import { evalJudgeV1 } from './templates/eval-judge.v1';
import { schemaRepairV1 } from './templates/schema-repair.v1';
import { slipClassifyV1 } from './templates/slip-classify.v1';
import { slipClassifyV2 } from './templates/slip-classify.v2';
import { tutorReplyV1 } from './templates/tutor-reply.v1';
import { tutorAnswerV1, tutorCoachV1, tutorTeachV1 } from './templates/tutor-modes.v1';
import { tutorAnswerV2, tutorCoachV2, tutorTeachV2 } from './templates/tutor-modes.v2';
import { tutorAnswerV3, tutorCoachV3, tutorTeachV3 } from './templates/tutor-modes.v3';

export type { PromptTemplate } from './types';
export { str, list } from './types';

/**
 * The prompt registry, keyed `taskId@version`.
 *
 * Never edit a shipped template — add the next version and repoint the task in
 * `@grasp/core/llm/registry`. The version id reaches the trace, which is what
 * makes an output-quality change attributable.
 */
const templates: Record<string, PromptTemplate> = {
  [queryUnderstandV1.id]: queryUnderstandV1,
  [queryUnderstandV2.id]: queryUnderstandV2,
  [conceptTagV1.id]: conceptTagV1,
  [conceptProposeV1.id]: conceptProposeV1,
  [cardGenerateV1.id]: cardGenerateV1,
  [cardSolveV1.id]: cardSolveV1,
  [conceptProposeV2.id]: conceptProposeV2,
  [slipClassifyV1.id]: slipClassifyV1,
  [slipClassifyV2.id]: slipClassifyV2,
  [tutorReplyV1.id]: tutorReplyV1,
  [tutorAnswerV1.id]: tutorAnswerV1,
  [tutorTeachV1.id]: tutorTeachV1,
  [tutorCoachV1.id]: tutorCoachV1,
  [tutorAnswerV2.id]: tutorAnswerV2,
  [tutorTeachV2.id]: tutorTeachV2,
  [tutorCoachV2.id]: tutorCoachV2,
  [tutorAnswerV3.id]: tutorAnswerV3,
  [tutorTeachV3.id]: tutorTeachV3,
  [tutorCoachV3.id]: tutorCoachV3,
  [schemaRepairV1.id]: schemaRepairV1,
  [attachmentReadV1.id]: attachmentReadV1,
  [evalJudgeV1.id]: evalJudgeV1,
};

export function getPrompt(id: string): PromptTemplate {
  const t = templates[id];
  if (!t) {
    throw new Error(
      `Unknown prompt "${id}". Registered: ${Object.keys(templates).sort().join(', ')}`,
    );
  }
  return t;
}

export function listPrompts(): string[] {
  return Object.keys(templates).sort();
}
