import type { LearnerProfile } from '@grasp/schema';
import { stageLabel } from '@grasp/schema';

/**
 * The learner card — roughly 300 tokens of hand-formatted prose describing who
 * this learner is and what the model already knows about them.
 *
 * **This block is the entire difference between Grasp's tutor and ChatGPT.**
 * Everything else in the broker exists to fill it accurately.
 *
 * Written as prose, not a JSON dump: models read prose better and it costs fewer
 * tokens. Rules, all of which matter:
 *
 *   · Local labels, never internal ones. "Class 10 (India)", never "stage: 10".
 *   · Notation stated explicitly — a tutor writing `trapezoid` at a learner
 *     taught `trapezium` is worse than one that says nothing.
 *   · No PII, ever. Second person only, no name, no school, no contact detail —
 *     so a prompt leak is not a PII leak.
 *   · Mastery shown with its state word, not just a number. The model reasons
 *     better about "learning" than about 0.34.
 *   · Prerequisite gaps flagged loudly — the single most actionable fact here.
 *   · Misconceptions stated as the learner's belief, never as a correction. The
 *     model decides how to address it.
 *
 * See docs/05-context-broker.md § 5.
 */

export interface MasteryLine {
  conceptId: string;
  name?: string;
  p: number;
  state: 'unseen' | 'learning' | 'review' | 'mastered';
  lastSeenAt?: Date | null;
  /** True when this is an unmet prerequisite of something the query touches. */
  isPrerequisiteGap?: boolean;
}

export interface LearnerCardInput {
  profile: LearnerProfile;
  /** Only concepts the current query touches — never the whole mastery table. */
  mastery?: MasteryLine[];
  misconceptions?: { statement: string; evidenceCount: number; lastSeenAt?: Date }[];
  recentEpisodes?: { summary: string; createdAt?: Date }[];
  /** Curriculum display names, resolved by the caller. */
  curriculumNames?: string[];
  /** Notation conventions from the learner's curriculum. */
  notation?: {
    reciprocalTrig?: string;
    quadrilateral?: string;
    decimalSeparator?: string;
    digitGrouping?: string;
    units?: string;
    spelling?: string;
  };
  now?: Date;
}

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

function agoPhrase(then: Date, now: Date): string {
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** Notation differences that change what a correct answer looks like. */
function notationPhrase(n: NonNullable<LearnerCardInput['notation']>): string {
  const parts: string[] = [];
  if (n.reciprocalTrig === 'cosec-sec-cot') parts.push('write cosec, not csc');
  if (n.quadrilateral === 'commonwealth') {
    // These name *different shapes* in US and UK English, so this is not style.
    parts.push('Commonwealth quadrilateral names (trapezium)');
  }
  if (n.digitGrouping === 'lakh-crore') parts.push('lakh/crore digit grouping');
  if (n.decimalSeparator === ',') parts.push('comma as the decimal separator');
  if (n.units === 'imperial') parts.push('imperial units');
  if (n.spelling === 'en-GB') parts.push('British spelling');
  return parts.join('; ');
}

export function buildLearnerCard(input: LearnerCardInput): string {
  const now = input.now ?? new Date();
  const p = input.profile;

  /**
   * Whether we know anything substantive.
   *
   * Checked against the profile rather than against how much text got emitted:
   * schema defaults (`goal.kind: 'self-study'`, `language: en`) would otherwise
   * fill the card with statements nobody made, and it would never look empty.
   */
  const knowsSomething =
    p.region !== 'XX' ||
    p.stage !== null ||
    p.age !== null ||
    p.subjects.length > 0 ||
    p.curriculumIds.length > 0 ||
    p.goal.label !== '' ||
    p.goal.examDate !== null ||
    (input.mastery?.length ?? 0) > 0 ||
    (input.misconceptions?.length ?? 0) > 0 ||
    (input.recentEpisodes?.length ?? 0) > 0;

  if (!knowsSomething) {
    // Better than an empty block, which reads as "no context available" and
    // invites hedging.
    return 'LEARNER\nNo profile details yet — ask what they need if it would change your answer.';
  }

  const lines: string[] = ['LEARNER'];

  // --- who and where -------------------------------------------------------
  const where: string[] = [];
  if (p.stage !== null) {
    where.push(stageLabel(p.stage, p.region));
    if (p.region && p.region !== 'XX') where.push(`(${p.region})`);
  } else if (!p.inFormalEducation) {
    where.push('Studying independently, not in formal education');
  }
  const subjectPart = input.curriculumNames?.length
    ? input.curriculumNames.join(', ')
    : p.subjects.join(', ');
  const opening = [where.join(' '), subjectPart].filter(Boolean).join('. ');
  if (opening) lines.push(`${opening}.`);

  // --- goal ----------------------------------------------------------------
  if (p.goal.examDate) {
    const days = daysUntil(new Date(p.goal.examDate), now);
    const label = p.goal.label || 'their exam';
    lines.push(
      days > 0
        ? `Working toward ${label}, ${days} days away.`
        : `${label} has passed — check whether the goal is still current.`,
    );
  } else if (p.goal.label) {
    lines.push(`Working toward ${p.goal.label}.`);
  } else if (p.goal.kind === 'self-study') {
    lines.push('Studying at their own pace, no external deadline.');
  }

  // --- language ------------------------------------------------------------
  if (p.language.codeSwitch) {
    lines.push(
      `Explain in ${p.language.instruction}, mixing in ${p.language.codeSwitch} where it reads ` +
        `more naturally; keep technical terms in ${p.language.instruction}.`,
    );
  } else if (p.language.instruction !== 'en') {
    lines.push(`Explain in ${p.language.instruction}.`);
  }

  // --- notation ------------------------------------------------------------
  if (input.notation) {
    const phrase = notationPhrase(input.notation);
    if (phrase) lines.push(`Notation: ${phrase}.`);
  }

  // --- pace ----------------------------------------------------------------
  const pace: string[] = [];
  if (p.minutesPerDay) pace.push(`about ${p.minutesPerDay} min/day`);
  if (p.depth !== 'balanced') pace.push(`prefers ${p.depth} explanations`);
  if (pace.length > 0) lines.push(`Studies ${pace.join(', ')}.`);

  // --- mastery -------------------------------------------------------------
  const mastery = input.mastery ?? [];
  if (mastery.length > 0) {
    lines.push('', 'RELEVANT MASTERY');
    for (const m of mastery.slice(0, 8)) {
      const name = (m.name ?? m.conceptId).padEnd(34);
      const score = m.p.toFixed(2);
      const seen = m.lastSeenAt ? ` last seen ${agoPhrase(new Date(m.lastSeenAt), now)}` : '';
      const gap = m.isPrerequisiteGap ? '  ← PREREQUISITE GAP' : '';
      lines.push(`  ${name} ${score}  ${m.state}${seen}${gap}`);
    }
  }

  // --- misconceptions ------------------------------------------------------
  const misconceptions = input.misconceptions ?? [];
  if (misconceptions.length > 0) {
    lines.push('', 'ACTIVE MISCONCEPTIONS');
    for (const m of misconceptions.slice(0, 4)) {
      const seen = m.lastSeenAt ? `, latest ${agoPhrase(new Date(m.lastSeenAt), now)}` : '';
      lines.push(`  · ${m.statement} (${m.evidenceCount} observations${seen})`);
    }
  }

  // --- episodes ------------------------------------------------------------
  const episodes = input.recentEpisodes ?? [];
  if (episodes.length > 0) {
    lines.push('', 'RECENT');
    for (const e of episodes.slice(0, 3)) {
      const when = e.createdAt ? `${agoPhrase(new Date(e.createdAt), now)}: ` : '';
      lines.push(`  ${when}${e.summary}`);
    }
  }

  return lines.join('\n');
}
