import type { ComponentType } from 'react';
import { AskIcon, MapIcon, RepsIcon, SlipsIcon, TodayIcon } from './icons';

/**
 * The features of Grasp, defined once — navigation, the Today page, the landing
 * page and the brand page all read from here, so a feature's name, icon, colour
 * and one-line purpose can never disagree between two screens.
 *
 * Colours are theme tokens (both themes defined in globals.css): each feature
 * gets a hue so it is recognisable at a glance, and every colour is paired with
 * its `-soft` tint for the badge tile.
 */

export type FeatureId = 'today' | 'ask' | 'reps' | 'map' | 'slips';

export interface Feature {
  id: FeatureId;
  name: string;
  href: string;
  /** One line, learner-facing. */
  line: string;
  Icon: ComponentType<{ size?: number; title?: string; className?: string }>;
  /** Token names, e.g. `--cobalt` / `--cobalt-soft`. */
  color: string;
  soft: string;
}

export const FEATURES: readonly Feature[] = [
  {
    id: 'today',
    name: 'Today',
    href: '/app',
    line: 'Your next step, your streak, and what to fix first.',
    Icon: TodayIcon,
    color: '--ochre',
    soft: '--ochre-soft',
  },
  {
    id: 'ask',
    name: 'Ask',
    href: '/ask',
    line: 'A tutor that answers, teaches or coaches — your choice.',
    Icon: AskIcon,
    color: '--cobalt',
    soft: '--cobalt-soft',
  },
  {
    id: 'reps',
    name: 'Reps',
    href: '/reps',
    line: 'Short practice, picked for what you are about to forget.',
    Icon: RepsIcon,
    color: '--ok',
    soft: '--ok-soft',
  },
  {
    id: 'map',
    name: 'Map',
    href: '/map',
    line: 'Every idea, what it depends on, and how well you hold it.',
    Icon: MapIcon,
    color: '--violet',
    soft: '--violet-soft',
  },
  {
    id: 'slips',
    name: 'Slips',
    href: '/slips',
    line: 'Your mistakes, grouped by why they happened.',
    Icon: SlipsIcon,
    color: '--bad',
    soft: '--bad-soft',
  },
];

export const featureById = (id: FeatureId): Feature =>
  FEATURES.find((f) => f.id === id) ?? (FEATURES[0] as Feature);

/** A feature's icon on its tinted tile — the feature "logo". */
export function FeatureBadge({ id, size = 40 }: { id: FeatureId; size?: number }) {
  const f = featureById(id);
  return (
    <span
      className="feature-badge"
      style={{
        width: size,
        height: size,
        color: `var(${f.color})`,
        background: `var(${f.soft})`,
        borderRadius: Math.round(size * 0.3),
      }}
      aria-hidden="true"
    >
      <f.Icon size={Math.round(size * 0.58)} />
    </span>
  );
}
