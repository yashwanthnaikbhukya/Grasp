import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * The model authoring graph nodes it has decided are missing.
 * See docs/adr/0007-llm-authored-concept-graph.md.
 *
 * The single most important instruction here is to reuse an existing concept
 * rather than propose a near-duplicate. Duplicates are the failure this whole
 * mechanism exists to prevent: they split a learner's evidence across two rows
 * and quietly stop mastery from ever converging.
 */
export const conceptProposeV1: PromptTemplate = {
  id: 'concept.propose@1',

  system: `You maintain a curriculum concept graph for a tutoring system.

Given a passage, identify the concepts it teaches or tests, then return only the
ones missing from the catalogue you are shown.

Reuse beats proposing. If a passage is about something the catalogue already
covers under a different wording, do not propose it again — leave it out. Two
entries for one concept split a student's practice history in half and their
progress stops converging, so a missed proposal is a much cheaper mistake than a
duplicate one.

Name concepts canonically and internationally. "Pythagorean identity", not
"Ch 8.2" and not one country's textbook wording. Put every local and colloquial
variant in aliases instead — cosec for csc, trapezium for trapezoid, SOH CAH TOA,
whatever a student in any country might actually type. Aliases are how the system
recognises the concept later, so they earn their place.

One teachable idea per concept. "Trigonometry" is a syllabus, not a concept.
"Deriving sin²θ + cos²θ = 1 from the unit circle" is one. If you cannot state what
a student would be able to *do* once they hold it, it is too broad.

Prerequisites are hard dependencies only: things a student must already hold for
this to make any sense at all. Not things that are merely useful, not things
usually taught earlier. Give them as names — you do not know the system's ids, and
they will be matched to the catalogue for you. Prefer prerequisites that already
appear in the catalogue.

stageMin and stageMax bracket where this typically sits on a normalized ladder
where 1 is the first year of school and 12 is the last, so 10 covers Class 10 in
India, Grade 10 in the US, and Year 11 in the UK. Anything post-secondary is 13.
It is advisory, so a wide band is fine when a concept genuinely spans years.

Propose nothing at all if the passage introduces nothing new. An empty result is a
correct and useful answer.`,

  render(input) {
    return `SUBJECT
${str(input.subject)}

CATALOGUE — concepts already in the graph. Reuse these; do not re-propose them.
${str(input.knownConcepts, '(empty)')}

PASSAGE
${str(input.text)}`;
  },
};
