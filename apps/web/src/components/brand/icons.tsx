import type { ReactNode, SVGProps } from 'react';

/**
 * Grasp's icon family — drawn for this product, on the logo's terms.
 *
 * 24 × 24 grid, 1.8 stroke, round caps and joins, `currentColor` so the active
 * state is a colour change and both themes come for free. Each feature icon
 * carries the logo's filled node somewhere — the shared mark that makes five
 * features read as one product.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number; title?: string };

function Icon({ size = 22, title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

// ---- Features ---------------------------------------------------------------

/** Today — the sun coming up over your day's work. */
export const TodayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 18.5h18" />
    <path d="M7 18.5a5 5 0 0 1 10 0" />
    <path d="M12 7.2V5" />
    <path d="M6.6 9.8 5 8.2" />
    <path d="M17.4 9.8 19 8.2" />
    <circle cx="12" cy="18.5" r="1.7" fill="currentColor" stroke="none" />
  </Icon>
);

/** Ask — a speech bubble holding a question, its dot the logo's node. */
export const AskIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 4.5h11A2.5 2.5 0 0 1 20 7v7.5a2.5 2.5 0 0 1-2.5 2.5H12l-4.3 3.3V17H6.5A2.5 2.5 0 0 1 4 14.5V7a2.5 2.5 0 0 1 2.5-2.5Z" />
    <path d="M10 8.9a2.1 2.1 0 1 1 2.9 1.9c-.6.3-.9.8-.9 1.4" />
    <circle cx="12" cy="14.6" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
);

/** Reps — a short stack of cards, the top one answered. */
export const RepsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 4h9A2.5 2.5 0 0 1 20 6.5v9" />
    <rect x="4" y="7.5" width="12.5" height="12.5" rx="2.5" />
    <path d="m7.4 13.9 2.2 2.2 3.7-4.2" />
    <circle cx="20" cy="18.6" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
);

/** Map — three ideas and how they depend on each other. */
export const MapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.2 6.6 17.8 9.2" />
    <path d="M6.2 6.6 10 17.6" />
    <path d="M17.8 9.2 10 17.6" />
    <circle cx="6.2" cy="6.6" r="2.3" fill="currentColor" stroke="none" />
    <circle cx="17.8" cy="9.2" r="2.3" fill="currentColor" stroke="none" />
    <circle cx="10" cy="17.6" r="2.3" fill="currentColor" stroke="none" />
  </Icon>
);

/** Slips — a lens on a mistake: looking at *why*, not just *what*. */
export const SlipsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10.5" cy="10.5" r="6.3" />
    <path d="m15.2 15.2 4.8 4.8" />
    <path d="M10.5 7.6v3.6" />
    <circle cx="10.5" cy="13.7" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
);

// ---- Interface ---------------------------------------------------------------

export const ProfileIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5a7 7 0 0 1 14 0" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1 1M17.4 17.4l1 1M5.6 18.4l1-1M17.4 6.6l1-1" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />
  </Icon>
);

export const SystemIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="11.5" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </Icon>
);

export const SignOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4.5h3.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H14" />
    <path d="M10 8.5 6.5 12l3.5 3.5M6.5 12H15" />
  </Icon>
);

export const ChatsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5V11a2.5 2.5 0 0 1-2.5 2.5H9l-3 2.5v-2.5h0A2 2 0 0 1 4 11Z" />
    <path d="M19 9.5a1.5 1.5 0 0 1 1 1.4V15a2 2 0 0 1-2 2h0v2.5L15 17h-3" />
  </Icon>
);

/** The sidebar itself — open / collapse. */
export const SidebarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

// ---- Ask: composer and message actions ---------------------------------------

export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

/** Stop — a rounded square, the universal "stop generating". */
export const StopIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </Icon>
);

export const PaperclipIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m20 11.5-7.6 7.6a5 5 0 0 1-7.1-7.1l7.9-7.9a3.3 3.3 0 0 1 4.7 4.7l-7.9 7.9a1.7 1.7 0 0 1-2.4-2.4l7.2-7.2" />
  </Icon>
);

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
    <path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const SpeakerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);

export const RetryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Icon>
);

export const ThumbUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 10.5v9h-3v-9h3Z" />
    <path d="M7.5 10.5 11 4.2a1.9 1.9 0 0 1 3.5 1.3l-.7 3.5h4.4a2 2 0 0 1 2 2.4l-1.3 6.1a2 2 0 0 1-2 1.5H7.5" />
  </Icon>
);

export const ThumbDownIcon = (p: IconProps) => (
  <Icon {...p} style={{ transform: 'rotate(180deg)', ...p.style }}>
    <path d="M7.5 10.5v9h-3v-9h3Z" />
    <path d="M7.5 10.5 11 4.2a1.9 1.9 0 0 1 3.5 1.3l-.7 3.5h4.4a2 2 0 0 1 2 2.4l-1.3 6.1a2 2 0 0 1-2 1.5H7.5" />
  </Icon>
);

export const EditIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.2L16 4.8a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.7 18.5l-4.2 1Z" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Icon>
);

export const FileIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 3.5H7.2a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8.8l-5.3-5.3Z" />
    <path d="M13.5 3.5v5.3h5.3M8.8 13h6.4M8.8 16.5h4.2" />
  </Icon>
);

/** Sources — an open book, the syllabus behind an answer. */
export const BookIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 6.5c-1.8-1.3-4.3-1.8-7.5-1.5v12.5c3.2-.3 5.7.2 7.5 1.5 1.8-1.3 4.3-1.8 7.5-1.5V5c-3.2-.3-5.7.2-7.5 1.5Z" />
    <path d="M12 6.5V19" />
  </Icon>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

/** Delete — a bin. Destructive; never a ×, which means close or remove-from-here. */
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 7h15M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
    <path d="M6.5 7l.8 11.3a2 2 0 0 0 2 1.7h5.4a2 2 0 0 0 2-1.7L17.5 7" />
    <path d="M10.2 10.8v5.4M13.8 10.8v5.4" />
  </Icon>
);

/** Reply — the turn handed to the learner. */
export const ReplyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 8 4.5 12.5l5 4.5" />
    <path d="M4.5 12.5h9a6 6 0 0 1 6 6V19" />
  </Icon>
);
