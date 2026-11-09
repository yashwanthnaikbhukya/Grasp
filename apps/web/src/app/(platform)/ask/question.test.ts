import { describe, expect, it } from 'vitest';
import { awaitsReply, quickReplies, splitClosingQuestion } from './question';

describe('splitClosingQuestion — is it the learner’s turn?', () => {
  it('pulls out the closing question (the reported Coach message)', () => {
    const text =
      'Plants prepare their food through **photosynthesis**. It takes place in the leaves.\n\n' +
      'To start, can you name the green pigment found in plant leaves that is responsible for absorbing sunlight?';
    const r = splitClosingQuestion(text);
    expect(r?.body).toBe('Plants prepare their food through **photosynthesis**. It takes place in the leaves.');
    expect(r?.question).toMatch(/^To start, can you name the green pigment/);
  });

  it('accepts emphasis or a bracket after the question mark, and maths inside it', () => {
    expect(splitClosingQuestion('Step one.\n\n**What is $\\sin 30^\\circ$?**')?.question).toBe('**What is $\\sin 30^\\circ$?**');
    expect(splitClosingQuestion('Good.\n\n(Which ratio uses the hypotenuse?)')).not.toBeNull();
  });

  it('is not fooled by a rhetorical question mid-answer', () => {
    expect(splitClosingQuestion('Why does this work? Because the sides scale together.\n\nSo the ratio is fixed.')).toBeNull();
  });

  it('never treats a list, table, code or display maths as the question', () => {
    expect(splitClosingQuestion('Try these:\n\n- What is sin 30?')).toBeNull();
    expect(splitClosingQuestion('Compare:\n\n| a | b? |')).toBeNull();
    expect(splitClosingQuestion('Look:\n\n$$x = ?$$')).toBeNull();
  });

  it('handles a message that is only a question', () => {
    expect(splitClosingQuestion('Which side is opposite θ?')).toEqual({ body: '', question: 'Which side is opposite θ?' });
  });
});

describe('awaitsReply — whose questions hand the turn over', () => {
  it('Teach and Coach wait for the learner', () => {
    expect(awaitsReply('teach')).toBe(true);
    expect(awaitsReply('coach')).toBe(true);
  });

  it('an Answer ending on an offer does not (the reported "graph, or move on?")', () => {
    expect(awaitsReply('answer')).toBe(false);
    expect(awaitsReply(undefined)).toBe(false);
  });
});

describe('quickReplies', () => {
  it('offers a hint in Coach', () => {
    expect(quickReplies('coach').map((q) => q.label)).toContain('Give me a hint');
  });

  it('always offers a way to the answer now, where it hands over', () => {
    for (const mode of ['teach', 'coach'] as const) {
      expect(quickReplies(mode).map((q) => q.label)).toContain('Show the answer');
    }
  });

  it('has none in Answer, which never hands over', () => {
    expect(quickReplies('answer')).toEqual([]);
  });
});
