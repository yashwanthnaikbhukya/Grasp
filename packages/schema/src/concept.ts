import { z } from 'zod';
import { ConceptId } from './common';

/**
 * A node in the curriculum graph — the atomic unit of knowledge in Grasp.
 *
 * Authored by hand from the syllabus, not generated. `prereqIds` is the part
 * models get wrong and the part that has to be right: it drives frontier gating
 * (never drill a learner on something they can't yet do) and upstream gap
 * detection. See docs/07-phases.md#02-author-the-concept-graph.
 */
export const ConceptSchema = z.object({
  _id: ConceptId,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),

  board: z.string(),
  grade: z.string(),
  subject: z.string(),
  chapter: z.string().optional(),

  /** Edges of the DAG. Must reference existing concept ids. */
  prereqIds: z.array(ConceptId).default([]),

  /** One paragraph. Used as context when tagging content to this concept. */
  description: z.string().default(''),

  /** Learning objectives — card generation targets these individually. */
  objectives: z.array(z.string()).default([]),

  /** Topological depth, denormalized. Used for ordering and placement search. */
  depth: z.number().int().min(0).default(0),
});
export type Concept = z.infer<typeof ConceptSchema>;

/** Shape of `data/concepts.seed.json`. */
export const ConceptSeedSchema = z.object({
  scope: z.object({ board: z.string(), grade: z.string(), subject: z.string() }),
  concepts: z.array(
    ConceptSchema.omit({ board: true, grade: true, subject: true, depth: true }).extend({
      depth: z.number().int().min(0).optional(),
    }),
  ),
});
export type ConceptSeed = z.infer<typeof ConceptSeedSchema>;
