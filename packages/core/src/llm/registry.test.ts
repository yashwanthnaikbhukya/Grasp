import { describe, expect, it } from 'vitest';
import { getPrompt, listPrompts } from '@grasp/prompts';
import { TASKS, listTasks } from './registry';

/**
 * Guards the registry against the failure mode where a task points at a prompt
 * that doesn't exist — which surfaces only when that task is first called, in
 * production, at the worst moment.
 *
 * Tasks whose prompts land in a later phase are declared here explicitly. Adding
 * a task without either a prompt or an entry on this list fails the suite.
 */
const PROMPT_PENDING: Record<string, string> = {
  'session.digest@1': 'Phase 1 — history compaction',
  'session.title@1': 'Phase 1 — session auto-titling',
  'card.generate@1': 'Phase 2 — question bank',
  'card.solve@1': 'Phase 2 — verification pipeline',
  'doubt.decompose@1': 'Phase 3 — Snap',
  'mindmap.build@1': 'Phase 4 — Map',
  'eval.judge@1': 'Phase 0.4 — eval harness',
};

describe('task registry', () => {
  it('every task resolves to a prompt, or is declared pending', () => {
    const missing: string[] = [];

    for (const task of listTasks()) {
      const { prompt } = TASKS[task];
      try {
        getPrompt(prompt);
      } catch {
        if (!(prompt in PROMPT_PENDING)) {
          missing.push(`${task} → ${prompt}`);
        }
      }
    }

    expect(
      missing,
      `Undeclared missing prompts. Either add the template to @grasp/prompts, ` +
        `or add it to PROMPT_PENDING with the phase that will build it.`,
    ).toEqual([]);
  });

  it('has no stale PROMPT_PENDING entries', () => {
    const implemented = new Set(listPrompts());
    const stale = Object.keys(PROMPT_PENDING).filter((id) => implemented.has(id));

    expect(stale, 'These prompts now exist — remove them from PROMPT_PENDING').toEqual([]);
  });

  it('every prompt id is versioned', () => {
    const unversioned = listTasks()
      .map((t) => TASKS[t].prompt)
      .filter((p) => !/@\d+$/.test(p));

    expect(unversioned, 'Prompt ids must end in @<version> — see docs/04-llm-gateway.md').toEqual(
      [],
    );
  });

  it('tasks that write into the learner graph use the best tier', () => {
    // A wrong root-cause label persists and changes what the learner practises
    // for weeks. See docs/04-llm-gateway.md#tiers.
    expect(TASKS['slip.classify'].tier).toBe('best');
    expect(TASKS['eval.judge'].tier).toBe('best');
  });

  it('the verification solver is at least as capable as the generator', () => {
    // Verifying a generated card with a weaker model is theatre.
    const rank = { fast: 0, mid: 1, best: 2 } as const;
    expect(rank[TASKS['card.solve'].tier]).toBeGreaterThanOrEqual(
      rank[TASKS['card.generate'].tier],
    );
  });

  it('per-learner tasks are never response-cached', () => {
    // The learner card makes these per-learner by design; a cache hit would
    // serve one student another student's context.
    expect(TASKS['tutor.reply'].cache).toBe(false);
    expect(TASKS['query.understand'].cache).toBe(false);
    expect(TASKS['slip.classify'].cache).toBe(false);
  });
});
