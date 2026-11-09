/**
 * Put back LaTeX backslashes that structured output dropped.
 *
 * Providers decode JSON against a strict schema, and a JSON string may only
 * contain the escapes `\" \\ \/ \b \f \n \r \t \uXXXX`. When a model reaches for
 * `\sqrt` inside such a string, the grammar refuses the backslash and the model
 * writes `sqrt` instead — silently. `\theta` and `\frac` survive (as TAB and
 * form-feed, repaired by `repairLatexEscapes`), so a card comes back with
 * `$\theta$` intact next to `$sin\theta = -dfrac{3}{5}$`. Five of the eight
 * cards verified in the 2026-11-09 test pass looked like that; the solver read
 * them fine, so verification passed them.
 *
 * Works on whole runs of letters inside `$…$` / `$$…$$`, never inside
 * `\text{…}`, and never on a run that already follows a backslash — so `\dfrac`
 * and `\triangle` are left exactly as they are.
 */

const FUNCTIONS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'exp'];

const COMMANDS = new Set([
  ...FUNCTIONS,
  'frac', 'dfrac', 'tfrac', 'sqrt', 'cdot', 'times', 'div', 'pm', 'mp', 'circ', 'deg',
  'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'infty', 'angle', 'triangle',
  'left', 'right', 'Rightarrow', 'Longrightarrow', 'Leftrightarrow', 'implies',
  'therefore', 'because', 'quad', 'qquad', 'overline', 'underline',
  'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'pi', 'rho', 'sigma',
  'tau', 'phi', 'varphi', 'chi', 'psi', 'omega', 'eta',
]);

/**
 * Commands that turn up glued to a one- or two-letter variable once the
 * backslash is gone: `h=xsqrt3`, `2xcdot y`. Longest first, so `dfrac` wins over `frac`.
 */
const GLUED = ['dfrac', 'tfrac', 'frac', 'sqrt', 'cdot', 'times', 'circ', 'theta'];

function restoreRun(run: string): string {
  if (COMMANDS.has(run)) return `\\${run}`;
  // `sinx`, `costheta` → `\sin x`, `\cos\theta`
  for (const fn of FUNCTIONS) {
    if (!run.startsWith(fn)) continue;
    const rest = run.slice(fn.length);
    if (/^[a-zA-Z]$/.test(rest)) return `\\${fn} ${rest}`;
    if (COMMANDS.has(rest)) return `\\${fn}\\${rest}`;
  }
  for (const cmd of GLUED) {
    const prefix = run.length - cmd.length;
    if (prefix >= 1 && prefix <= 2 && run.endsWith(cmd)) return `${run.slice(0, prefix)}\\${cmd}`;
  }
  return run;
}

const STRIPPED_TEXT_GROUP = /(?<![\\a-zA-Z])(text|mathrm|operatorname)\{/g;
const TEXT_GROUP = /(\\(?:text|mathrm|operatorname)\{[^{}]*\})/;

function restoreInMath(math: string): string {
  return math
    .replace(STRIPPED_TEXT_GROUP, '\\$1{')
    .split(TEXT_GROUP)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(/(\\?)([a-zA-Z]+)/g, (m, bs: string, run: string) => (bs ? m : restoreRun(run))),
    )
    .join('');
}

export function restoreLatexCommands(text: string): string {
  if (!text.includes('$')) return text;
  return text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, restoreInMath);
}

/** Every string in a parsed structured output, recursively. */
export function restoreLatexDeep<T>(value: T): T {
  if (typeof value === 'string') return restoreLatexCommands(value) as T;
  if (Array.isArray(value)) return value.map((v) => restoreLatexDeep(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, restoreLatexDeep(v)]),
    ) as T;
  }
  return value;
}
