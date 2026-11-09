import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * Step 1 of the context broker — `query.understand@2`.
 *
 * Changes from @1, both from failing golden cases (pnpm eval):
 *
 *   - A short message straight after the tutor asked something is the
 *     student's *answer* to it. @1 read a one-word reply "tan" (to "which ratio
 *     connects opposite to adjacent?") as an unclear new request: intent `meta`,
 *     needsClarification, no concepts — so retrieval and the learner model lost
 *     the thread mid-problem (qu-09).
 *   - Maths words are kept exactly. @1 rewrote "and for cos 30?" as
 *     "What is the value of ω 30°?" (qu-03): a garbled function name sends
 *     retrieval and the tutor somewhere else entirely.
 */
export const queryUnderstandV2: PromptTemplate = {
  id: 'query.understand@2',

  system: `You prepare a student's message for retrieval in a tutoring system.

Do three things:

1. Rewrite the message so it stands alone. The student is mid-conversation, so they use pronouns and shorthand — "explain that again", "why does it work", "and the other one?". Resolve those against the conversation so the rewritten form makes sense with no history attached. If the message already stands alone, return it close to unchanged.

   When the tutor's last message asked the student something and the new message is short — a word, a number, a value, "yes", "no", "I don't know" — it is the student's reply to that question. Rewrite it as that reply, naming the problem being worked on: e.g. "The student answers 'tan' to: which ratio connects opposite and adjacent when finding the tree's height from 20 m at 45° elevation?" An "I don't know" or "explain it" reply means: explain the problem being worked on, fully.

   Keep mathematical words and notation exactly as written — sin, cos, tan, cosec, sec, cot, θ, °, π, √, ², and the numbers. Never translate, replace or drop them.

2. Tag the concepts it touches, using only ids from the list you are given. Prefer one or two precise tags over five loose ones — these tags decide what gets retrieved and what practice the student sees next. A reply to the tutor's question carries the concepts of the problem being worked on. Return an empty list if nothing in the list genuinely applies.

3. Classify the intent:
  explain   — wants to understand something
  solve     — wants help with a specific problem, or is replying inside one
  quiz      — wants to be tested
  meta      — about their own progress, plan, or the app
  chitchat  — greeting or aside, no subject content

Set needsClarification only when the message cannot be acted on at all without asking back. A reply to the tutor's own question never needs clarification, and neither does a vague-but-answerable question.`,

  render(input) {
    const history = Array.isArray(input.history)
      ? (input.history as { role: string; text: string }[])
      : [];
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
