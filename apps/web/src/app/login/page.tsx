'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { signIn, signUp } from '@/lib/auth-client';

type Mode = 'signin' | 'signup';

function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/app';

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signingUp = mode === 'signup';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const result = signingUp
      ? await signUp.email({ email, password, name: name || email.split('@')[0] || 'Learner' })
      : await signIn.email({ email, password });

    setBusy(false);

    if (result.error) {
      // Say what to do, not just what failed.
      const msg = result.error.message ?? 'Something went wrong.';
      setError(
        /exist/i.test(msg)
          ? 'That email is already registered — sign in instead.'
          : /invalid|credential|password/i.test(msg)
            ? 'That email and password do not match an account.'
            : msg,
      );
      return;
    }

    // New accounts have no profile yet, so they go to onboarding first.
    router.push(signingUp ? '/onboarding' : next);
    router.refresh();
  }

  return (
    <main className="wrap rise" style={{ maxWidth: '27rem' }}>
      <p className="eyebrow">Grasp</p>
      <h1 style={{ fontSize: '1.75rem', margin: '0 0 var(--s2)' }}>
        {signingUp ? 'Create your account' : 'Welcome back'}
      </h1>
      <p className="muted" style={{ marginBottom: 'var(--s6)', fontSize: '0.95rem' }}>
        {signingUp
          ? 'Then a few questions so explanations land at the right level.'
          : 'Pick up where you left off.'}
      </p>

      <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 'var(--s4)', padding: 'var(--s6)' }}>
        {signingUp && (
          <label style={{ display: 'grid', gap: 'var(--s2)' }}>
            <span className="eyebrow" style={{ margin: 0 }}>Name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="What should we call you?"
            />
          </label>
        )}

        <label style={{ display: 'grid', gap: 'var(--s2)' }}>
          <span className="eyebrow" style={{ margin: 0 }}>Email</span>
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        <label style={{ display: 'grid', gap: 'var(--s2)' }}>
          <span className="eyebrow" style={{ margin: 0 }}>Password</span>
          <input
            className="input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
          />
          {signingUp && (
            <span className="muted" style={{ fontSize: '0.8rem' }}>At least 8 characters.</span>
          )}
        </label>

        {error && (
          <p
            role="alert"
            className="pill pill-bad"
            style={{ padding: 'var(--s3)', whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0 }}
          >
            {error}
          </p>
        )}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'One moment…' : signingUp ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="muted" style={{ fontSize: '0.9rem', marginTop: 'var(--s4)' }}>
        {signingUp ? 'Already have an account?' : 'New here?'}{' '}
        <button
          type="button"
          className="linkbtn"
          onClick={() => {
            setMode(signingUp ? 'signin' : 'signup');
            setError(null);
          }}
        >
          {signingUp ? 'Sign in' : 'Create one'}
        </button>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="wrap" />}>
      <AuthForm />
    </Suspense>
  );
}
