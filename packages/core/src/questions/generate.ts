import { ObjectId } from 'mongodb';
import type { CardSolve, GeneratedCard } from '@grasp/schema';
import { collections } from '../db/collections';
import { generate } from '../llm/gateway';
import { judge, structuralFaults } from './verify';

/**
 * Question generation with verification.
 *
 * The pipeline exists because generated questions are subtly wrong often enough
 * that shipping them unchecked would be the fastest way to lose a learner's
 * trust: two defensible options, a stem that reads two ways, a key that does not
 * match the working. All of those survive a casual read.
 *
 *   generate → structural check → solve twice, independently → judge → persist
 *
 * Only `verified` is ever served (enforced in the card query, not by convention).
 * Everything else is kept: `quarantined` for a human glance, `rejected` as a
 * record of what the generator gets wrong, which is the raw material for the
 * next prompt version.
 */

export interface GenerateCardsArgs {
  chunkId?: string;
  text: string;
  conceptIds: string[];
  objectives?: string[];
  stageRange?: { min: number; max: number } | null;
  curriculumIds?: string[];
  subject: string;
  count?: number;
  sourceId?: string;
  onProgress?: (msg: string) => void;
}

export interface GenerateCardsResult {
  generated: number;
  verified: number;
  quarantined: number;
  rejected: number;
  /** Provider chain exhausted — retry this chunk later, do not fail the batch. */
  deferred: boolean;
  reasons: string[];
}

export async function generateAndVerify(args: GenerateCardsArgs): Promise<GenerateCardsResult> {
  const say = args.onProgress ?? (() => {});
  const result: GenerateCardsResult = {
    generated: 0,
    verified: 0,
    quarantined: 0,
    rejected: 0,
    deferred: false,
    reasons: [],
  };

  // --- generate -----------------------------------------------------------
  let cards: GeneratedCard[] = [];
  try {
    const res = await generate<{ cards?: GeneratedCard[] } | GeneratedCard>({
      task: 'card.generate',
      input: {
        text: args.text,
        concepts: args.conceptIds.join(', '),
        objectives: (args.objectives ?? []).join('\n'),
        stageRange: args.stageRange ? `${args.stageRange.min}–${args.stageRange.max}` : 'unknown',
        count: args.count ?? 3,
      },
    });
    // The schema is a single card; asking for several returns one per call, so
    // the loop below runs the task `count` times rather than parsing a list.
    if (res.data) cards = [res.data as GeneratedCard];
  } catch (e) {
    result.deferred = true;
    result.reasons.push(e instanceof Error ? e.message.slice(0, 120) : 'generation failed');
    return result;
  }

  // Ask for the remaining cards. Separate calls rather than one batched call:
  // a single response containing five questions tends to produce five variants
  // of the same question, and one bad parse loses all of them.
  const want = args.count ?? 3;
  for (let i = 1; i < want; i++) {
    try {
      const res = await generate<GeneratedCard>({
        task: 'card.generate',
        input: {
          text: args.text,
          concepts: args.conceptIds.join(', '),
          objectives: (args.objectives ?? []).join('\n'),
          stageRange: args.stageRange ? `${args.stageRange.min}–${args.stageRange.max}` : 'unknown',
          count: 1,
          avoid: cards.map((c) => c.stem).join('\n'),
        },
      });
      if (res.data) cards.push(res.data);
    } catch {
      break;
    }
  }

  result.generated = cards.length;

  for (const card of cards) {
    // --- structural check, before spending tokens on solving ---------------
    const faults = structuralFaults(card);
    if (faults.length > 0) {
      result.rejected++;
      result.reasons.push(`structural: ${faults[0]}`);
      await persist(card, args, 'rejected', [], faults.join('; '));
      continue;
    }

    // --- two independent solves -------------------------------------------
    const solves: CardSolve[] = [];
    for (let i = 0; i < 2; i++) {
      try {
        const res = await generate<CardSolve>({
          task: 'card.solve',
          input: {
            type: card.type,
            stem: card.stem,
            options: (card.options ?? [])
              .map((o) => `${o.id}) ${o.text}`)
              .join('\n'),
          },
        });
        if (res.data) solves.push(res.data);
      } catch {
        // A missing solve becomes a quarantine below, which is the right
        // outcome — an unverified question must not be served.
        break;
      }
    }

    const outcome = judge(card, solves);
    if (outcome.status === 'verified') result.verified++;
    else if (outcome.status === 'rejected') result.rejected++;
    else result.quarantined++;
    result.reasons.push(outcome.reason);

    await persist(card, args, outcome.status, solves, outcome.reason);
    say(`  ${outcome.status}: ${card.stem.slice(0, 58)}`);
  }

  return result;
}

async function persist(
  card: GeneratedCard,
  args: GenerateCardsArgs,
  status: 'verified' | 'quarantined' | 'rejected',
  solves: readonly CardSolve[],
  notes: string,
): Promise<void> {
  await collections.questions().insertOne({
    _id: new ObjectId(),
    conceptIds: card.conceptIds.length > 0 ? card.conceptIds : args.conceptIds,
    type: card.type,
    stem: card.stem,
    options: card.options,
    answer: card.answer,
    solution: card.solution,
    difficulty: card.difficultyGuess,
    verificationStatus: status,
    verification: {
      solvedBy: solves.map((s) => ({ model: 'gateway', answer: s.answer, flaw: s.flaw })),
      agreement: status === 'verified',
      notes,
    },
    sourceId: args.sourceId ? new ObjectId(args.sourceId) : undefined,
    curriculumIds: args.curriculumIds ?? [],
    subject: args.subject,
    stageRange: args.stageRange ?? null,
    language: 'en',
    createdAt: new Date(),
  } as never);
}
