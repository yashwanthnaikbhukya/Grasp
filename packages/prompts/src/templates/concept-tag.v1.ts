import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * Concept tagging is the interop layer — it is what lets a doubt asked in Ask
 * become a card in Reps tomorrow. Tag quality caps the whole platform's
 * personalization, so this runs over every ingested chunk.
 */
export const conceptTagV1: PromptTemplate = {
  id: 'concept.tag@1',

  system: `You tag a passage of study material with the curriculum concepts it
teaches or tests.

Tag what the passage is *about*, not everything it mentions in passing. A
worked example that applies the quadratic formula while solving a projectile
problem is about projectile motion; the formula is machinery, not the subject.

Prefer one or two precise tags. Six loose tags are worse than one right one,
because these tags decide what a student gets shown next.

Use only ids from the catalogue. If nothing in it fits, return an empty list —
that is a useful answer and the passage will be handled another way. Do not
invent ids or approximate a near-match.

Set confidence honestly. Below 0.5 means "this is a guess", and low-confidence
tags are kept out of retrieval boosting, so an honest low score costs nothing.`,

  render(input) {
    return `CONCEPT CATALOGUE
${str(input.conceptCatalog, '(none supplied)')}

PASSAGE LOCATION
${str(input.headingPath, '(unknown)')}

PASSAGE
${str(input.text)}`;
  },
};
