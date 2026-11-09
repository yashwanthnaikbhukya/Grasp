'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ChatMode } from '@grasp/schema';
import { CheckIcon, ChevronDownIcon } from '@/components/brand/icons';

/** How the tutor answers. Chosen per message, remembered per conversation. */
export const MODES: { id: ChatMode; label: string; hint: string }[] = [
  { id: 'answer', label: 'Answer', hint: 'The full answer straight away' },
  { id: 'teach', label: 'Teach', hint: 'Step by step, then a quick check' },
  { id: 'coach', label: 'Coach', hint: 'You work it out, one hint at a time' },
];

export const modeLabel = (m: ChatMode | undefined) => MODES.find((x) => x.id === m)?.label ?? '';

/**
 * The mode picker in the composer — a menu button, as in Claude's model picker.
 *
 * A real ARIA menu: Enter/Space/↓ opens it on the checked item, ↑/↓/Home/End
 * move, Enter or Space picks, Escape or Tab closes and focus returns to the
 * button. Opens upward, because it sits at the bottom of the screen.
 */
export function ModeMenu({
  mode,
  onChange,
  disabled,
}: {
  mode: ChatMode;
  onChange: (m: ChatMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const current = MODES.find((m) => m.id === mode) ?? MODES[1];

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const checkedIndex = Math.max(0, MODES.findIndex((m) => m.id === mode));

  return (
    <div className="mode-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="mode-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Tutor mode: ${current?.label}`}
        title={current?.hint}
        disabled={disabled}
        onClick={() => (open ? close() : openAt(checkedIndex))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openAt(e.key === 'ArrowUp' ? MODES.length - 1 : checkedIndex);
          }
        }}
      >
        {current?.label}
        <ChevronDownIcon size={15} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="How the tutor answers"
          className="mode-pop"
          onKeyDown={(e) => {
            const last = MODES.length - 1;
            if (e.key === 'ArrowDown') setActive((a) => (a >= last ? 0 : a + 1));
            else if (e.key === 'ArrowUp') setActive((a) => (a <= 0 ? last : a - 1));
            else if (e.key === 'Home') setActive(0);
            else if (e.key === 'End') setActive(last);
            else if (e.key === 'Escape') close();
            else if (e.key === 'Tab') close(false);
            else return;
            if (e.key !== 'Tab') e.preventDefault();
          }}
        >
          <p className="mode-pop-title">How should the tutor answer?</p>
          {MODES.map((m, i) => (
            <button
              key={m.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={m.id === mode}
              tabIndex={i === active ? 0 : -1}
              className="mode-item"
              onClick={() => {
                onChange(m.id);
                close();
              }}
            >
              <span className="mode-item-text">
                <strong>{m.label}</strong>
                <span>{m.hint}</span>
              </span>
              <span className="mode-item-check" aria-hidden="true">
                {m.id === mode && <CheckIcon size={16} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
