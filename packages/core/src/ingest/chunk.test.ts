import { describe, expect, it } from 'vitest';
import { chunkForEmbedding, chunkMarkdown, estimateTokens, splitSentences } from './chunk';

/**
 * Chunk quality caps retrieval quality, which caps the tutor. The failures here
 * are silent — a chunk split through a worked example produces an answer that
 * confidently omits the step that mattered — so they get tested rather than
 * eyeballed.
 */

describe('splitSentences', () => {
  it('splits ordinary prose', () => {
    expect(splitSentences('One thing. Then another. And a third.')).toEqual([
      'One thing.',
      'Then another.',
      'And a third.',
    ]);
  });

  it('does not split inside inline maths', () => {
    // A naive split on '.' destroys every decimal in the corpus.
    const out = splitSentences('We know $\\sin 30 = 0.5$ exactly. That is useful.');
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('0.5');
  });

  it('does not split inside display maths', () => {
    const out = splitSentences('Start here. $$a. b. c.$$ Then finish.');
    expect(out).toHaveLength(3);
    expect(out[1]).toBe('$$a. b. c.$$');
  });

  it('keeps decimals intact', () => {
    expect(splitSentences('The value 3.14159 appears often.')).toHaveLength(1);
  });
});

describe('estimateTokens', () => {
  it('scales with length', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(estimateTokens('a'.repeat(40)));
  });

  it('rates maths denser than prose of the same length', () => {
    // Under-estimating would silently overflow the model's context window, so
    // the bias must run toward over-estimating.
    const prose = 'the quick brown fox jumped over the lazy dog again and again';
    const maths = '$\\frac{a^2+b^2}{c^2} = \\sum_{i=1}^{n}(x_i-\\mu)^2 / \\sigma^2$';
    expect(estimateTokens(maths) / maths.length).toBeGreaterThan(
      estimateTokens(prose) / prose.length,
    );
  });
});

describe('chunkMarkdown', () => {
  const doc = `# Trigonometry

Intro paragraph about angles.

## 8.1 Ratios

Sine is opposite over hypotenuse. Cosine is adjacent over hypotenuse.

## 8.2 Identities

Applying Pythagoras gives the first identity.

### Derivation

Divide through by $\\cos^2\\theta$ to get the second.`;

  it('carries the heading path on every chunk', () => {
    const chunks = chunkMarkdown(doc);
    expect(chunks.length).toBeGreaterThan(0);
    const ratios = chunks.find((c) => c.text.includes('Sine is opposite'));
    expect(ratios?.headingPath).toEqual(['Trigonometry', '8.1 Ratios']);
  });

  it('nests heading paths by level', () => {
    const chunks = chunkMarkdown(doc);
    const derivation = chunks.find((c) => c.text.includes('Divide through'));
    expect(derivation?.headingPath).toEqual(['Trigonometry', '8.2 Identities', 'Derivation']);
  });

  it('pops back out when a heading level rises', () => {
    const chunks = chunkMarkdown(doc);
    const identities = chunks.find((c) => c.text.includes('Applying Pythagoras'));
    // Must not still be nested under 8.1.
    expect(identities?.headingPath).toEqual(['Trigonometry', '8.2 Identities']);
  });

  it('never emits an empty chunk', () => {
    const chunks = chunkMarkdown('# A\n\n\n\n## B\n\n\n');
    expect(chunks.every((c) => c.text.trim().length > 0)).toBe(true);
  });

  it('assigns stable increasing ordinals', () => {
    const chunks = chunkMarkdown(doc);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it('keeps a fenced code block whole despite blank lines inside', () => {
    const withCode = `# Code

Before.

\`\`\`python
x = 1

y = 2
\`\`\`

After.`;
    const chunks = chunkMarkdown(withCode);
    const withFence = chunks.find((c) => c.text.includes('```python'));
    expect(withFence?.text).toContain('y = 2');
    expect(withFence?.text.match(/```/g)).toHaveLength(2);
  });

  it('keeps a display-maths block whole despite blank lines inside', () => {
    const withMath = `# Maths

Consider:

$$
a^2 + b^2

= c^2
$$

Therefore it holds.`;
    const chunks = chunkMarkdown(withMath);
    const mathChunk = chunks.find((c) => c.text.includes('a^2 + b^2'));
    expect(mathChunk?.text).toContain('= c^2');
  });

  it('splits an over-long paragraph on sentences rather than emitting it whole', () => {
    const long = `# Long\n\n${'This is a sentence about triangles. '.repeat(200)}`;
    const chunks = chunkMarkdown(long, { targetTokens: 100, maxTokens: 150 });
    expect(chunks.length).toBeGreaterThan(3);
    // Every chunk should end at a sentence boundary, not mid-word.
    for (const c of chunks) expect(c.text.trim()).toMatch(/[.!?]$/);
  });

  it('respects the target size for ordinary content', () => {
    const many = `# T\n\n${Array.from({ length: 40 }, (_, i) => `Paragraph number ${i} with some words in it.`).join('\n\n')}`;
    const chunks = chunkMarkdown(many, { targetTokens: 100, maxTokens: 200 });
    // Allow the overlap tail to push slightly past target.
    for (const c of chunks) expect(c.tokenCount).toBeLessThan(200);
  });

  it('overlaps adjacent chunks so a boundary fact stays reachable', () => {
    const many = `# T\n\n${Array.from({ length: 30 }, (_, i) => `Sentence ${i} carries a distinct fact.`).join('\n\n')}`;
    const chunks = chunkMarkdown(many, { targetTokens: 60, maxTokens: 120, overlapSentences: 1 });
    expect(chunks.length).toBeGreaterThan(2);
    const first = chunks[0]!;
    const second = chunks[1]!;
    const tail = first.text.trim().split('\n\n').pop() ?? '';
    expect(second.text).toContain(tail);
  });

  it('handles a document with no headings at all', () => {
    const chunks = chunkMarkdown('Just some text with no structure whatsoever.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toEqual([]);
  });
});

describe('chunkForEmbedding', () => {
  it('prepends the heading path', () => {
    const [chunk] = chunkMarkdown('# A\n\n## B\n\nBody text here.');
    const embedded = chunkForEmbedding(chunk!);
    expect(embedded.startsWith('A › B')).toBe(true);
    expect(embedded).toContain('Body text here.');
  });

  it('omits the separator when there is no path', () => {
    const [chunk] = chunkMarkdown('Body only.');
    expect(chunkForEmbedding(chunk!)).toBe('Body only.');
  });
});
