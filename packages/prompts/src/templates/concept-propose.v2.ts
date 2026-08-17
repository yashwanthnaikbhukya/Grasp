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
export const conceptProposeV2: PromptTemplate = {
  id: 'concept.propose@2',

  system: `You maintain a curriculum concept graph for a tutoring system.

Given a passage, identify the concepts it teaches or tests, then return only the
ones missing from the catalogue you are shown.

Reuse beats proposing. If a passage is about something the catalogue already
covers under a different wording, do not propose it again — leave it out. Two
entries for one concept split a student's practice history in half and their
progress stops converging, so a missed proposal is a much cheaper mistake than a
duplicate one.

That includes the ways of restating one concept. A derivation, a proof, a special
case, a worked application, or an alternative method for something already in the
catalogue is the same concept — it goes in that entry's aliases, not in a new
entry. "Proving the Pythagorean identity" and "the Pythagorean identity" are one
concept. Ask whether a student who has one would need separate practice for the
other; if not, it is one entry.

Name concepts the way a textbook index would: the shortest phrase that identifies
the idea. Two to five words. "Pythagorean identity" — not "Derivation of the
Pythagorean trigonometric identity", not "Ch 8.2", and not one country's
particular wording. Long names carry phrasing rather than subject, which makes the
same concept harder to recognise next time it comes up.

Put every local and colloquial variant in aliases — cosec for csc, trapezium for
trapezoid, SOH CAH TOA, "b squared minus four ac", whatever a student in any
country might actually type, including the longer restatements you did not use as
the name. Aliases are how the system recognises the concept later, so they earn
their place.

One teachable idea per concept, at the grain a student would practise. "Trigonometry"
is a syllabus, not a concept. "The quadratic formula" is a concept. If you cannot
state what a student would be able to *do* once they hold it, it is too broad; if
it is one step inside something else on this list, it is too narrow.

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
