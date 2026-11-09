import type { Intent } from '@grasp/schema';

/**
 * A deterministic check on `query.understand`'s intent, for the one mistake that
 * costs the most: a real question labelled `chitchat`. Chitchat skips retrieval
 * and gets a 1,000-token reply budget, so the learner gets a short answer with
 * none of their material (2026-11-09: "what is photosynthesis", intermittently).
 *
 * A message phrased as a question — a question mark, or opening with a question
 * or instruction word — is `explain` unless it is only a greeting.
 *
 * Chosen over a prompt change: a `query.understand@3` that redefined chitchat
 * fixed this but turned "how am I doing in trigonometry this week?" from `meta`
 * into chitchat (golden qu-06), while v2 already passes the new off-topic cases
 * (qu-14..17) and errs only intermittently — which a guard catches every time.
 */
const GREETING =
  /^(hi|hii+|hello|hey|yo|hiya|thanks|thank you|thx|ty|good (morning|afternoon|evening|night)|bye|see you|ok(ay)?|cool|nice)( there| grasp| again)?\b[\s,!.]*((how are you( doing)?|how's it going|what's up|sup)\??)?[\s!.?]*$/i;
const QUESTION_START =
  /^(what|why|how|when|where|which|who|whose|is|are|can|could|does|do|did|should|explain|define|describe|tell me|teach|show|solve|prove|calculate|find|derive|compare|summari[sz]e|help)\b/i;

export function correctIntent(query: string, intent: Intent): Intent {
  if (intent !== 'chitchat') return intent;
  const q = query.trim();
  if (GREETING.test(q)) return intent;
  const words = q.split(/\s+/).filter(Boolean).length;
  if (words >= 2 && (q.includes('?') || QUESTION_START.test(q))) return 'explain';
  return intent;
}
