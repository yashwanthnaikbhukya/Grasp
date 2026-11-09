/**
 * Loading placeholders shaped like the page that is coming. Shown by each
 * feature's `loading.tsx` the instant a link is clicked — before, the old page
 * sat on screen with no feedback until the new one had rendered on the server,
 * which read as lag (2026-11-09).
 */
export function Skel({ w = '100%', h = 14, r, className = '' }: { w?: string | number; h?: number; r?: number; className?: string }) {
  return <span className={`skel ${className}`} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

/** The common page frame: eyebrow, title, subtitle — then the page's own blocks. */
export function PageSkeleton({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <main className="page skel-page" aria-busy="true">
      <span className="sr-only" role="status">
        Loading {label}…
      </span>
      <div className="skel-head">
        <Skel w={64} h={10} />
        <Skel w="min(340px, 70%)" h={30} r={8} />
        <Skel w="min(260px, 55%)" h={12} />
      </div>
      {children}
    </main>
  );
}
