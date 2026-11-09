import { normalizeCitations } from '@grasp/schema/citations';

/**
 * Text preparation for the Markdown renderer — pure, so it is unit-tested
 * (markdown-prepare.test.ts) apart from React.
 */

/** Pull `[cN]` out of maths — inside TeX it would print as literal brackets. */
function liftCitesOutOfMath(text: string): string {
  return text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (math) => {
    const cites = math.match(/\[c\d+\]/g);
    if (!cites) return math;
    return `${math.replace(/\s*\[c\d+\]/g, '')} ${cites.join(' ')}`;
  });
}

/**
 * While streaming, drop an unclosed trailing formula — a `$$` block or an inline
 * `$…` — so KaTeX never sees half of one and raw `\frac{1` never flashes up.
 * It appears whole the moment its closing `$` arrives.
 */
function holdBackOpenMath(text: string): string {
  const opens = text.match(/\$\$/g)?.length ?? 0;
  if (opens % 2 === 1) return text.slice(0, text.lastIndexOf('$$'));
  const singles: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$') continue;
    if (text[i + 1] === '$') {
      i++;
      continue;
    }
    if (text[i - 1] !== '\\') singles.push(i);
  }
  if (singles.length % 2 === 0) return text;
  return text.slice(0, singles[singles.length - 1]);
}

/** Function names TeX sets upright — but only when written with a backslash. */
const FUNCTION_NAMES = /(?<![\\a-zA-Z])(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|log|ln|exp)(?![a-zA-Z])/g;
/** Groups whose contents are text, not maths: `\sin` inside them is an error. */
const TEXT_GROUP = /(\\(?:text|textbf|textit|mathrm|operatorname)\{[^{}]*\})/;

/**
 * Generated text often writes `$sin\theta$`, which TeX reads as the product
 * s·i·n·θ and sets in italics. Add the backslash, outside text groups, so it
 * reads as the function (found on a practice card in the 2026-11-09 test pass).
 */
function uprightFunctionNames(text: string): string {
  return text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (math) =>
    math
      .split(TEXT_GROUP)
      .map((part, i) => (i % 2 === 1 ? part : part.replace(FUNCTION_NAMES, '\\$1')))
      .join(''),
  );
}

export function prepare(text: string, streaming: boolean): string {
  // `【c1】` → `[c1]` first: streamed text has not been through the server's pass.
  let t = normalizeCitations(text)
    // remark-math reads dollar delimiters only.
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`);
  t = uprightFunctionNames(t);
  // "[c3, c6]" → "[c3] [c6]": models group citations; each is its own marker.
  t = t.replace(/\[(c\d+(?:\s*,\s*c\d+)+)\]/g, (_, ids: string) =>
    ids
      .split(',')
      .map((id) => `[${id.trim()}]`)
      .join(' '),
  );
  t = liftCitesOutOfMath(t);
  // Citation markers become fragment links, rendered as <sup> below. Not when
  // already a link ("[c1](…)").
  t = t.replace(/\[(c\d+)\](?!\()/g, '[$1](#cite-$1)');
  return streaming ? holdBackOpenMath(t) : t;
}
