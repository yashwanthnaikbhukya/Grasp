'use client';

import { useEffect, useRef, useState } from 'react';

/** How often the reveal advances. 25 frames a second reads as typing, not flicker. */
const TICK_MS = 40;

export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

/**
 * Reveal streamed text through a queue, at a steady pace.
 *
 * Providers send tokens in bursts — nothing for 300 ms, then forty words at
 * once — which reads as jerky. The answer goes into a queue and comes out a few
 * characters per tick; the step grows with the backlog, so the reveal never
 * falls more than about a second behind the model, and a burst at the end drains
 * quickly instead of making the learner wait for text that has already arrived.
 *
 * `animate` is false for messages loaded from history — those appear whole. With
 * reduced motion requested, everything appears as it arrives.
 */
export function useTypewriter(target: string, animate: boolean): { text: string; done: boolean } {
  const reduce = usePrefersReducedMotion();
  const instant = !animate || reduce;
  const [shown, setShown] = useState(instant ? target.length : 0);
  const latest = useRef(target);
  latest.current = target;

  useEffect(() => {
    if (instant) {
      setShown(target.length);
      return;
    }
    if (shown >= target.length) return;
    const id = setTimeout(() => {
      setShown((s) => {
        const goal = latest.current.length;
        const backlog = goal - s;
        const step = Math.min(120, Math.max(3, Math.ceil(backlog * 0.14)));
        let next = Math.min(goal, s + step);
        // Never split a surrogate pair (an emoji, a rare symbol).
        const code = latest.current.charCodeAt(next - 1);
        if (code >= 0xd800 && code <= 0xdbff && next < goal) next += 1;
        return next;
      });
    }, TICK_MS);
    return () => clearTimeout(id);
  }, [shown, target, instant]);

  const visible = Math.min(shown, target.length);
  return { text: target.slice(0, visible), done: visible >= target.length };
}
