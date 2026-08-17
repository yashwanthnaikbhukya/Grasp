'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * A small Markdown + maths renderer.
 *
 * Deliberately hand-rolled rather than pulling in a parser plus KaTeX: the tutor
 * emits a narrow, known subset — headings, bold, italic, inline code, fenced
 * code, lists, LaTeX and citation markers — and this streams safely token by
 * token, which most parsers do not (they see half-open syntax on every frame and
 * flicker).
 *
 * Maths renders as styled source rather than typeset output. Honest and legible;
 * proper KaTeX is a Phase 1 polish item, and swapping it in touches only
 * `renderMath` below.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass over the alternatives, so nesting cannot produce overlapping
  // matches from separate regexes run in sequence.
  const pattern =
    /(\$\$[^$]+\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[c\d+\])/g;

  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith('$$') || token.startsWith('$')) {
      out.push(
        <code className="math" key={key}>
          {token.replace(/^\$+|\$+$/g, '')}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`')) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      // Citation marker — the affordance that makes grounding visible.
      out.push(
        <sup className="cite" key={key} title="From your syllabus">
          {token.slice(1, -1)}
        </sup>,
      );
    }
    last = match.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');

  let listBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;
  let key = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={`ul-${key++}`}>
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  const flushCode = () => {
    if (codeBuffer.length === 0) return;
    blocks.push(<pre key={`pre-${key++}`}>{codeBuffer.join('\n')}</pre>);
    codeBuffer = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    const listItem = /^\s*[-*+]\s+(.*)$/.exec(line) ?? /^\s*\d+\.\s+(.*)$/.exec(line);
    if (listItem?.[1] !== undefined) {
      listBuffer.push(listItem[1]);
      continue;
    }
    flushList();

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading?.[2]) {
      blocks.push(
        <h3 key={`h-${key++}`} className="md-h">
          {renderInline(heading[2], `h-${key}`)}
        </h3>,
      );
      continue;
    }

    if (!line.trim()) continue;
    blocks.push(<p key={`p-${key++}`}>{renderInline(line, `p-${key}`)}</p>);
  }

  flushList();
  // An unterminated fence is normal mid-stream — render what has arrived.
  flushCode();

  return <Fragment>{blocks}</Fragment>;
}
