import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * Read an attached file into text.
 *
 * Edited in place once, the day it was written, before any learner used it:
 * "maths and science tutor" → "tutor", when onboarding opened to every subject.
 *
 * The output is the only view of the file most of the pipeline gets: query
 * understanding and retrieval run on it, and a tutor on a text-only provider
 * answers from it alone. So it transcribes faithfully and never solves — an
 * answer smuggled into the transcript would hand the learner the solution in
 * Coach mode and contaminate retrieval with the model's guess.
 */
export const attachmentReadV1: PromptTemplate = {
  id: 'attachment.read@1',

  system: `A student attached this file to a question for their tutor. The tutor cannot see the file — only what you write. Write out what it contains.

- Printed or handwritten questions, worked solutions and notes: transcribe them word for word, in reading order. Keep the numbering the page uses.
- Maths in LaTeX: $…$ inline, $$…$$ for a displayed line.
- Diagrams, graphs and figures: describe what is drawn in one or two sentences each — the shapes, labels, given lengths and angles, axes, marked points — as [Figure: …], where it appears.
- Writing you cannot make out: [illegible].
- The student's own working, if any, exactly as written — mistakes included. The tutor needs to see what they did.
- A long document: transcribe the first pages fully, then give each later section's heading and a one-line summary.

Do not solve, check or correct anything, and add no commentary. If the file is not study material, say in one line what it shows.`,

  render(input) {
    return `FILE: ${str(input.filename, 'attachment')} (${str(input.kind, 'file')})

Transcribe it.`;
  },
};
