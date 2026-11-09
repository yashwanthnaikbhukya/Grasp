import { describe, expect, it } from 'vitest';
import { verifyCitations } from './assemble';

const citeMap = { c1: 'chunk-a', c2: 'chunk-b', c3: 'chunk-c' };
const long = (s: string) => `${s} ${'and more explanation '.repeat(12)}`;

describe('verifyCitations — the hallucination metric', () => {
  it('splits cited ids into real and fabricated', () => {
    const r = verifyCitations('True [c1], and also [c9].', citeMap);
    expect(r.cited).toEqual(['c1']);
    expect(r.fabricated).toEqual(['c9']);
  });

  it('counts each id once', () => {
    expect(verifyCitations('[c2] then [c2] again', citeMap).cited).toEqual(['c2']);
  });

  it('reads grouped markers — they used to be missed entirely', () => {
    const r = verifyCitations(long('The hypotenuse [c1, c3].'), citeMap);
    expect(r.cited).toEqual(['c1', 'c3']);
    expect(r.ungrounded).toBe(false);
  });

  it("reads another model's marker style (gpt-oss wrote 【c1】 on 2026-11-09)", () => {
    const r = verifyCitations(long('sin 30° is 1/2 【c1】.'), citeMap);
    expect(r.cited).toEqual(['c1']);
    expect(r.ungrounded).toBe(false);
  });

  it('flags a long answer that cites nothing when there was material', () => {
    expect(verifyCitations(long('No citations here.'), citeMap).ungrounded).toBe(true);
  });

  it('does not flag short replies, or answers with nothing to cite', () => {
    expect(verifyCitations('Sure — which part?', citeMap).ungrounded).toBe(false);
    expect(verifyCitations(long('General knowledge.'), {}).ungrounded).toBe(false);
  });
});
