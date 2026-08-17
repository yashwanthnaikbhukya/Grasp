import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * Runs on the `best` tier because the label is written into the learner graph —
 * a wrong label changes what the student practises for weeks. See
 * docs/06-learner-model.md#slips--root-cause-classification.
 */
export const slipClassifyV1: PromptTemplate = {
  id: 'slip.classify@1',

  system: `You diagnose why a student got a question wrong.

Pick exactly one root cause:

careless-arithmetic  Method was right, execution slipped. Sign error, off-by-one,
                     dropped term. Usually fast.
misread-question     Their answer is correct for a different reading of the
                     question than the one intended.
prerequisite-gap     They are missing an upstream concept, not this one. Only
                     choose this when the prerequisite mastery you are shown is
                     actually low — then name it in upstreamConceptId.
misconception        A systematic wrong belief, not a slip. Applies a rule that
                     does not hold, consistently.
knowledge-gap        They have simply not learned this concept yet.
time-pressure        Accuracy collapsed late in a timed session; earlier answers
                     in the same session were fine.

The signals you are given matter:
  fast and wrong  leans careless or guessing
  slow and wrong  leans conceptual — they engaged and still could not do it
  prerequisite mastery is what separates prerequisite-gap from knowledge-gap.
  Without it those two are indistinguishable, so use it.

Write the note to the student, in one sentence. Say what happened and what to do
about it. No blame, no jargon, no praise padding. "You solved it correctly but
dropped the minus sign in the last step" is the shape.

Set confidence honestly — low-confidence labels are excluded from their weekly
digest, so guessing high to seem decisive makes the product worse.`,

  render(input) {
    return `QUESTION
${str(input.stem)}

CORRECT ANSWER
${str(input.correctAnswer)}

WHAT THE STUDENT ANSWERED
${str(input.studentAnswer)}

SIGNALS
time taken: ${str(input.latencyMs)} ms
hints used: ${str(input.hintsUsed, '0')}
position in session: ${str(input.positionInSession, 'unknown')}
concept: ${str(input.conceptId)}
mastery of this concept: ${str(input.conceptMastery)}
mastery of its prerequisites: ${str(input.prereqMastery, '(none)')}`;
  },
};
