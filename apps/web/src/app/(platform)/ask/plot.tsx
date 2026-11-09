// biome-ignore-all lint/suspicious/noArrayIndexKey: a plot spec is immutable once parsed — its items never reorder, insert or delete, which is the one case index keys are correct.
'use client';

import { useMemo } from 'react';
import { Circle, Coordinates, Line, Mafs, Plot, Point, Polygon, Text, Theme } from 'mafs';
import 'mafs/core.css';
import { compile } from 'mathjs/number';
import { PlotSpecSchema, type PlotColor, type PlotSpec } from '@grasp/schema';

/**
 * A diagram inside a tutor answer — the body of a ```plot fence.
 *
 * Mafs draws (React-native maths visualisation, built for teaching); mathjs
 * compiles `sin(x)` into a function with its own sandboxed parser — the model's
 * text is never handed to `eval`. The spec is Zod-validated first
 * (`PlotSpecSchema`), so a malformed or oversized plot simply doesn't render.
 *
 * Colours are Mafs theme variables, which globals.css maps onto Grasp's tokens
 * for both themes.
 */

const COLOR: Record<PlotColor, string> = {
  blue: Theme.blue,
  orange: Theme.orange,
  green: Theme.green,
  red: Theme.red,
  violet: Theme.violet,
  ink: Theme.foreground,
};
const CYCLE = [Theme.blue, Theme.orange, Theme.green, Theme.violet, Theme.red];

function compileFn(expr: string): ((x: number) => number) | null {
  try {
    const code = compile(expr);
    const f = (x: number) => {
      const v: unknown = code.evaluate({ x });
      return typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN;
    };
    f(0.5); // an expression that throws on a plain number is not y = f(x)
    return f;
  } catch {
    return null;
  }
}

const centroid = (pts: [number, number][]): [number, number] => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];

function Diagram({ spec }: { spec: PlotSpec }) {
  const fns = useMemo(
    () =>
      spec.functions.map((f, i) => ({
        ...f,
        y: compileFn(f.fn),
        color: f.color ? COLOR[f.color] : (CYCLE[i % CYCLE.length] ?? Theme.blue),
      })),
    [spec.functions],
  );

  // Geometry must not be squashed (a right angle has to look right); a function
  // graph may stretch to fill the frame.
  const geometric =
    spec.polygons.length + spec.segments.length + spec.circles.length > 0 && fns.length === 0;

  return (
    <Mafs
      height={geometric ? 300 : 260}
      viewBox={{ x: spec.x ?? [-5, 5], y: spec.y ?? [-5, 5], padding: 0.4 }}
      preserveAspectRatio={geometric ? 'contain' : false}
      pan
      zoom={{ min: 0.5, max: 4 }}
    >
      <Coordinates.Cartesian />

      {spec.polygons.map((p, i) => (
        <Polygon
          key={`pg${i}`}
          points={p.points}
          color={p.color ? COLOR[p.color] : Theme.blue}
          fillOpacity={0.12}
        />
      ))}
      {spec.polygons.map((p, i) => {
        if (!p.label) return null;
        const [x, y] = centroid(p.points);
        return (
          <Text key={`pgl${i}`} x={x} y={y} size={14}>
            {p.label}
          </Text>
        );
      })}

      {spec.circles.map((c, i) => (
        <Circle
          key={`c${i}`}
          center={c.center}
          radius={c.radius}
          color={c.color ? COLOR[c.color] : Theme.violet}
          fillOpacity={0.06}
        />
      ))}

      {spec.segments.map((s, i) => (
        <Line.Segment
          key={`s${i}`}
          point1={s.from}
          point2={s.to}
          color={s.color ? COLOR[s.color] : Theme.foreground}
        />
      ))}
      {spec.segments.map((s, i) =>
        s.label ? (
          <Text
            key={`sl${i}`}
            x={(s.from[0] + s.to[0]) / 2}
            y={(s.from[1] + s.to[1]) / 2}
            attach="nw"
            size={14}
          >
            {s.label}
          </Text>
        ) : null,
      )}

      {fns.map((f, i) =>
        f.y ? <Plot.OfX key={`f${i}`} y={f.y} color={f.color} weight={2.5} /> : null,
      )}

      {spec.points.map((p, i) => (
        <Point key={`p${i}`} x={p.x} y={p.y} color={p.color ? COLOR[p.color] : Theme.red} />
      ))}
      {spec.points.map((p, i) =>
        p.label ? (
          <Text key={`pl${i}`} x={p.x} y={p.y} attach="ne" size={14}>
            {p.label}
          </Text>
        ) : null,
      )}
    </Mafs>
  );
}

export function PlotBlock({ source, streaming }: { source: string; streaming?: boolean }) {
  const parsed = useMemo(() => {
    try {
      return PlotSpecSchema.safeParse(JSON.parse(source));
    } catch {
      return null;
    }
  }, [source]);

  if (!parsed?.success) {
    // Mid-stream the JSON is still arriving — say so instead of flashing an error.
    // A finished but invalid spec draws nothing; the words around it still teach.
    return streaming ? <div className="plot plot-pending">Drawing a diagram…</div> : null;
  }

  const spec = parsed.data;
  const legend = spec.functions.filter((f) => f.label);

  return (
    <figure className="plot" aria-label={spec.title ?? 'Diagram'}>
      {spec.title && <figcaption className="plot-title">{spec.title}</figcaption>}
      <Diagram spec={spec} />
      {legend.length > 0 && (
        <figcaption className="plot-legend">
          {spec.functions.map((f, i) =>
            f.label ? (
              <span key={i} className="plot-key">
                <span
                  className="plot-swatch"
                  style={{
                    background: f.color ? COLOR[f.color] : (CYCLE[i % CYCLE.length] ?? Theme.blue),
                  }}
                />
                {f.label}
              </span>
            ) : null,
          )}
        </figcaption>
      )}
    </figure>
  );
}
