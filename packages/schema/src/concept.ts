import { z } from 'zod';
import { ConceptId } from './common';
import { StageRange } from './stage';

/**
 * A node in the **universal** concept graph — curriculum-free.
 *
 * `pythagorean-identity` requires `pythagoras-theorem` in every curriculum on
 * earth. So the graph is authored once and curricula are overlays on it
 * (docs/adr/0006-curriculum-agnostic-concepts.md). This is what makes the second
 * curriculum cost a fraction of the first.
 *
 * `prereqIds` is the expensive artifact and the part models get wrong. Author it
 * by hand with a model as a drafting assistant; it drives frontier gating (never
 * drill a learner on something they cannot yet do) and upstream gap detection.
 */
export const ConceptSchema = z.object({
  _id: ConceptId,

  /**
   * Canonical international-English name. Local variants live in `aliases` and in
   * `curriculumMappings.localName`.
   */
  name: z.string().min(1),

  /**
   * Every local and colloquial variant — `cosec`, `co-secant`, `SOH CAH TOA`.
   *
   * Aliases do real work now: they feed both retrieval recall and concept
   * tagging across curricula, so this cannot be an afterthought.
   */
  aliases: z.array(z.string()).default([]),

  /** Universal subject, not a curriculum's name for it: `mathematics`, `physics`. */
  subject: z.string().min(1),
  /** Broad universal grouping, e.g. `trigonometry`. Not a curriculum chapter. */
  domain: z.string().default(''),

  /** Edges of the DAG. Must reference existing concept ids. */
  prereqIds: z.array(ConceptId).default([]),

  description: z.string().default(''),
  /** Card generation targets these individually. */
  objectives: z.array(z.string()).default([]),

  /**
   * Typical stage band where this is taught. **Advisory** — used to rank and to
   * caveat, never to refuse. A learner reaching ahead of their syllabus is the
   * best signal they can send.
   */
  stageRange: StageRange.nullable().default(null),

  /** Topological depth, computed by the loader. */
  depth: z.number().int().min(0).default(0),
});
export type Concept = z.infer<typeof ConceptSchema>;

/** Shape of `data/concepts.seed.json`. */
export const ConceptSeedSchema = z.object({
  /** Universal subject this seed file covers. */
  subject: z.string().min(1),
  concepts: z.array(
    ConceptSchema.omit({ subject: true, depth: true }).extend({
      subject: z.string().optional(),
      depth: z.number().int().min(0).optional(),
    }),
  ),
});
export type ConceptSeed = z.infer<typeof ConceptSeedSchema>;
