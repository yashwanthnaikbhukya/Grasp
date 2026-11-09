'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Grasp's own confirm and notice dialogs — never `window.confirm`/`alert`,
 * which draw the browser's "localhost:3000 says" box over the product.
 *
 * Built on the native `<dialog>` opened with `showModal()`: the browser makes
 * the page behind inert, keeps focus inside, and closes on Escape. Focus goes
 * to the safe choice (Cancel) and returns to whatever opened the dialog.
 *
 *   const [confirm, dialog] = useConfirm();
 *   if (!(await confirm({ title: 'Delete this chat?', confirmLabel: 'Delete', tone: 'danger' }))) return;
 *   …render {dialog} somewhere in the tree.
 */

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  /** `null` makes it a notice: one button, nothing to cancel. */
  cancelLabel?: string | null;
  tone?: 'default' | 'danger';
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const safeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    safeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  const notice = options.cancelLabel === null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a pointer convenience — Escape (the native `cancel`) and the buttons are the keyboard paths.
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={options.body ? bodyId : undefined}
      // Escape: the browser fires `cancel`; close on our terms so the promise settles.
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      // A click on the backdrop lands on the <dialog> itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {options.title}
      </h2>
      {options.body && (
        <p id={bodyId} className="dialog-body">
          {options.body}
        </p>
      )}
      <div className="dialog-actions">
        {!notice && (
          <button ref={safeRef} type="button" className="btn btn-ghost" onClick={() => onClose(false)}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
        )}
        <button
          ref={notice ? safeRef : undefined}
          type="button"
          className={`btn${options.tone === 'danger' ? ' btn-danger' : ''}`}
          onClick={() => onClose(true)}
        >
          {options.confirmLabel ?? 'OK'}
        </button>
      </div>
    </dialog>
  );
}

export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );

  const element = pending ? (
    <ConfirmDialog
      options={pending.options}
      onClose={(ok) => {
        pending.resolve(ok);
        setPending(null);
      }}
    />
  ) : null;

  return [confirm, element];
}
