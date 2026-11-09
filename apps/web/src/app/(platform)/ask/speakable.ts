/**
 * Tutor text → something a speech engine can read aloud. Pure, so it is unit
 * tested (speakable.test.ts) apart from the browser.
 *
 * Read-aloud uses the browser's own voices (`speechSynthesis`), which read
 * LaTeX as punctuation soup: "dollar backslash frac open brace…". This turns
 * the maths students meet most into words, drops what has no spoken form
 * (citation markers, diagrams), and leaves the rest to the voice.
 */

const SYMBOLS: [RegExp, string][] = [
  [/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 over $2 '],
  [/\\sqrt\{([^{}]+)\}/g, ' the square root of $1 '],
  [/\^\{?2\}?/g, ' squared '],
  [/\^\{?3\}?/g, ' cubed '],
  [/\^\{?\\circ\}?/g, ' degrees '],
  [/\^\{([^{}]+)\}/g, ' to the power $1 '],
  [/\^(\w)/g, ' to the power $1 '],
  [/_\{([^{}]+)\}/g, ' $1 '],
  [/\\(?:times|cdot)/g, ' times '],
  [/\\div/g, ' divided by '],
  [/\\pm/g, ' plus or minus '],
  [/\\(?:leq|le)\b/g, ' is at most '],
  [/\\(?:geq|ge)\b/g, ' is at least '],
  [/\\(?:neq|ne)\b/g, ' is not equal to '],
  [/\\approx/g, ' is about '],
  [/\\infty/g, ' infinity '],
  [/\\(?:Rightarrow|implies|Longrightarrow)/g, ', so '],
  [/\\therefore/g, ' therefore '],
  [/\\angle/g, ' angle '],
  [/\\triangle/g, ' triangle '],
  [/\\(sin|cos|tan|cot|sec|csc|log|ln)\b/g, ' $1 '],
  [/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|phi|sigma|omega)\b/g, ' $1 '],
  [/\\(?:left|right|,|;|!|quad|qquad)/g, ' '],
  [/\\text\{([^{}]*)\}/g, ' $1 '],
  [/=/g, ' equals '],
  [/</g, ' is less than '],
  [/>/g, ' is greater than '],
  [/\+/g, ' plus '],
  [/(\w|\))\s*-\s*(\w|\\|\()/g, '$1 minus $2'],
];

function speakMath(tex: string): string {
  let out = tex;
  for (const [re, to] of SYMBOLS) out = out.replace(re, to);
  return out.replace(/[{}\\]/g, ' ');
}

export function toSpeech(markdown: string): string {
  return (
    markdown
      // Diagrams have no spoken form; code is not read symbol by symbol.
      .replace(/```plot[\s\S]*?(```|$)/g, ' (There is a diagram here.) ')
      .replace(/```[\s\S]*?(```|$)/g, ' ')
      .replace(/\[c\d+\](\([^)]*\))?/g, '')
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => `. ${speakMath(m)}. `)
      .replace(/\$([^$\n]+?)\$/g, (_, m: string) => speakMath(m))
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\|/g, ', ')
      .replace(/[*_`~]+/g, '')
      .replace(/\s*\n\s*\n\s*/g, '. ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/([.!?])\s*\./g, '$1')
      .replace(/([.!?])\)\s*\./g, '$1)')
      .trim()
  );
}

/** BCP-47 tag for the browser's voices and dictation: language + region when known. */
export function speechLang(language: string, region: string): string {
  const lang = (language || 'en').split('-')[0]?.toLowerCase() || 'en';
  const reg = region && region.length === 2 ? region.toUpperCase() : '';
  return reg ? `${lang}-${reg}` : lang;
}
