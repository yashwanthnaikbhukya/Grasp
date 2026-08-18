'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from '../ask/markdown';

interface Card {
  id: string;
  type: string;
  stem: string;
  options: { id: string; text: string }[];
  conceptId: string;
  conceptName: string;
  pool: 'due' | 'weak' | 'frontier' | 'interleave';
}

interface Graded {
  correct: boolean;
  solution: string;
  correctAnswer: unknown;
  mastery: { conceptId: string; p: number; state: string }[];
}

const POOL_LABEL: Record<Card['pool'], string> = {
  due: 'Review',
  weak: 'Needs work',
  frontier: 'New',
  interleave: 'Keeping fresh',
};

export function RepsFeed({ learnerName }: { learnerName: string }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // Latency is real signal for the mastery engine — fast+wrong reads as careless,
  // slow+wrong as a conceptual gap. Measured from when the card is shown.
  const shownAt = useRef<number>(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/feed?count=12');
    const data = (await res.json()) as { cards: Card[]; empty?: string; message?: string };
    setCards(data.cards ?? []);
    setEmpty(data.cards?.length ? null : (data.message ?? 'Nothing to practise right now.'));
    setIndex(0);
    setLoading(false);
    shownAt.current = Date.now();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const card = cards[index];

  async function answer(optionId: string) {
    if (!card || graded) return;
    setPicked(optionId);

    const res = await fetch('/api/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        questionId: card.id,
        answer: optionId,
        latencyMs: Date.now() - shownAt.current,
        hintsUsed: 0,
        // Position is the fatigue signal — a late-session failure on a concept
        // they usually hold reads as time pressure, not as not knowing it.
        positionInSession: index,
        sessionLength: cards.length,
      }),
    });

    if (!res.ok) return;
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
      shownAt.current = Date.now();
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
            {answered > 0 ? 'That’s the set done.' : 'Nothing to practise yet'}
          </h1>
          <p className="muted">{empty}</p>
          {answered > 0 && (
            <p style={{ marginTop: 'var(--s4)' }}>
              {correctCount} of {answered} correct.
            </p>
          )}
          <p className="row" style={{ justifyContent: 'center', marginTop: 'var(--s5)' }}>
            <button type="button" className="btn" onClick={() => void load()}>
              Load more
            </button>
            <a className="btn btn-ghost" href="/app" style={{ textDecoration: 'none' }}>
              Back
            </a>
          </p>
        </div>
      </main>
    );
  }

  const progress = cards.length > 0 ? (index / cards.length) * 100 : 0;

  return (
    <main className="reps">
      <header className="reps-head">
        <a href="/app" className="ask-brand" style={{ fontSize: '0.95rem' }}>
          GRASP<span>.</span>
        </a>
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
              </div>
              {graded.mastery.length > 0 && (
                <p className="muted mono" style={{ fontSize: '0.75rem', margin: 0 }}>
                  {graded.mastery
                    .map((m) => `${m.conceptId} → ${(m.p * 100).toFixed(0)}% ${m.state}`)
                    .join(' · ')}
                </p>
              )}
            </div>
          )}
        </article>
      </div>

      <footer className="reps-foot">
        {graded ? (
          <button type="button" className="btn" onClick={next} autoFocus>
            Continue
          </button>
        ) : (
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            Press <kbd>1</kbd>–<kbd>{card.options.length}</kbd> or tap an answer
            {learnerName ? '' : ''}
          </p>
        )}
      </footer>
    </main>
  );
}
