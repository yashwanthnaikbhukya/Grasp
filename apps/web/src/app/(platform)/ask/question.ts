/**
 * Does the tutor's message end by asking the learner something?
 *
 * Coach asks one question per message by design, and Teach ends on a check
 * question — but rendered as just another paragraph it read like the end of an
 * answer, not like a turn being handed over (2026-11-09). Pulling the closing
 * question out lets the message show it as *your turn* and the composer become
 * a reply box for it. Pure, so it is unit-tested apart from React.
 *
 * Only the final paragraph counts, and only when it ends with a question mark:
 * a rhetorical "why does this work?" mid-answer is not a handover. Lists, tables,
 * code and display maths are never treated as the question.
 */
export function splitClosingQuestion(text: string): { body: string; question: string } | null {
  const trimmed = text.trimEnd();
  const cut = trimmed.lastIndexOf('\n\n');
  const last = (cut >= 0 ? trimmed.slice(cut + 2) : trimmed).trim();
  if (!last) return null;
  if (/^(```|\||\$\$|[-*+]\s|\d+[.)]\s|>)/.test(last)) return null;
  // Ends with "?", allowing closing emphasis, a bracket or a quote after it.
  if (!/\?[*_)"'”’]*$/.test(last)) return null;
  // A long final paragraph is explanation that happens to end on a question;
  // the handover is its last sentence.
  if (last.length > 400) return null;
  return { body: cut >= 0 ? trimmed.slice(0, cut).trimEnd() : '', question: last };
}

type Mode = 'answer' | 'teach' | 'coach' | undefined;

/**
 * Only Teach and Coach hand the turn over. Their closing question is a check
 * the lesson waits on; an Answer that ends "want to see a graph, or move on?"
 * is an offer, and turning the composer into a reply box for it made a learner
 * who just wanted the answer feel stuck (2026-11-09).
 */
export function awaitsReply(mode: Mode): boolean {
  return mode === 'teach' || mode === 'coach';
}

/**
 * One-tap replies to a tutor's question, by mode — phrased the way a learner
 * would say them. Each mode has a way to the answer now, for a learner short of
 * time; skipping the question altogether is the reply box's close button.
 */
export function quickReplies(mode: Mode): { label: string; text: string }[] {
  if (mode === 'coach') {
    return [
      { label: 'Give me a hint', text: 'Can I have a hint?' },
      { label: 'Explain this step', text: "I'm not sure — can you explain this step?" },
      { label: 'Show the answer', text: 'Please just show me the answer.' },
    ];
  }
  if (mode === 'teach') {
    return [
      { label: 'Explain it again', text: "I'm not sure — can you explain it another way?" },
      { label: 'Show the answer', text: 'Please show me the answer.' },
    ];
  }
  return [];
}
