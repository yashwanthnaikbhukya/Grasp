import type { Metadata } from 'next';
import { requireOnboarded } from '@/lib/session';
import { AskChat } from './chat';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ask' };

/**
 * Ask — the tutor surface.
 *
 * Requires a finished profile, because the learner card is what makes this
 * different from a general chatbot, and an empty one produces a generic tutor.
 */
export default async function AskPage() {
  const session = await requireOnboarded('/ask');

  return (
    <AskChat
      learnerName={session.name}
      profileSummary={{
        stage: session.profile.stage,
        region: session.profile.region,
        subjects: session.profile.subjects,
        goal: session.profile.goal.label || session.profile.goal.kind,
        // Read-aloud voice and dictation follow the learner's language and region.
        language: session.profile.language.instruction,
      }}
    />
  );
}
