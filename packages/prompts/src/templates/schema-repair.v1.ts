import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * The one repair turn the gateway allows when a structured-output task returns
 * JSON that fails its Zod schema. Was an inline string in gateway.ts — rule 2:
 * every prompt lives here with a version.
 *
 * Sent as a follow-up user message in the same conversation, after the model's
 * invalid reply, so it needs no system prompt of its own.
 */
export const schemaRepairV1: PromptTemplate = {
  id: 'schema.repair@1',
  system: '',
  render(input) {
    return `That response did not match the required schema:
${str(input.error)}

Return only corrected JSON matching the schema. No prose, no code fence.`;
  },
};
