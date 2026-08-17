/**
 * Chunking.
 *
 * Chunk quality caps retrieval quality, which caps the whole tutor. It is the
 * least glamorous file here and the one most worth getting right — a chunk that
 * splits a worked example down the middle produces an answer that confidently
 * omits the step that mattered.
 *
 * Three rules, in priority order:
 *   1. Never split mid-sentence, and never split a display equation.
 *   2. Keep the heading path — a chunk that says "substitute this into (4)" is
 *      useless without knowing which section it came from.
 *   3. Overlap slightly, so a fact sitting on a boundary is retrievable from
 *      either side.
 *
 * Layout-naive by design (ADR 0002): Markdown and plain text now, layout-aware
 * PDF parsing when the Python service lands in Phase 3.
 */

export interface Chunk {
  text: string;
  /** e.g. ["Trigonometry", "8.2 Identities"] — prepended at prompt assembly. */
  headingPath: string[];
  /** Rough token count. Used by the broker's budget allocator. */
  tokenCount: number;
  /** Index within the source, for stable ordering and debugging. */
  ordinal: number;
}

export interface ChunkOptions {
  /** Target size. ~400 tokens is a good default for retrieval granularity. */
  targetTokens?: number;
  /** Hard ceiling — a section longer than this is split regardless. */
  maxTokens?: number;
  /** Sentences of overlap between adjacent chunks. */
  overlapSentences?: number;
}

/**
 * Token estimate without a tokenizer dependency.
 *
 * ~4 chars per token holds for English prose. Maths runs denser — more symbols
 * per token — so LaTeX-heavy spans are nudged up. The broker budgets on this, so
 * under-estimating would silently overflow the context window; the bias is
 * deliberately toward over-estimating.
 */
export function estimateTokens(text: string): number {
  const base = text.length / 4;
  const mathDensity = (text.match(/[\\${}^_=+\-*/()[\]]/g) ?? []).length / Math.max(text.length, 1);
  const multiplier = 1 + Math.min(mathDensity * 2, 0.6);
  return Math.ceil(base * multiplier);
}

/** Markdown ATX heading (`## Title`) → level and text. */
function parseHeading(line: string): { level: number; text: string } | null {
  const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
  if (!m?.[1] || !m[2]) return null;
  return { level: m[1].length, text: m[2].trim() };
}

/**
 * Split into sentences without breaking maths.
 *
 * A naive split on `.` destroys `0.5`, `Fig. 3`, and any display equation
 * containing a period. Display maths is masked out before splitting and restored
 * after, which is cheaper and more reliable than trying to write one regex that
 * understands both.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];

  /**
   * Inline maths is masked before splitting, so a decimal point or "Fig. 3"
   * cannot be mistaken for a sentence end.
   */
  const proseSentences = (segment: string): string[] => {
    if (!segment.trim()) return [];

    const masked: string[] = [];
    const withPlaceholders = segment.replace(/\$[^$\n]+\$/g, (m) => {
      masked.push(m);
      return ' \u0000' + String(masked.length - 1) + '\u0000 ';
    });

    return withPlaceholders
      .split(/(?<=[.!?])\s+(?=[A-Z(["\'])/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) =>
        s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => masked[Number(i)] ?? ''),
      );
  };

  // Display maths is its own unit. Treating it as one lets the chunker break
  // cleanly before or after an equation, instead of dragging the sentence that
  // follows it along for the ride.
  const displayRe = /\$\$[\s\S]*?\$\$/g;
  let cursor = 0;

  for (const match of text.matchAll(displayRe)) {
    const start = match.index ?? 0;
    out.push(...proseSentences(text.slice(cursor, start)));
    out.push(match[0].trim());
    cursor = start + match[0].length;
  }
  out.push(...proseSentences(text.slice(cursor)));

  return out.filter(Boolean);
}

interface Block {
  headingPath: string[];
  lines: string[];
}

/** Group lines into blocks under their heading path. */
function blocksFrom(markdown: string): Block[] {
  const blocks: Block[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: Block = { headingPath: [], lines: [] };

  for (const line of markdown.split('\n')) {
    const heading = parseHeading(line);
    if (!heading) {
      current.lines.push(line);
      continue;
    }

    if (current.lines.some((l) => l.trim())) blocks.push(current);

    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
    current = { headingPath: stack.map((h) => h.text), lines: [] };
  }

  if (current.lines.some((l) => l.trim())) blocks.push(current);
  return blocks;
}

/**
 * Paragraphs, keeping fenced code and display maths intact.
 *
 * A blank line inside a ```fence or a $$block$$ is not a paragraph break, and
 * treating it as one is how a solution gets cut in half.
 */
function paragraphsFrom(lines: string[]): string[] {
  const paras: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  let inDisplayMath = false;

  const flush = () => {
    const joined = buf.join('\n').trim();
    if (joined) paras.push(joined);
    buf = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const dollarCount = (line.match(/\$\$/g) ?? []).length;
    if (dollarCount % 2 === 1) inDisplayMath = !inDisplayMath;

    if (!line.trim() && !inFence && !inDisplayMath) {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return paras;
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? 400;
  const max = opts.maxTokens ?? 700;
  const overlap = opts.overlapSentences ?? 1;

  const chunks: Chunk[] = [];
  let ordinal = 0;

  const push = (text: string, headingPath: string[]) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    chunks.push({
      text: trimmed,
      headingPath: [...headingPath],
      tokenCount: estimateTokens(trimmed),
      ordinal: ordinal++,
    });
  };

  for (const block of blocksFrom(markdown)) {
    const paragraphs = paragraphsFrom(block.lines);
    let buf: string[] = [];
    let bufTokens = 0;

    const flush = () => {
      if (buf.length === 0) return;
      push(buf.join('\n\n'), block.headingPath);
      // Carry the tail sentences forward so a boundary fact stays reachable
      // from the next chunk too.
      const last = buf[buf.length - 1] ?? '';
      const tail = splitSentences(last).slice(-overlap);
      buf = overlap > 0 && tail.length > 0 ? [tail.join(' ')] : [];
      bufTokens = buf.reduce((n, p) => n + estimateTokens(p), 0);
    };

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para);

      // A single paragraph over the ceiling is split on sentences rather than
      // being emitted whole and blowing the budget downstream.
      if (paraTokens > max) {
        flush();
        let sentBuf: string[] = [];
        let sentTokens = 0;
        for (const sentence of splitSentences(para)) {
          const t = estimateTokens(sentence);
          if (sentTokens + t > target && sentBuf.length > 0) {
            push(sentBuf.join(' '), block.headingPath);
            sentBuf = sentBuf.slice(-overlap);
            sentTokens = sentBuf.reduce((n, s) => n + estimateTokens(s), 0);
          }
          sentBuf.push(sentence);
          sentTokens += t;
        }
        if (sentBuf.length > 0) push(sentBuf.join(' '), block.headingPath);
        continue;
      }

      if (bufTokens + paraTokens > target && buf.length > 0) flush();
      buf.push(para);
      bufTokens += paraTokens;
    }

    if (buf.length > 0) push(buf.join('\n\n'), block.headingPath);
  }

  return chunks;
}

/**
 * The retrievable form: heading path prepended so the model always knows where a
 * span came from. Measurably improves grounding for a handful of tokens.
 */
export function chunkForEmbedding(chunk: Chunk): string {
  const path = chunk.headingPath.length > 0 ? `${chunk.headingPath.join(' › ')}\n\n` : '';
  return `${path}${chunk.text}`;
}
