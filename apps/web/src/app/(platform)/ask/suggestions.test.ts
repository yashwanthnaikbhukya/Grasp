import { describe, expect, it } from 'vitest';
import { starterQuestions } from './suggestions';

describe('starter questions follow the learner’s subjects', () => {
  it('spreads across subjects before doubling up', () => {
    const qs = starterQuestions(['history', 'biology']);
    expect(qs).toHaveLength(4);
    expect(qs[0]).toMatch(/War/);
    expect(qs[1]).toMatch(/DNA/);
  });

  it('falls back to the subject group, then to the name, for anything else', () => {
    expect(starterQuestions(['thermodynamics'], 1)[0]).toBe('Walk me through a typical Thermodynamics problem');
    expect(starterQuestions(['compiler-design'], 1)[0]).toBe('Explain a key idea in Compiler Design from scratch');
  });

  it('never offers nothing', () => {
    expect(starterQuestions([]).length).toBeGreaterThan(0);
  });
});
