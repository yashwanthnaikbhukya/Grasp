import { stageLabel } from '@grasp/schema';
import { ShellFrame } from '@/components/shell/frame';
import { initials, subjectLabel } from '@/lib/labels';
import { getSession } from '@/lib/session';

/**
 * The Grasp platform shell — every signed-in feature renders inside it, so the
 * product reads as one place with five rooms, not five separate tools.
 *
 * Sign-in and onboarding are enforced by each page (`requireOnboarded(path)`),
 * which knows its own path for the `?next=` return. Until both hold, the shell
 * steps aside and lets the page redirect.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.onboarded) return <>{children}</>;

  const { profile } = session;
  const subtitle = [
    profile.stage !== null ? stageLabel(profile.stage, profile.region) : 'Self-study',
    profile.subjects.map(subjectLabel).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ShellFrame
      user={{
        name: session.name,
        email: session.email,
        initials: initials(session.name, session.email),
        subtitle,
      }}
    >
      {children}
    </ShellFrame>
  );
}
