'use client';

import 'katex/dist/katex.min.css';
import dynamic from 'next/dynamic';
import { memo, type ComponentProps, type ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { prepare } from './markdown-prepare';
// Mafs + mathjs are most of this renderer's weight and only a ```plot fence
// needs them — Reps cards never do. Loaded on first use, not with every page
// that shows Markdown (Reps first-load JS was 378 kB with them bundled).
const PlotBlock = dynamic(() => import('./plot').then((m) => m.PlotBlock), {
  ssr: false,
  loading: () => <div className="plot plot-pending">Drawing a diagram…</div>,
});

/**
 * Tutor and card text → rendered answer.
 *
 * Standard pipeline, not hand-rolled: react-markdown (CommonMark) + remark-gfm
 * (tables, strikethrough, task lists) + remark-math + rehype-katex (typeset maths,
 * with MathML for screen readers). Raw HTML from the model is never rendered.
 *
 * Grasp-specific on top:
 *   - citation markers `[c1]` render as superscript source markers,
 *   - ```plot fences render as diagrams (Mafs — see ./plot.tsx),
 *   - `\( \)` / `\[ \]` are accepted as well as `$ $` / `$$ $$`,
 *   - while streaming, a display formula or diagram that hasn't closed yet is
 *     held back instead of flashing half-parsed.
 */

function components(streaming: boolean): Components {
  return {
    a({ href, children }) {
      if (href?.startsWith('#cite-')) {
        return (
          <sup className="cite" title="From your syllabus">
            {children}
          </sup>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    pre({ children }) {
      // A ```plot fence is a diagram, not code.
      const code = children as ReactElement<ComponentProps<'code'>> | undefined;
      if (code?.props?.className?.includes('language-plot')) {
        return <PlotBlock source={String(code.props.children ?? '')} streaming={streaming} />;
      }
      return <pre>{children}</pre>;
    },
    h1: ({ children }) => <h3 className="md-h">{children}</h3>,
    h2: ({ children }) => <h3 className="md-h">{children}</h3>,
    h3: ({ children }) => <h3 className="md-h">{children}</h3>,
    h4: ({ children }) => <h4 className="md-h md-h4">{children}</h4>,
    table: ({ children }) => (
      <div className="md-table">
        <table>{children}</table>
      </div>
    ),
    hr: () => <hr className="md-hr" />,
  };
}

const STREAMING = components(true);
const SETTLED = components(false);

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        // `throwOnError: false`: a typo in a formula renders red, it doesn't take
        // the answer down. KaTeX's `trust` stays off — no \href / \htmlId markup.
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' }]]}
        components={streaming ? STREAMING : SETTLED}
      >
        {prepare(text, streaming)}
      </ReactMarkdown>
    </div>
  );
});
