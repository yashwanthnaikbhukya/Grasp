import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * The verification leg.
 *
 * Solves a candidate question *without* seeing its intended answer, so agreement
 * between independent solves is real evidence rather than a restatement. Two
 * solves that agree with each other and with the author's key is what promotes a
 * question to `verified`.
 *
 * Critically, this also reports flaws in the item itself. A question can be
 * perfectly solvable and still be unusable — two defensible options, an
 * ambiguous stem — and only a solver working blind will notice.
 */
export const cardSolveV1: PromptTemplate = {
  id: 'card.solve@1',

  system: `You are checking a practice question before students see it.

Solve it yourself, from scratch. You are not being shown the intended answer, and
that is deliberate — your agreement is only worth something if it is independent.

Then judge the question itself. This matters as much as the answer, because a
question can be perfectly solvable and still be unusable:

  none             the question is sound and has exactly one defensible answer
  ambiguous        the stem can be read more than one way, and the readings give
                   different answers
  multiple-correct more than one option is defensible, even if one is "better"
  no-correct       none of the options is right
  unanswerable     something needed to answer it is missing

Be strict about multiple-correct. The most common defect in a generated question
is a distractor that is arguably also true. Ask whether a careful student could
argue for it — not whether it is the *best* answer, but whether it could be
defended. If it could, the question is flawed.

Report the answer in the same form the question asks for: an option id for a
multiple choice, a number for a numeric question, an ordering for a sequence.

Show your reasoning. If your answer later disagrees with the author's, the
reasoning is what decides which of you was wrong.`,

  render(input) {
    return `TYPE
${str(input.type)}

QUESTION
${str(input.stem)}

OPTIONS
${str(input.options, '(none — this is not a multiple choice)')}`;
  },
};
