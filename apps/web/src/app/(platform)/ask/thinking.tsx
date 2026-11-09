'use client';

import { useEffect, useState } from 'react';
import type { ChatMode } from '@grasp/schema';

export type ThinkingPhase = 'reading' | 'thinking';

/**
 * What the tutor is doing before its first word — told honestly.
 *
 * The phase is real: `reading` until the server has understood the question and
 * searched the syllabus (the `meta` event), `thinking` from then until the first
 * token. Within a phase the line rotates through what that step actually
 * involves, so a slow provider reads as work, not as a hang.
 */
const LINES: Record<ThinkingPhase, (ctx: { sources: number; files: number; mode: ChatMode }) => string[]> = {
  reading: ({ files }) => [
    files > 0 ? `Reading your ${files > 1 ? 'files' : 'file'}` : 'Reading your question',
    'Checking what you have covered',
    'Searching your syllabus',
  ],
  thinking: ({ sources, mode }) => [
    sources > 0 ? `Found ${sources} source${sources > 1 ? 's' : ''} in your syllabus` : 'Working from first principles',
    mode === 'coach' ? 'Planning the first hint' : mode === 'answer' ? 'Working it out' : 'Planning the steps',
    'Choosing the clearest way to say it',
    'Checking the working',
  ],
};

export function Thinking({
  phase,
  sources = 0,
  files = 0,
  mode,
}: {
  phase: ThinkingPhase;
  sources?: number;
  files?: number;
  mode: ChatMode;
}) {
  const lines = LINES[phase]({ sources, files, mode });
  const [i, setI] = useState(0);

  // A new phase starts from its first line.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on phase change only.
  useEffect(() => setI(0), [phase]);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), 2_400);
    return () => clearInterval(id);
  }, []);

  const line = lines[Math.min(i, lines.length - 1)] ?? lines[0];

  return (
    // The avatar beside this turns while it shows (`.thinking-avatar`).
    <div className="thinking">
      {/* Announced once per phase, not on every rotation. */}
      <span className="sr-only" role="status">
        {phase === 'reading' ? 'Grasp is reading your question' : 'Grasp is thinking'}
      </span>
      <span key={line} className="thinking-line" aria-hidden="true">
        {line}…
      </span>
    </div>
  );
}
