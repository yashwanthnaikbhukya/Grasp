import type { PromptTemplate } from './types';
import { conceptTagV1 } from './templates/concept-tag.v1';
import { queryUnderstandV1 } from './templates/query-understand.v1';
import { slipClassifyV1 } from './templates/slip-classify.v1';
import { tutorReplyV1 } from './templates/tutor-reply.v1';

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
  [conceptTagV1.id]: conceptTagV1,
  [slipClassifyV1.id]: slipClassifyV1,
  [tutorReplyV1.id]: tutorReplyV1,
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
