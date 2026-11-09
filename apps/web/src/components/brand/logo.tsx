/**
 * The Grasp mark and wordmark.
 *
 * The mark is a rounded **G** drawn as one open stroke — a hand closing around
 * something. Its crossbar ends in a warm node: the idea, held at the centre. A
 * second node sits on the open end of the stroke, so the G also reads as an edge
 * in a graph — the concept map and the learner model the whole product runs on.
 *
 * Geometry (48 × 48 grid): arc centred at (24, 24), r = 14, from −50° round
 * the long way to 0°, then a crossbar in to the centre. Round caps and joins
 * throughout, to agree with the rounded type (Quicksand, Nunito).
 *
 * Colour comes from theme tokens, so the mark follows light and dark. `tile` is
 * the app-icon form (white G on a cobalt tile), the same artwork as app/icon.svg.
 */

type Variant = 'color' | 'mono' | 'tile';

export function GraspMark({
  size = 32,
  variant = 'color',
  title,
  className,
}: {
  size?: number;
  variant?: Variant;
  /** Set when the mark stands alone as a link or image; omit when text sits beside it. */
  title?: string;
  className?: string;
}) {
  const stroke =
    variant === 'tile' ? '#ffffff' : variant === 'mono' ? 'currentColor' : 'var(--cobalt)';
  const idea = variant === 'mono' ? 'currentColor' : variant === 'tile' ? '#f4b860' : 'var(--ochre)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {variant === 'tile' && (
        <>
          <defs>
            <linearGradient id="grasp-tile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#4a74f0" />
              <stop offset="1" stopColor="#1a3fb8" />
            </linearGradient>
          </defs>
          <rect width="48" height="48" rx="12" fill="url(#grasp-tile)" />
        </>
      )}
      <g transform={variant === 'tile' ? 'translate(24 24) scale(0.82) translate(-24 -24)' : undefined}>
        {/* The G: open arc, then the crossbar in to the centre. */}
        <path
          d="M33 13.28 A14 14 0 1 0 38 24 H28.4"
          stroke={stroke}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* The open end — an edge leaving the node it belongs to. */}
        <circle cx="33" cy="13.28" r="3.4" fill={stroke} />
        {/* The idea, held at the centre. */}
        <circle cx="25.2" cy="24" r="4.4" fill={idea} />
      </g>
    </svg>
  );
}

/** Mark + lowercase wordmark. The wordmark is live text, so it scales and reads. */
export function GraspLogo({
  size = 28,
  variant = 'color',
  className,
}: {
  size?: number;
  variant?: Exclude<Variant, 'tile'>;
  className?: string;
}) {
  return (
    <span className={`grasp-logo${className ? ` ${className}` : ''}`} style={{ fontSize: size * 0.82 }}>
      <GraspMark size={size} variant={variant} />
      <span className="grasp-wordmark">grasp</span>
    </span>
  );
}
