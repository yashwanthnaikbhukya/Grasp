/**
 * Citation markers — plain text helpers with no imports, so client code can use
 * them through `@grasp/schema/citations` without pulling Zod and every schema
 * into the page (importing them from the package root added ~21 kB to Reps).
 * The package root re-exports them for server code.
 */

/**
 * Citation markers in another model's house style: `【c1】` (gpt-oss on Groq
 * answered with these on 2026-11-09, and they showed as raw text), OpenAI-style
 * `【c1†source】`, and full-width `［c1］`. Groups like `【c1, c2】` are kept as one.
 */
const FOREIGN_CITE = /[【［]\s*(c\d+(?:\s*[,，、]\s*c\d+)*)\s*(?:†[^】］]*)?[】］]/g;

/**
 * Rewrites every citation marker to Grasp's own `[c1]` / `[c1, c2]`. Applied
 * wherever a marker is read — the renderer, read-aloud, citation verification,
 * the saved message — so one model's style never decides what the learner sees.
 */
export function normalizeCitations(text: string): string {
  return text.replace(FOREIGN_CITE, (_, ids: string) => `[${ids.split(/\s*[,，、]\s*/).join(', ')}]`);
}

/** Every cite id in a text, in order, including grouped markers (`[c3, c6]`). */
export function citedIds(text: string): string[] {
  return [...normalizeCitations(text).matchAll(/\[(c\d+(?:\s*,\s*c\d+)*)\]/g)].flatMap((m) =>
    (m[1] ?? '').split(/\s*,\s*/),
  );
}
