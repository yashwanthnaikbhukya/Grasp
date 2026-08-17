import type { Metadata } from 'next';
import { Sora, Manrope, JetBrains_Mono } from 'next/font/google';
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
 * Three roles, deliberately paired:
 *
 *   Sora          headings. Geometric with slightly squared bowls, so it holds
 *                 its shape at large sizes without turning generic.
 *   Manrope       everything read at length. Semi-rounded terminals are what
 *                 make it feel smooth rather than merely clean, and it stays
 *                 legible at 16px through a long explanation — which is most of
 *                 what this product is.
 *   JetBrains Mono numbers, concept ids, code. Tall x-height and unambiguous
 *                 0/O and 1/l/I, which matters when a learner is reading an
 *                 equation or a slug.
 *
 * Weights are pinned to the ones actually used. Shipping the full variable range
 * of three families would be a few hundred KB for nothing.
 */

const display = Sora({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display-src',
  display: 'swap',
});

const body = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body-src',
  display: 'swap',
});

const mono = JetBrains_Mono({
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
