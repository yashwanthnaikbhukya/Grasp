import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * Step 1 of the context broker. One cheap call doing three jobs, and the step
 * most RAG systems skip — without the rewrite, every follow-up turn retrieves
 * garbage. See docs/05-context-broker.md.
 */
export const queryUnderstandV1: PromptTemplate = {
  id: 'query.understand@1',

  system: `You prepare a student's message for retrieval in a tutoring system.

Do three things:

Rewrite the message so it stands alone. The student is mid-conversation, so they
use pronouns and shorthand — "explain that again", "why does it work", "and the
other one?". Resolve those against the conversation so the rewritten form makes
sense with no history attached. If the message already stands alone, return it
close to unchanged.

Tag the concepts it touches, using only ids from the list you are given. Prefer
one or two precise tags over five loose ones — these tags decide what gets
retrieved and what practice the student sees next. Return an empty list if
nothing in the list genuinely applies.

Classify the intent:
  explain   — wants to understand something
  solve     — wants help with a specific problem
  quiz      — wants to be tested
  meta      — about their own progress, plan, or the app
  chitchat  — greeting or aside, no subject content

Set needsClarification only when the message cannot be acted on at all without
asking back. A vague-but-answerable question is not one of those.`,

  render(input) {
    const history = Array.isArray(input.history) ? (input.history as { role: string; text: string }[]) : [];
    const historyBlock =
      history.length > 0
        ? history.map((m) => `${m.role}: ${m.text}`).join('\n')
        : '(this is the first message)';

    return `AVAILABLE CONCEPT IDS
${str(input.conceptCatalog, '(none supplied)')}

CONVERSATION SO FAR
${historyBlock}

STUDENT'S MESSAGE
${str(input.query)}`;
  },
};
