import { describe, expect, it } from 'vitest';
import { prepare } from './markdown-prepare';

describe('prepare — tutor text before Markdown parsing', () => {
  it('turns \\( \\) and \\[ \\] into dollar maths, which remark-math reads', () => {
    expect(prepare('so \\(\\sin\\theta\\) is', false)).toBe('so $\\sin\\theta$ is');
    expect(prepare('\\[ a^2+b^2=c^2 \\]', false)).toContain('$$\na^2+b^2=c^2\n$$');
  });

  it('turns citation markers into cite links, once', () => {
    expect(prepare('true [c2].', false)).toBe('true [c2](#cite-c2).');
    expect(prepare('[c2](#cite-c2)', false)).toBe('[c2](#cite-c2)');
  });

  it('splits a grouped citation into one marker each', () => {
    expect(prepare('the hypotenuse [c3, c6].', false)).toBe('the hypotenuse [c3](#cite-c3) [c6](#cite-c6).');
  });

  it('lifts a citation out of a formula, where TeX would print brackets', () => {
    const out = prepare('$$\\tan\\theta = \\frac{o}{a} [c3]$$', false);
    expect(out).toContain('$$\\tan\\theta = \\frac{o}{a}$$');
    expect(out).toContain('[c3](#cite-c3)');
  });

  it('holds back a display formula still arriving mid-stream', () => {
    expect(prepare('Step 1.\n$$\n\\frac{1}{', true)).toBe('Step 1.\n');
    // …and shows it once it closes.
    expect(prepare('Step 1.\n$$\n\\frac{1}{2}\n$$', true)).toContain('\\frac{1}{2}');
  });

  it('sets bare function names upright inside maths', () => {
    expect(prepare('values of $sin\\theta$ and $cos\\theta$', false)).toBe(
      'values of $\\sin\\theta$ and $\\cos\\theta$',
    );
    expect(prepare('$$sin^2 x + cos^2 x = 1$$', false)).toBe('$$\\sin^2 x + \\cos^2 x = 1$$');
    expect(prepare('$log_2 8 = 3$', false)).toBe('$\\log_2 8 = 3$');
  });

  it('leaves correct TeX, prose and text groups alone', () => {
    for (const ok of ['$\\sin\\theta$', '$\\arcsin x$', '$asin$', 'since the sine rule', '$\\text{the sin of } x$', '$\\operatorname{sin} x$']) {
      expect(prepare(ok, false)).toBe(ok);
    }
  });

  it('holds back an inline formula still arriving mid-stream', () => {
    expect(prepare('so $\\frac{1', true)).toBe('so ');
    expect(prepare('so $x$ and $\\frac{1}{2}$ done', true)).toBe('so $x$ and $\\frac{1}{2}$ done');
    expect(prepare('so $x$ and $y', false)).toBe('so $x$ and $y');
  });

  it('leaves settled text alone even with an odd number of $$', () => {
    expect(prepare('costs $$5', false)).toBe('costs $$5');
  });
});
