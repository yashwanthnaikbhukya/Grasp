import { describe, expect, it } from 'vitest';
import { getPrompt } from './index';

const MODES = ['tutor.answer@1', 'tutor.teach@1', 'tutor.coach@1'] as const;

describe('tutor mode prompts', () => {
  it('every mode carries the shared dialogue rules — the fix for the "I don\'t know" loop', () => {
    for (const id of MODES) {
      const { system } = getPrompt(id);
      expect(system, id).toMatch(/Never answer "I don't know" with another question/);
      expect(system, id).toMatch(/Never repeat a question you have already asked/);
      expect(system, id).toMatch(/at most one question per message/);
    }
  });

  it('modes differ only in style, and say which they are', () => {
    expect(getPrompt('tutor.answer@1').system).toMatch(/MODE: ANSWER/);
    expect(getPrompt('tutor.teach@1').system).toMatch(/MODE: TEACH/);
    expect(getPrompt('tutor.coach@1').system).toMatch(/MODE: COACH/);
    // Answer mode must not quiz.
    expect(getPrompt('tutor.answer@1').system).toMatch(/Do not quiz them/);
  });

  it('asks for $-delimited maths, which the renderer typesets', () => {
    expect(getPrompt('tutor.teach@1').system).toMatch(/Never use \\\( \\\) or \\\[ \\\]/);
  });

  it('teaches the plot format, and its example is a valid PlotSpec shape', () => {
    const { system } = getPrompt('tutor.teach@1');
    const example = /```plot\n([\s\S]+?)\n```/.exec(system)?.[1];
    expect(example).toBeDefined();
    const spec = JSON.parse(example ?? '{}') as { polygons?: unknown[]; segments?: unknown[] };
    expect(spec.polygons?.length).toBe(1);
    expect(spec.segments?.length).toBe(1);
  });

  it('renders only this turn — history travels as real chat messages', () => {
    const out = getPrompt('tutor.coach@1').render({
      learnerCard: 'Class 10, India.',
      retrieved: [{ citeId: 'c1', headingPath: ['Trig', 'Identities'], text: 'sin²θ + cos²θ = 1' }],
      query: "i don't know, continue",
      rewritten: 'Explain the proof that sin²θ + cos²θ = 1',
      history: [{ role: 'assistant', text: 'SHOULD NOT APPEAR' }],
    });
    expect(out).not.toContain('SHOULD NOT APPEAR');
    expect(out).toContain("THE STUDENT'S NEW MESSAGE\ni don't know, continue");
    expect(out).toContain('In context, this means: Explain the proof');
    expect(out).toContain('[c1] Trig › Identities');
  });

  it('omits the resolved line when the rewrite adds nothing', () => {
    const out = getPrompt('tutor.answer@1').render({ query: 'What is tan 45°?', rewritten: 'what is tan 45°?' });
    expect(out).not.toContain('In context, this means');
  });
});
