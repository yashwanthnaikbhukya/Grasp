import type { PromptTemplate } from '../types';
import { ANSWER, COACH, render, TEACH } from './tutor-modes.v1';
import { DIALOGUE_V2 } from './tutor-modes.v2';

/**
 * `tutor.answer@3`, `tutor.teach@3`, `tutor.coach@3` — v2 plus one GROUNDING
 * rule, and nothing else.
 *
 * Why: asked "what is photosynthesis" with six unrelated trigonometry passages
 * in context, v2 cited one for a biology fact and told the student "we are
 * looking at your mathematics syllabus — continue with trigonometry or switch to
 * biology?" (2026-11-09). The broker now drops unrelated passages
 * (context/relevance.ts); this rule is the second line for the ones that slip
 * through.
 */
const RELEVANCE_RULE = `The retrieved material is search results from the student's study material, and some or all of it may not be about this question. Use only passages that actually answer it and ignore the rest — do not mention them, and never steer the student toward another topic because of them. Cite a passage only for a claim it actually supports. When nothing relevant was retrieved, just answer the question.`;

const DIALOGUE = DIALOGUE_V2.replace(
  'never imply the textbook said it.',
  `never imply the textbook said it.\n${RELEVANCE_RULE}`,
);

export const tutorAnswerV3: PromptTemplate = {
  id: 'tutor.answer@3',
  system: `${DIALOGUE}\n\n${ANSWER}`,
  render,
};

export const tutorTeachV3: PromptTemplate = {
  id: 'tutor.teach@3',
  system: `${DIALOGUE}\n\n${TEACH}`,
  render,
};

export const tutorCoachV3: PromptTemplate = {
  id: 'tutor.coach@3',
  system: `${DIALOGUE}\n\n${COACH}`,
  render,
};
