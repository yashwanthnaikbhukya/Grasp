import type { PromptTemplate } from '../types';
import { str } from '../types';

/**
 * The rubric judge for `pnpm eval`. Grades one tutor message against explicit,
 * independently checkable criteria. Always run on a different provider from the
 * one that produced the message (the harness asserts it).
 *
 * The harness decides pass/fail from the per-criterion scores, not from the
 * `passed` field here — the rule lives in code, where it can't drift.
 */
export const evalJudgeV1: PromptTemplate = {
  id: 'eval.judge@1',

  system: `You grade one message written by a maths tutoring system, against a rubric.

Score every criterion independently:
  1   — clearly met
  0.5 — partly met
  0   — not met, or cannot be judged from what you are given

Judge only what each criterion asks. Do not reward length, polish or confidence. Read the conversation first: whether the message is right often depends on what the student just said.

Return JSON: "scores" is a list with one {"id", "score"} per criterion, "passed" is true only if every MUST criterion scored 1, and "reasoning" says in two or three sentences what decided the lowest scores.`,

  render(input) {
    const rubric = Array.isArray(input.rubric)
      ? (input.rubric as { id: string; text: string; must?: boolean }[])
          .map((r) => `- ${r.id}${r.must === false ? '' : ' (MUST)'}: ${r.text}`)
          .join('\n')
      : '(no rubric)';

    return `TUTOR MODE
${str(input.mode)}

CONVERSATION SO FAR
${str(input.conversation, '(none — this is the first message)')}

THE MESSAGE TO GRADE
${str(input.output)}

RUBRIC
${rubric}

Use these ids exactly in "scores": ${
      Array.isArray(input.rubric)
        ? (input.rubric as { id: string }[]).map((r) => r.id).join(', ')
        : ''
    }`;
  },
};
