'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LIMITS,
  ATTACHMENT_MIME,
  type AttachmentKind,
  type AttachmentRef,
  type ChatMode,
} from '@grasp/schema';
import {
  ArrowUpIcon,
  CloseIcon,
  FileIcon,
  MicIcon,
  PaperclipIcon,
  ReplyIcon,
  StopIcon,
} from '@/components/brand/icons';
import { ModeMenu } from './mode-menu';
import { quickReplies } from './question';

/** An attachment as the conversation shows it: the server's record, plus a local preview. */
export type AttachmentView = AttachmentRef & { previewUrl?: string };

interface Pending {
  key: string;
  name: string;
  kind: AttachmentKind;
  status: 'uploading' | 'ready' | 'error';
  previewUrl?: string;
  ref?: AttachmentRef;
  error?: string;
}

export interface ComposerHandle {
  focus: () => void;
  setText: (text: string) => void;
}

function kindOf(file: File): AttachmentKind | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  for (const kind of ['image', 'pdf', 'text'] as const) {
    if (ATTACHMENT_MIME[kind].includes(file.type)) return kind;
  }
  if (['md', 'markdown', 'txt', 'csv'].includes(ext)) return 'text';
  if (ext === 'pdf') return 'pdf';
  return null;
}

/**
 * Photos are downscaled in the browser to ≤ 1,600 px before upload: still sharp
 * enough to read handwriting, a tenth of the bytes, and well inside the limit.
 * GIFs are left alone (they may be animated). Transparent PNGs get a white
 * ground, since JPEG has no alpha.
 */
async function prepareImage(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  const max = ATTACHMENT_LIMITS.imageMaxSide;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  return blob ?? file;
}

// ---- dictation --------------------------------------------------------------

/** The slice of the Web Speech API this uses; the DOM typings don't ship it. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---- the composer -----------------------------------------------------------

export const Composer = forwardRef<
  ComposerHandle,
  {
    busy: boolean;
    mode: ChatMode;
    onMode: (m: ChatMode) => void;
    onSend: (text: string, files: AttachmentView[]) => void;
    onStop: () => void;
    sessionId: string | null;
    lang: string;
    placeholder?: string;
    /**
     * The tutor's closing question, while it waits for the learner: the
     * composer becomes a reply box for it (quoted, with one-tap replies).
     */
    replyTo?: { messageId: string; question: string; mode?: ChatMode } | null;
    /** The learner won't answer it — back to a normal composer. Never a dead end. */
    onSkipReply?: () => void;
  }
>(function Composer({ busy, mode, onMode, onSend, onStop, sessionId, lang, placeholder, replyTo, onSkipReply }, ref) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Pending[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const [canDictate, setCanDictate] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<Recognition | null>(null);
  const dictationBase = useRef('');

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(t.length, t.length);
        }
      });
    },
  }));

  // Feature-detect after mount — the API exists only in some browsers.
  useEffect(() => setCanDictate(recognitionCtor() !== null), []);
  useEffect(() => () => recRef.current?.stop(), []);

  // Grow with the text, up to a cap; then scroll inside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // A note clears itself after a while.
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 6_000);
    return () => clearTimeout(id);
  }, [note]);

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const incoming = Array.from(list);
      const room = ATTACHMENT_LIMITS.perMessage - files.length;
      if (incoming.length > room) {
        setNote(`You can attach up to ${ATTACHMENT_LIMITS.perMessage} files to one message.`);
      }
      for (const file of incoming.slice(0, Math.max(0, room))) {
        const kind = kindOf(file);
        if (!kind) {
          setNote(`${file.name} isn't supported. Attach photos (PNG, JPEG, WebP), PDFs or text files.`);
          continue;
        }
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined;
        setFiles((f) => [...f, { key, name: file.name, kind, status: 'uploading', previewUrl }]);

        void (async () => {
          try {
            const blob = kind === 'image' ? await prepareImage(file) : file;
            if (blob.size > ATTACHMENT_LIMITS.maxBytes[kind]) {
              throw new Error(`Too large — the limit is ${Math.round(ATTACHMENT_LIMITS.maxBytes[kind] / 1024 / 1024) || 0.3} MB.`);
            }
            const form = new FormData();
            const name = blob === file ? file.name : file.name.replace(/\.\w+$/, '') + '.jpg';
            form.append('file', blob, name);
            if (sessionId) form.append('sessionId', sessionId);
            const res = await fetch('/api/attachments', { method: 'POST', body: form });
            const data = (await res.json().catch(() => ({}))) as AttachmentRef & { error?: string };
            if (!res.ok) throw new Error(data.error ?? 'Upload failed.');
            setFiles((f) => f.map((p) => (p.key === key ? { ...p, status: 'ready', ref: data } : p)));
            if (data.note) setNote(`${data.name}: ${data.note}`);
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Upload failed.';
            setFiles((f) => f.map((p) => (p.key === key ? { ...p, status: 'error', error: message } : p)));
          }
        })();
      }
    },
    [files.length, sessionId],
  );

  const remove = (p: Pending) => {
    setFiles((f) => f.filter((x) => x.key !== p.key));
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    // Unsent, so the server copy can go too.
    if (p.ref) void fetch(`/api/attachments/${p.ref.id}`, { method: 'DELETE' }).catch(() => {});
  };

  const uploading = files.some((f) => f.status === 'uploading');
  const ready = files.filter((f) => f.status === 'ready' && f.ref);
  const canSend = !busy && !uploading && (text.trim().length > 0 || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    recRef.current?.stop();
    onSend(
      text.trim(),
      ready.map((f) => ({ ...(f.ref as AttachmentRef), previewUrl: f.previewUrl })),
    );
    setText('');
    setFiles([]);
    setNote(null);
  };

  const toggleDictation = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    dictationBase.current = text ? `${text.replace(/\s+$/, '')} ` : '';
    rec.onresult = (e) => {
      let finals = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r?.[0]?.transcript ?? '';
        if (r?.isFinal) finals += t;
        else interim += t;
      }
      setText(dictationBase.current + finals + interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setNote('Microphone access is blocked. Allow it in your browser to dictate.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setNote('Dictation stopped. Try again.');
      }
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      textareaRef.current?.focus();
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setNote('Dictation could not start.');
    }
  };

  const replies = replyTo ? quickReplies(replyTo.mode) : [];
  const skipReply = () => {
    onSkipReply?.();
    textareaRef.current?.focus();
  };
  // Plain text for the one-line quote; the full question stays in the message.
  const quote = replyTo
    ? replyTo.question.replace(/\$+([^$]*)\$+/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
    : '';

  return (
    <div className="composer-wrap">
      <form
        className={`composer${dragging ? ' dragging' : ''}${listening ? ' listening' : ''}${replyTo ? ' replying' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        {files.length > 0 && (
          <ul className="composer-files" aria-label="Attached files">
            {files.map((f) => (
              <li key={f.key} className={`file-chip ${f.status}`} title={f.error ?? f.name}>
                {f.previewUrl ? (
                  // biome-ignore lint/performance/noImgElement: a local blob preview — next/image cannot optimise object URLs.
                  <img src={f.previewUrl} alt="" className="file-thumb" />
                ) : (
                  <span className="file-icon" aria-hidden="true">
                    <FileIcon size={18} />
                  </span>
                )}
                <span className="file-meta">
                  <span className="file-name">{f.name}</span>
                  <span className="file-status">
                    {f.status === 'uploading'
                      ? f.kind === 'text'
                        ? 'Uploading…'
                        : 'Reading…'
                      : f.status === 'error'
                        ? f.error
                        : f.kind === 'pdf'
                          ? 'PDF'
                          : f.kind === 'image'
                            ? 'Image'
                            : 'Text'}
                  </span>
                </span>
                {f.status === 'uploading' && <span className="file-spinner" aria-hidden="true" />}
                <button type="button" className="file-remove" aria-label={`Remove ${f.name}`} onClick={() => remove(f)}>
                  <CloseIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {replyTo && (
          <div className="composer-reply">
            <div className="composer-reply-head">
              <span className="composer-reply-label">
                <ReplyIcon size={14} /> Replying to Grasp
              </span>
              {onSkipReply && (
                <button
                  type="button"
                  className="composer-reply-skip"
                  aria-label="Skip this question"
                  title="Skip this question (Esc)"
                  onClick={skipReply}
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>
            <span className="composer-reply-quote" id="composer-reply-quote">
              {quote}
            </span>
            {replies.length > 0 && !busy && (
              <fieldset className="composer-quick">
                <legend className="sr-only">Quick replies</legend>
                {replies.map((r) => (
                  <button key={r.label} type="button" className="quick-reply" onClick={() => onSend(r.text, [])}>
                    {r.label}
                  </button>
                ))}
              </fieldset>
            )}
          </div>
        )}

        <label className="sr-only" htmlFor="ask-input">
          {replyTo ? 'Your answer to the tutor' : 'Message the tutor'}
        </label>
        <textarea
          id="ask-input"
          ref={textareaRef}
          rows={1}
          value={text}
          placeholder={
            listening
              ? 'Listening…'
              : replyTo
                ? 'Answer, or ask something else…'
                : (placeholder ?? 'Ask anything, or attach a photo of a question')
          }
          aria-describedby={replyTo ? 'composer-reply-quote' : undefined}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length > 0) {
              e.preventDefault();
              void addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line; never mid-IME composition.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape' && replyTo && !e.nativeEvent.isComposing) {
              // Escape skips the question, as it would close any other prompt.
              e.preventDefault();
              skipReply();
            }
          }}
        />

        <div className="composer-bar">
          <div className="composer-tools">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              hidden
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="tool-btn"
              aria-label="Attach files"
              title="Attach photos, PDFs or notes"
              disabled={files.length >= ATTACHMENT_LIMITS.perMessage}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon size={19} />
            </button>
            {canDictate && (
              <button
                type="button"
                className={`tool-btn${listening ? ' on' : ''}`}
                aria-label={listening ? 'Stop dictation' : 'Dictate'}
                aria-pressed={listening}
                title={listening ? 'Stop dictation' : 'Dictate with your voice'}
                onClick={toggleDictation}
              >
                <MicIcon size={19} />
              </button>
            )}
          </div>

          <div className="composer-actions">
            <ModeMenu mode={mode} onChange={onMode} />
            {busy ? (
              <button type="button" className="send-btn stop" aria-label="Stop answering" title="Stop" onClick={onStop}>
                <StopIcon size={18} />
              </button>
            ) : (
              <button
                type="submit"
                className="send-btn"
                aria-label={uploading ? 'Send — waiting for files to finish reading' : 'Send'}
                title={uploading ? 'Waiting for files…' : 'Send (Enter)'}
                disabled={!canSend}
              >
                <ArrowUpIcon size={18} />
              </button>
            )}
          </div>
        </div>
        {dragging && <div className="composer-drop" aria-hidden="true">Drop to attach</div>}
      </form>
      <p className="composer-note" role={note ? 'status' : undefined}>
        {note ?? 'Grasp can make mistakes — check working that matters.'}
      </p>
    </div>
  );
});
