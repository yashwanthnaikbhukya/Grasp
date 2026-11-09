import { describe, expect, it } from 'vitest';
import { speechLang, toSpeech } from './speakable';

describe('toSpeech — tutor text a voice can read', () => {
  it('reads common maths as words', () => {
    expect(toSpeech('So $\\sin^2\\theta + \\cos^2\\theta = 1$.')).toBe('So sin squared theta plus cos squared theta equals 1.');
    expect(toSpeech('$\\tan 45^\\circ = \\frac{1}{1}$')).toBe('tan 45 degrees equals 1 over 1');
    expect(toSpeech('$h = 20\\sqrt{3}$')).toBe('h equals 20 the square root of 3');
  });

  it('drops what has no spoken form', () => {
    const out = toSpeech('True [c1].\n\n```plot\n{"x":[0,1]}\n```\n\n**Bold** and `code`');
    expect(out).toBe('True. (There is a diagram here.) Bold and code');
  });

  it('drops grouped and other-style citation markers too', () => {
    expect(toSpeech('True 【c1】 and [c3, c6].')).toBe('True and.');
  });

  it('turns structure into pauses, not symbols', () => {
    expect(toSpeech('## Step 1\n- first\n- second\n\nDone')).toBe('Step 1 first second. Done');
  });
});

describe('speechLang', () => {
  it('pairs the explanation language with the learner region', () => {
    expect(speechLang('en', 'GB')).toBe('en-GB');
    expect(speechLang('hi', 'in')).toBe('hi-IN');
    expect(speechLang('', '')).toBe('en');
  });
});
