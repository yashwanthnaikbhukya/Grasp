import { describe, expect, it } from 'vitest';
import {
  computeDepth,
  cosine,
  knownConceptIds,
  normalizeAlias,
  slugify,
  uniqueSlug,
  wouldCycle,
} from './resolve';

/**
 * The pure half of concept resolution. These decide whether a learner's evidence
 * accumulates under one id or splits across two, which is the failure
 * docs/adr/0007-llm-authored-concept-graph.md exists to prevent.
 */

describe('slugify', () => {
  it('produces readable kebab-case ids', () => {
    // Readable on purpose — ids show up in traces, prompts and logs.
    expect(slugify('Pythagorean identity')).toBe('pythagorean-identity');
    expect(slugify('  Angles of Elevation & Depression  ')).toBe('angles-of-elevation-depression');
  });

  it('folds superscripts to digits rather than dropping them', () => {
    // NFKD turns ² into 2, which is what we want: it keeps the exponent, so
    // sin²x and sin x cannot collapse onto the same id.
    expect(slugify('The identity sin²θ + cos²θ = 1')).toBe('the-identity-sin2-cos2-1');
    expect(slugify('1 + tan²x = sec²x')).toBe('1-tan2x-sec2x');
  });

  it('strips accents rather than dropping the word', () => {
    expect(slugify('Théorème de Pythagore')).toBe('theoreme-de-pythagore');
  });

  it('never returns an empty or edge-dashed id', () => {
    expect(slugify('!!!')).toBe('concept');
    expect(slugify('')).toBe('concept');
    expect(slugify('---x---')).toBe('x');
    expect(slugify('a'.repeat(200)).endsWith('-')).toBe(false);
  });

  it('matches the ConceptId pattern the schema enforces', () => {
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const name of [
      'Pythagorean identity',
      '1 + tan²x = sec²x',
      'Héights & Distances (two triangles)',
      '   ',
      'ÜBER-complex   NAME!!',
    ]) {
      expect(pattern.test(slugify(name)), name).toBe(true);
    }
  });
});

describe('uniqueSlug', () => {
  it('returns the plain slug when free', () => {
    expect(uniqueSlug('Mean', new Set())).toBe('mean');
  });

  it('suffixes only on genuine collision', () => {
    expect(uniqueSlug('Mean', new Set(['mean']))).toBe('mean-2');
    expect(uniqueSlug('Mean', new Set(['mean', 'mean-2']))).toBe('mean-3');
  });

  it('still yields a schema-valid id under collision', () => {
    const taken = new Set(['mean']);
    expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(uniqueSlug('Mean', taken))).toBe(true);
  });
});

describe('normalizeAlias', () => {
  it('makes the exact-match fast path robust to formatting', () => {
    // This path is higher precision than any similarity score, so it must catch
    // the trivial variations rather than falling through to cosine.
    expect(normalizeAlias('SOH CAH TOA')).toBe(normalizeAlias('soh-cah-toa'));
    expect(normalizeAlias('cosec')).toBe(normalizeAlias('  Cosec  '));
    expect(normalizeAlias('sin²θ+cos²θ=1')).toBe(normalizeAlias('sin²θ + cos²θ = 1'));
  });

  it('keeps genuinely different names apart', () => {
    expect(normalizeAlias('mean')).not.toBe(normalizeAlias('median'));
  });
});

describe('cosine', () => {
  it('is 1 for identical and 0 for orthogonal', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it('is scale-invariant', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  it('returns 0 rather than NaN on degenerate input', () => {
    // A concept row with no embedding must not poison the nearest-neighbour scan.
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('wouldCycle', () => {
  const edges = new Map<string, string[]>([
    ['trig-ratios', ['right-triangle-basics']],
    ['pythagorean-identity', ['trig-ratios', 'pythagoras-theorem']],
    ['pythagoras-theorem', ['right-triangle-basics']],
    ['right-triangle-basics', []],
  ]);

  it('rejects self-dependency', () => {
    expect(wouldCycle(edges, 'trig-ratios', 'trig-ratios')).toBe(true);
  });

  it('rejects a direct back-edge', () => {
    // trig-ratios already requires right-triangle-basics.
    expect(wouldCycle(edges, 'right-triangle-basics', 'trig-ratios')).toBe(true);
  });

  it('rejects an indirect back-edge', () => {
    // pythagorean-identity → trig-ratios → right-triangle-basics
    expect(wouldCycle(edges, 'right-triangle-basics', 'pythagorean-identity')).toBe(true);
  });

  it('allows a legitimate new edge', () => {
    expect(wouldCycle(edges, 'pythagorean-identity', 'right-triangle-basics')).toBe(false);
  });

  it('terminates on an already-cyclic graph rather than hanging', () => {
    // Defensive: a cycle should never be persisted, but the walk must not spin
    // if one somehow is.
    const bad = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    expect(wouldCycle(bad, 'c', 'a')).toBe(false);
  });
});

describe('computeDepth', () => {
  const edges = new Map<string, string[]>([
    ['right-triangle-basics', []],
    ['pythagoras-theorem', ['right-triangle-basics']],
    ['trig-ratios', ['right-triangle-basics']],
    ['pythagorean-identity', ['trig-ratios', 'pythagoras-theorem']],
    ['trig-simplification', ['pythagorean-identity']],
  ]);

  it('is 0 at a root and counts the longest chain', () => {
    expect(computeDepth(edges, 'right-triangle-basics')).toBe(0);
    expect(computeDepth(edges, 'trig-ratios')).toBe(1);
    expect(computeDepth(edges, 'pythagorean-identity')).toBe(2);
    expect(computeDepth(edges, 'trig-simplification')).toBe(3);
  });

  it('treats an unknown id as a root', () => {
    expect(computeDepth(edges, 'never-seen')).toBe(0);
  });

  it('terminates on a cyclic graph', () => {
    const bad = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    expect(() => computeDepth(bad, 'a')).not.toThrow();
  });
});

describe('knownConceptIds — rule 13 at the boundary', () => {
  const graph = [
    { _id: 'sin-cos-identities', name: 'Sine–cosine identities', aliases: ['pythagorean identity'] },
    { _id: 'trig-ratios', name: 'Trigonometric ratios', aliases: ['sohcahtoa'] },
  ];

  it('keeps ids that exist', () => {
    expect(knownConceptIds(['trig-ratios'], graph)).toEqual(['trig-ratios']);
  });

  it('maps a name or alias the model used instead of the id', () => {
    expect(knownConceptIds(['Pythagorean Identity', 'SOHCAHTOA'], graph)).toEqual([
      'sin-cos-identities',
      'trig-ratios',
    ]);
    expect(knownConceptIds(['Trigonometric ratios'], graph)).toEqual(['trig-ratios']);
  });

  it('drops what matches nothing — never invents a node', () => {
    expect(knownConceptIds(['made-up-concept', 'sin-cos-identity'], graph)).toEqual([]);
  });

  it('de-duplicates and keeps order', () => {
    expect(knownConceptIds(['trig-ratios', 'sohcahtoa', 'sin-cos-identities'], graph)).toEqual([
      'trig-ratios',
      'sin-cos-identities',
    ]);
  });
});
