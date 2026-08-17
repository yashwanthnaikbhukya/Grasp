import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grasp',
  description: 'One learner model, many surfaces.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
