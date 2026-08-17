/**
 * A prompt template, keyed `taskId@version`.
 *
 * Bumping a prompt means adding `name@n+1`, never editing `name@n`. The version
 * id lands in the trace and on the message document, so a change in output
 * quality is attributable to a specific prompt change — editing in place
 * destroys that. See docs/04-llm-gateway.md#prompt-versioning.
 */
export interface PromptTemplate {
  /** e.g. `query.understand@1` */
  readonly id: string;
  /** Stable across calls where possible — it's the cacheable prefix. */
  readonly system: string;
  /** Renders the volatile part. Keep variable content out of `system`. */
  render(input: Record<string, unknown>): string;
}

/** Small helper: render a value into a prompt without `undefined` leaking in. */
export function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

/** Numbered list, or a placeholder when empty. */
export function list(items: readonly string[], empty = '(none)'): string {
  if (items.length === 0) return empty;
  return items.map((s, i) => `${i + 1}. ${s}`).join('\n');
}
