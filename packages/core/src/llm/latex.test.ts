import { describe, expect, it } from 'vitest';
import { restoreLatexCommands, restoreLatexDeep } from './latex';

const raw = String.raw;

describe('restoreLatexCommands — backslashes structured output dropped', () => {
  it('restores the cards found broken in the 2026-11-09 test pass', () => {
    expect(restoreLatexCommands(raw`If $sin\theta=-dfrac{3}{5}$, is $cos\theta=pm\frac{4}{5}$?`)).toBe(
      raw`If $\sin\theta=-\dfrac{3}{5}$, is $\cos\theta=\pm\frac{4}{5}$?`,
    );
    expect(restoreLatexCommands(raw`$\tan60^circ=h/x$ so $h=xsqrt3$`)).toBe(raw`$\tan60^\circ=h/x$ so $h=x\sqrt3$`);
    expect(restoreLatexCommands(raw`angles $\theta$ and $phi$`)).toBe(raw`angles $\theta$ and $\phi$`);
    expect(restoreLatexCommands(raw`$1-left(\frac{3}{5}\right)^2$`)).toBe(raw`$1-\left(\frac{3}{5}\right)^2$`);
  });

  it('splits a function glued to its argument', () => {
    expect(restoreLatexCommands('$sinx + costheta$')).toBe(raw`$\sin x + \cos\theta$`);
  });

  it('leaves correct LaTeX exactly as it is', () => {
    for (const ok of [
      raw`$\dfrac{1}{2}$`,
      raw`$\triangle ABC$`,
      raw`$\Longrightarrow$`,
      raw`$\sin^2\theta + \cos^2\theta = 1$`,
      raw`$\arctan x$`,
      raw`$\left(\frac{a}{b}\right)$`,
    ]) {
      expect(restoreLatexCommands(ok)).toBe(ok);
    }
  });

  it('leaves variables, prose and text groups alone', () => {
    for (const ok of ['$x + y = 5$', '$AB = 3$', 'the sine rule, since $a = 2$', raw`$\text{the sin of } x$`, 'costs $5 or more']) {
      expect(restoreLatexCommands(ok)).toBe(ok);
    }
    expect(restoreLatexCommands('$text{area} = pi r^2$')).toBe(raw`$\text{area} = \pi r^2$`);
  });

  it('walks every string in a structured output', () => {
    const card = { stem: '$sqrt{2}$', options: [{ id: 'a', text: '$phi$' }], n: 3, ok: true };
    expect(restoreLatexDeep(card)).toEqual({
      stem: raw`$\sqrt{2}$`,
      options: [{ id: 'a', text: raw`$\phi$` }],
      n: 3,
      ok: true,
    });
  });
});
