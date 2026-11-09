import { describe, expect, it } from 'vitest';
import { conceptLabel } from './labels';

describe('conceptLabel — a concept name as a learner reads it', () => {
  it('sets plain-text powers as superscripts (the reported Map node)', () => {
    expect(conceptLabel('the identity sin^2 + cos^2 = 1')).toBe('The identity sin² + cos² = 1');
  });

  it('handles braces, negative and symbolic powers', () => {
    expect(conceptLabel('x^{10} growth')).toBe('X¹⁰ growth');
    expect(conceptLabel('inverse sin^-1')).toBe('Inverse sin⁻¹');
    expect(conceptLabel('a^n rules')).toBe('Aⁿ rules');
  });

  it('leaves ordinary names alone apart from the first letter', () => {
    expect(conceptLabel('Unit circle')).toBe('Unit circle');
    expect(conceptLabel('  completing the square ')).toBe('Completing the square');
    expect(conceptLabel('')).toBe('');
  });
});
