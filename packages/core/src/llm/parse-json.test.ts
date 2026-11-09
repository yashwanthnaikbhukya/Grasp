import { describe, expect, it } from 'vitest';
import { parseModelJson, repairLatexEscapes } from './gateway';

// Raw model output as it arrives on the wire — String.raw keeps the single
// backslashes exactly as the model wrote them.
const raw = String.raw;

describe('LaTeX inside model JSON', () => {
  it('keeps \\theta as a command instead of TAB + "heta" (the shipped bug)', () => {
    const out = parseModelJson(raw`{"stem":"For an acute angle $\theta$, is $\sin\theta \le 1$?"}`) as {
      stem: string;
    };
    expect(out.stem).toBe(raw`For an acute angle $\theta$, is $\sin\theta \le 1$?`);
    expect(out.stem).not.toMatch(/\t/);
  });

  it('repairs every command a JSON escape would swallow', () => {
    for (const cmd of ['theta', 'times', 'tan', 'text', 'frac', 'beta', 'bar', 'rho', 'right', 'neq', 'nabla', 'nu']) {
      const out = parseModelJson(`{"m":"$\\${cmd}$"}`) as { m: string };
      expect(out.m).toBe(`$\\${cmd}$`);
    }
  });

  it('repairs commands that are not JSON escapes at all instead of failing the parse', () => {
    const out = parseModelJson(raw`{"m":"$\sin x \le 1$, $a \cdot b$, $\underline{x}$, é"}`) as {
      m: string;
    };
    expect(out.m).toBe(raw`$\sin x \le 1$, $a \cdot b$, $\underline{x}$, ` + 'é');
  });

  it('leaves correctly escaped LaTeX alone', () => {
    const out = parseModelJson(raw`{"m":"$\\theta + \\frac{1}{2}$"}`) as { m: string };
    expect(out.m).toBe(raw`$\theta + \frac{1}{2}$`);
  });

  it('keeps real newlines followed by ordinary words', () => {
    const out = parseModelJson(raw`{"m":"Step one.\nthen square both sides.\nNext"}`) as { m: string };
    expect(out.m).toBe('Step one.\nthen square both sides.\nNext');
  });

  it('still strips a code fence before parsing', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('is idempotent', () => {
    const once = repairLatexEscapes(raw`{"m":"\theta"}`);
    expect(repairLatexEscapes(once)).toBe(once);
  });
});
