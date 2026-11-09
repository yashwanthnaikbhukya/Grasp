'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon, SystemIcon } from '@/components/brand/icons';

/**
 * Appearance: system, light or dark. Stored per browser (it is a property of the
 * screen, not of the learner) and applied as `data-theme` on <html>, which the
 * token blocks in globals.css respond to. The inline script in app/layout.tsx
 * applies it before first paint, so there is no flash of the wrong theme.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_KEY = 'grasp.theme';

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage blocked — the choice still applies for this page */
  }
}

function readTheme(): ThemeChoice {
  const t = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  return t === 'light' || t === 'dark' ? t : 'system';
}

const OPTIONS: { id: ThemeChoice; label: string; Icon: typeof SunIcon }[] = [
  { id: 'system', label: 'System', Icon: SystemIcon },
  { id: 'light', label: 'Light', Icon: SunIcon },
  { id: 'dark', label: 'Dark', Icon: MoonIcon },
];

/** A three-way switch, as native radios so arrows and announcements just work. */
export function ThemeSwitch({ name = 'theme', compact = false }: { name?: string; compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => setChoice(readTheme()), []);

  return (
    <fieldset className={`theme-switch${compact ? ' compact' : ''}`}>
      <legend className="sr-only">Appearance</legend>
      {OPTIONS.map((o) => (
        <label key={o.id} className="theme-opt" data-checked={choice === o.id} title={o.label}>
          <input
            type="radio"
            name={name}
            value={o.id}
            checked={choice === o.id}
            onChange={() => {
              setChoice(o.id);
              applyTheme(o.id);
            }}
            className="sr-only"
          />
          <o.Icon size={16} />
          <span className={compact ? 'sr-only' : undefined}>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
