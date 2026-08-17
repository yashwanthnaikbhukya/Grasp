'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signOut } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOut();
        router.push('/login');
        router.refresh();
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
