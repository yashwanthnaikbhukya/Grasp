import type { Metadata } from 'next';
import { Quicksand, Nunito, DM_Mono } from 'next/font/google';
import './globals.css';

/**
 * Typography.
 *
 * Self-hosted at build time by `next/font` — the files ship with the app, so
 * there is no request to a font CDN at runtime, no layout shift while a fallback
 * swaps out, and the product looks the same on a Windows laptop as on a Mac. The
 * previous system stack did none of that: `Avenir Next` exists only on Apple
 * devices, so most learners were seeing a different design.
 *
 * Rounded throughout — the whole set has soft, circular letterforms and rounded
 * stroke terminals, which is what makes text feel gentle rather than technical.
 * It also sits better against the glass surfaces: hard geometric corners fight
 * blurred edges, round ones agree with them.
 *
 *   Quicksand   headings. Fully rounded geometric — circular bowls, soft
 *               terminals. Kept at 600/700 because its lighter weights go
 *               flimsy at display sizes.
 *   Nunito      everything read at length. Rounded terminals with humanist
 *               proportions, so it stays warm without becoming cute, and it
 *               holds up through a long explanation — which is most of this
 *               product.
 *   DM Mono     numbers, concept ids, code. Softer and less mechanical than the
 *               usual coding monos, while keeping 0/O and 1/l/I distinct — which
 *               matters when someone is reading an equation or a slug.
 *
 * Weights are pinned to the ones actually used. Shipping the full variable range
 * of three families would be a few hundred KB for nothing.
 */

const display = Quicksand({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display-src',
  display: 'swap',
});

const body = Nunito({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body-src',
  display: 'swap',
});

const mono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-src',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Grasp',
  description: 'One learner model, many surfaces.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
