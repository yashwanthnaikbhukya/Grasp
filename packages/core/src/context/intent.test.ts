import { describe, expect, it } from 'vitest';
import { correctIntent } from './intent';

describe('correctIntent — a question is never chitchat', () => {
  it('lifts the reported case and its cousins to explain', () => {
    expect(correctIntent('what is photosynthesis', 'chitchat')).toBe('explain');
    expect(correctIntent('What caused the First World War?', 'chitchat')).toBe('explain');
    expect(correctIntent('explain recursion', 'chitchat')).toBe('explain');
    expect(correctIntent('photosynthesis vs respiration?', 'chitchat')).toBe('explain');
  });

  it('leaves greetings and small talk alone', () => {
    for (const g of ['hi', 'hello!', 'hi there, how are you?', 'thanks', 'good morning', 'ok cool']) {
      expect(correctIntent(g, 'chitchat'), g).toBe('chitchat');
    }
  });

  it('never touches any other intent', () => {
    expect(correctIntent('what is photosynthesis', 'quiz')).toBe('quiz');
    expect(correctIntent('hi', 'explain')).toBe('explain');
  });
});
