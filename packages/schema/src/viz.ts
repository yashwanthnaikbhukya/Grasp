import { z } from 'zod';

/**
 * A diagram the tutor can draw inside an answer — a ```plot fenced block whose
 * body is this JSON. Rendered with Mafs; function expressions are compiled with
 * mathjs (a parser, never `eval`), so a model can draw but cannot run code.
 *
 * Deliberately small: graphs of y = f(x), points, segments and polygons cover
 * what secondary maths needs — a triangle with labelled sides, the unit circle,
 * sin against cos. Bounds keep a malformed spec from becoming a heavy render.
 */

const Num = z.number().finite().min(-1_000).max(1_000);
const Pair = z.tuple([Num, Num]);
const Range = z
  .tuple([Num, Num])
  .refine(([a, b]) => b > a, 'range must be [min, max] with max > min');
const Label = z.string().trim().max(40);

export const PlotColor = z.enum(['blue', 'orange', 'green', 'red', 'violet', 'ink']);
export type PlotColor = z.infer<typeof PlotColor>;

export const PlotSpecSchema = z
  .object({
    title: z.string().trim().max(80).optional(),
    /** Visible window. Defaults to [-5, 5] on both axes. */
    x: Range.optional(),
    y: Range.optional(),
    /** y = f(x), in mathjs syntax: `sin(x)`, `x^2 - 1`, `sqrt(1 - x^2)`. */
    functions: z
      .array(
        z.object({
          fn: z.string().trim().min(1).max(120),
          label: Label.optional(),
          color: PlotColor.optional(),
        }),
      )
      .max(6)
      .default([]),
    points: z
      .array(z.object({ x: Num, y: Num, label: Label.optional(), color: PlotColor.optional() }))
      .max(24)
      .default([]),
    segments: z
      .array(
        z.object({
          from: Pair,
          to: Pair,
          label: Label.optional(),
          color: PlotColor.optional(),
        }),
      )
      .max(24)
      .default([]),
    polygons: z
      .array(
        z.object({
          points: z.array(Pair).min(3).max(12),
          label: Label.optional(),
          color: PlotColor.optional(),
        }),
      )
      .max(6)
      .default([]),
    circles: z
      .array(
        z.object({
          center: Pair,
          radius: z.number().positive().max(1_000),
          color: PlotColor.optional(),
        }),
      )
      .max(6)
      .default([]),
  })
  .refine(
    (s) =>
      s.functions.length + s.points.length + s.segments.length + s.polygons.length + s.circles.length >
      0,
    'a plot needs at least one thing to draw',
  );
export type PlotSpec = z.infer<typeof PlotSpecSchema>;
