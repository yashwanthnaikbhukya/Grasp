import { describe, expect, it } from 'vitest';
import { PlotSpecSchema } from './viz';

describe('PlotSpecSchema', () => {
  it('accepts a labelled right triangle', () => {
    const r = PlotSpecSchema.safeParse({
      x: [-1, 5],
      y: [-1, 4],
      polygons: [{ points: [[0, 0], [4, 0], [4, 3]], color: 'blue' }],
      segments: [{ from: [0, 0], to: [4, 3], label: 'h = 5' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts sin and cos together', () => {
    expect(
      PlotSpecSchema.safeParse({ functions: [{ fn: 'sin(x)' }, { fn: 'cos(x)', color: 'orange' }] })
        .success,
    ).toBe(true);
  });

  it('rejects an empty plot, a backwards range, and runaway sizes', () => {
    expect(PlotSpecSchema.safeParse({}).success).toBe(false);
    expect(PlotSpecSchema.safeParse({ x: [5, -5], functions: [{ fn: 'x' }] }).success).toBe(false);
    expect(
      PlotSpecSchema.safeParse({ functions: Array.from({ length: 7 }, () => ({ fn: 'x' })) }).success,
    ).toBe(false);
    expect(PlotSpecSchema.safeParse({ points: [{ x: 1e9, y: 0 }] }).success).toBe(false);
  });
});
