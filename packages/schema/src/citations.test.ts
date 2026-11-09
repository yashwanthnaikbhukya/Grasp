import { describe, expect, it } from 'vitest';
import { citedIds, normalizeCitations } from './citations';

describe('normalizeCitations — one marker style, whatever the model wrote', () => {
  it('rewrites the lenticular brackets gpt-oss used on 2026-11-09', () => {
    expect(normalizeCitations('the hypotenuse 2 【c1】.')).toBe('the hypotenuse 2 [c1].');
  });

  it('handles source suffixes, full-width brackets and groups', () => {
    expect(normalizeCitations('【c3†source】')).toBe('[c3]');
    expect(normalizeCitations('【c3†L1-L4】')).toBe('[c3]');
    expect(normalizeCitations('［c4］')).toBe('[c4]');
    expect(normalizeCitations('【c3, c6】 【c1，c2】')).toBe('[c3, c6] [c1, c2]');
  });

  it('leaves Grasp markers and other brackets alone', () => {
    for (const ok of ['[c1]', '[c3, c6]', '【note】', '【1†source】', 'plain text']) {
      expect(normalizeCitations(ok)).toBe(ok);
    }
  });
});

describe('citedIds', () => {
  it('lists every id, including grouped and foreign-style markers', () => {
    expect(citedIds('a [c1] b [c3, c6] c 【c2】 d [c1]')).toEqual(['c1', 'c3', 'c6', 'c2', 'c1']);
  });

  it('ignores markdown links that are not citations', () => {
    expect(citedIds('see [the chart](#x) and [1]')).toEqual([]);
  });
});
