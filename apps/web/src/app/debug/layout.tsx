import { notFound } from 'next/navigation';

/**
 * Everything under /debug is for the developer. In production it does not exist:
 * the gateway page makes two live model calls per load, and nothing here is
 * behind sign-in. (docs/07-phases.md, Phase H.3)
 */
export default function DebugLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}
