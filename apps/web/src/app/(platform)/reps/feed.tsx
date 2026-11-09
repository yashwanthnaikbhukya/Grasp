'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptRequest, AttemptResult, FeedCard, FeedPool, FeedResponse } from '@grasp/schema';
import { ArrowRightIcon } from '@/components/brand/icons';
import { Markdown } from '../ask/markdown';

type Card = FeedCard;
type Graded = AttemptResult;

const POOL_LABEL: Record<FeedPool, string> = {
  due: 'Review',
  weak: 'Needs work',
  frontier: 'New',
  interleave: 'Keeping fresh',
};

export function RepsFeed({ initial }: { initial?: FeedResponse }) {
  // `?concept=` — sent here from Today or the Map to practise one idea.
  const focus = useSearchParams().get('concept');
  const [cards, setCards] = useState<Card[]>(initial?.cards ?? []);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [loading, setLoading] = useState(!initial);
  const [empty, setEmpty] = useState<string | null>(
    initial && !initial.cards.length ? (initial.message ?? 'Nothing to practice right now.') : null,
  );
  // 'caught-up': everything ready was answered today — "Load more" would loop.
  const [emptyKind, setEmptyKind] = useState<string | null>(
    initial && !initial.cards.length ? (initial.empty ?? null) : null,
  );
  // The server sent the first set with the page; don't fetch it again on mount.
  const skipFirstLoad = useRef(Boolean(initial));
  const [streak, setStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // Latency is real signal for the mastery engine — fast+wrong reads as careless,
  // slow+wrong as a conceptual gap. Measured from when the card is shown.
  const shownAt = useRef<number>(Date.now());
  // `graded` only lands after the round trip, so a second keypress while the
  // first answer is in flight would record a second attempt and fold mastery
  // twice. A ref, not state: it must be visible to that keypress synchronously.
  const submitting = useRef(false);
  // One id per card *shown*, minted client-side. It is the server's idempotency
  // key, so a retried POST is recognised as the same attempt, not a second one.
  const attemptId = useRef<string>(crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/feed?count=12${focus ? `&concept=${encodeURIComponent(focus)}` : ''}`);
    const data = (await res.json()) as FeedResponse;
    setCards(data.cards ?? []);
    setEmpty(data.cards?.length ? null : (data.message ?? 'Nothing to practice right now.'));
    setEmptyKind(data.cards?.length ? null : (data.empty ?? null));
    setIndex(0);
    setLoading(false);
    shownAt.current = Date.now();
    attemptId.current = crypto.randomUUID();
  }, [focus]);

  useEffect(() => {
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false;
      return;
    }
    void load();
  }, [load]);

  const card = cards[index];

  async function answer(optionId: string) {
    if (!card || graded || submitting.current) return;
    submitting.current = true;
    setPicked(optionId);

    const res = await fetch('/api/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: attemptId.current,
        questionId: card.id,
        answer: optionId,
        latencyMs: Date.now() - shownAt.current,
        hintsUsed: 0,
        // Position is the fatigue signal — a late-session failure on a concept
        // they usually hold reads as time pressure, not as not knowing it.
        positionInSession: index,
        sessionLength: cards.length,
      } satisfies AttemptRequest),
    });

    if (!res.ok) {
      // Let them try again rather than leaving the card stuck.
      submitting.current = false;
      setPicked(null);
      return;
    }
    const result = (await res.json()) as Graded;
    setGraded(result);
    setAnswered((n) => n + 1);
    if (result.correct) {
      setCorrectCount((n) => n + 1);
      setStreak((s) => s + 1);
      // A short haptic on mobile makes the feedback feel physical. Absent on
      // desktop and on iOS Safari, so it can only ever be a bonus.
      navigator.vibrate?.(12);
    } else {
      setStreak(0);
      navigator.vibrate?.([8, 40, 8]);
    }
  }

  function next() {
    setLeaving(true);
    // Let the card animate out before it is replaced.
    setTimeout(() => {
      setPicked(null);
      setGraded(null);
      setLeaving(false);
      submitting.current = false;
      shownAt.current = Date.now();
      attemptId.current = crypto.randomUUID();
      if (index + 1 >= cards.length) void load();
      else setIndex((i) => i + 1);
    }, 180);
  }

  // Keyboard: 1-9 to answer, Enter or space to continue. The feed has to be
  // fully operable without a pointer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (graded) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          next();
        }
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && card && n <= card.options.length) {
        const option = card.options[n - 1];
        if (option) void answer(option.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loading) {
    return (
      <main className="reps">
        <div className="reps-card card" style={{ minHeight: '18rem' }} aria-busy="true">
          <div className="reps-skeleton" />
          <div className="reps-skeleton short" />
        </div>
      </main>
    );
  }

  if (empty || !card) {
    return (
      <main className="reps">
        <div className="reps-card card rise" style={{ textAlign: 'center' }}>
          <p className="eyebrow">Reps</p>
          <h1 style={{ fontSize: '1.4rem', marginBottom: 'var(--s3)' }}>
            {answered > 0
              ? 'That’s the set done.'
              : emptyKind === 'caught-up'
                ? 'All caught up for today'
                : 'Nothing to practice yet'}
          </h1>
          <p className="muted">{empty}</p>
          {answered > 0 && (
            <p style={{ marginTop: 'var(--s4)' }}>
              {correctCount} of {answered} correct.
            </p>
          )}
          <p className="row" style={{ justifyContent: 'center', marginTop: 'var(--s5)' }}>
            {emptyKind === 'caught-up' ? (
              <>
                <Link className="btn" href="/map">
                  See your map
                </Link>
                <Link className="btn btn-ghost" href="/app">
                  Back to Today
                </Link>
              </>
            ) : (
              <>
                <button type="button" className="btn" onClick={() => void load()}>
                  Load more
                </button>
                <Link className="btn btn-ghost" href="/app">
                  Back
                </Link>
              </>
            )}
            {focus && (
              <Link className="btn btn-ghost" href="/reps">
                Practice everything
              </Link>
            )}
          </p>
        </div>
      </main>
    );
  }

  const progress = cards.length > 0 ? (index / cards.length) * 100 : 0;

  return (
    <main className="reps">
      <header className="reps-head">
        <div className="reps-title">
          <h1>Practice</h1>
          {focus && card && (
            <span className="muted">
              {' '}
              · {card.conceptName} ·{' '}
              <Link href="/reps" className="reps-unfocus">
                Practice everything
              </Link>
            </span>
          )}
        </div>
        <div className="reps-stats">
          {streak > 1 && <span className="pill pill-warn">{streak} in a row</span>}
          <span className="mono muted">
            {index + 1}/{cards.length}
          </span>
        </div>
      </header>

      <div className="reps-progress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>

      <div className="reps-stage">
        <article
          key={card.id}
          className={`reps-card card${leaving ? ' leaving' : ''}`}
          aria-live="polite"
        >
          <div className="reps-meta">
            <span className="pill pill-info">{POOL_LABEL[card.pool]}</span>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {card.conceptName}
            </span>
          </div>

          <div className="reps-stem">
            <Markdown text={card.stem} />
          </div>

          <div className="reps-options">
            {card.options.map((option, i) => {
              const isPicked = picked === option.id;
              const isKey =
                graded !== null && String(graded.correctAnswer ?? '') === option.id;

              const tone = !graded
                ? ''
                : isKey
                  ? ' right'
                  : isPicked
                    ? ' wrong'
                    : ' dim';

              return (
                <button
                  key={option.id}
                  type="button"
                  className={`reps-option${isPicked ? ' picked' : ''}${tone}`}
                  disabled={graded !== null}
                  onClick={() => void answer(option.id)}
                >
                  <kbd>{i + 1}</kbd>
                  <span>
                    <Markdown text={option.text} />
                  </span>
                </button>
              );
            })}
          </div>

          {graded && (
            <div className={`reps-verdict slide-in ${graded.correct ? 'ok' : 'no'}`}>
              <strong>{graded.correct ? 'Correct' : 'Not quite'}</strong>
              <div className="reps-solution">
                <Markdown text={graded.solution} />
                <p className="reps-ask">
                  <Link
                    href={`/ask?q=${encodeURIComponent(`I'm practicing this and want to understand it better:\n\n${card.stem}`)}`}
                  >
                    Ask the tutor about this <ArrowRightIcon size={15} />
                  </Link>
                </p>
              </div>
              {graded.mastery.length > 0 && (
                <p className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>
                  {graded.mastery
                    .map((m) => {
                      // A learner-facing line: the idea's name, not its slug.
                      const name = m.conceptId === card.conceptId ? card.conceptName : m.conceptId.replace(/-/g, ' ');
                      return `${name} · now ${Math.round(m.p * 100)}% held`;
                    })
                    .join(' · ')}
                </p>
              )}
            </div>
          )}
        </article>
      </div>

      <footer className="reps-foot">
        {graded ? (
          // biome-ignore lint/a11y/noAutofocus: focus moves to Continue only after the learner answers, so Enter advances — the keyboard flow Reps is built around (1–9 answer, Enter next).
          <button type="button" className="btn" onClick={next} autoFocus>
            Continue
          </button>
        ) : (
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            Press <kbd>1</kbd>–<kbd>{card.options.length}</kbd> or tap an answer
          </p>
        )}
      </footer>
    </main>
  );
}
