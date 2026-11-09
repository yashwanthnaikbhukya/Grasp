'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { AnswerSource, ChatMode } from '@grasp/schema';
import {
  BookIcon,
  CheckIcon,
  CopyIcon,
  EditIcon,
  FileIcon,
  ReplyIcon,
  RetryIcon,
  SpeakerIcon,
  StopIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from '@/components/brand/icons';
import { GraspMark } from '@/components/brand/logo';
import type { AttachmentView } from './composer';
import { Markdown } from './markdown';
import { modeLabel } from './mode-menu';
import { awaitsReply, splitClosingQuestion } from './question';
import { Thinking } from './thinking';
import { useTypewriter } from './use-typewriter';

/** Rule 3: the shape is the schema's, not a hand-written copy. */
export type Source = AnswerSource;

export interface Msg {
  id: string;
  /**
   * The React key, fixed when the message is created. `id` changes from a
   * temporary one to the server's when the answer is saved; keying on it
   * remounted the answer and replayed the typing from the start.
   */
  localKey?: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: Source[];
  meta?: { intent?: string; rewritten?: string; concepts?: string[]; ms?: number };
  flags?: string[];
  mode?: ChatMode;
  attachments?: AttachmentView[];
  feedback?: 'up' | 'down' | null;
  /** Still arriving from the server. */
  streaming?: boolean;
  /** Written during this visit — revealed with the typing effect. History appears whole. */
  live?: boolean;
  /** Before the first word: what the tutor is doing. */
  phase?: 'reading' | 'thinking' | 'writing';
  /** How many files the question carried, for the thinking line. */
  files?: number;
}

/**
 * Quality flags, as a learner should read them. The rest (`budget-shed`,
 * `keyword-only`, `fabricated-citation`) are review signals: stored on the
 * message for evals and traces, never shown.
 */
const FLAG_NOTE: Record<string, { label: string; title: string }> = {
  interrupted: { label: 'Stopped early', title: 'You stopped this answer before it finished.' },
  ungrounded: {
    label: 'General explanation',
    title: 'Not drawn from your study material — check it against your notes or textbook.',
  },
  'no-material': {
    label: 'General explanation',
    title: 'Grasp has no study material on this yet, so this is general knowledge — check it against your notes or textbook.',
  },
};

/** An icon button with its label as tooltip and accessible name. */
function Action({
  label,
  onClick,
  pressed,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`msg-action${pressed ? ' on' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(id);
  }, [copied]);
  return [
    copied,
    (text: string) => {
      void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
    },
  ];
}

function Attachments({ items }: { items: AttachmentView[] }) {
  return (
    <ul className="msg-files" aria-label="Attached files">
      {items.map((a) => {
        const href = `/api/attachments/${a.id}`;
        return (
          <li key={a.id}>
            <a href={href} target="_blank" rel="noopener" className="msg-file" title={`Open ${a.name}`}>
              {a.kind === 'image' ? (
                // biome-ignore lint/performance/noImgElement: a private, per-learner file behind auth — not something next/image can or should cache.
                <img src={a.previewUrl ?? href} alt={a.name} className="msg-file-img" loading="lazy" />
              ) : (
                <span className="msg-file-doc">
                  <FileIcon size={18} />
                  <span>{a.name}</span>
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// ---- the learner's message ----------------------------------------------------

export const UserMessage = memo(function UserMessage({
  msg,
  canEdit,
  onEdit,
}: {
  msg: Msg;
  canEdit: boolean;
  onEdit: (text: string) => void;
}) {
  const [copied, copy] = useCopied();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.text);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [editing]);

  return (
    <article className="msg msg-user" aria-label="You said">
      {msg.attachments && msg.attachments.length > 0 && <Attachments items={msg.attachments} />}
      {editing ? (
        <form
          className="msg-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            setEditing(false);
            onEdit(draft.trim());
          }}
        >
          <label className="sr-only" htmlFor={`edit-${msg.id}`}>
            Edit your message
          </label>
          <textarea
            id={`edit-${msg.id}`}
            ref={editRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="msg-edit-bar">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-sm" disabled={!draft.trim()}>
              Send
            </button>
          </div>
        </form>
      ) : (
        msg.text && <div className="bubble">{msg.text}</div>
      )}
      {!editing && msg.text && (
        <div className="msg-actions">
          <Action label={copied ? 'Copied' : 'Copy message'} onClick={() => copy(msg.text)}>
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          </Action>
          {canEdit && (
            <Action
              label="Edit message"
              onClick={() => {
                setDraft(msg.text);
                setEditing(true);
              }}
            >
              <EditIcon size={16} />
            </Action>
          )}
        </div>
      )}
    </article>
  );
});

// ---- the tutor's answer ---------------------------------------------------------

export const AssistantMessage = memo(function AssistantMessage({
  msg,
  canRegenerate,
  speaking,
  awaitingReply,
  onRegenerate,
  onSpeak,
  onFeedback,
  onSettled,
}: {
  msg: Msg;
  canRegenerate: boolean;
  speaking: boolean;
  /** This is the latest message and its question is waiting for the learner. */
  awaitingReply: boolean;
  onRegenerate: () => void;
  onSpeak: (msg: Msg) => void;
  onFeedback: (msg: Msg, rating: 'up' | 'down' | null) => void;
  /** Fired once the answer has finished arriving and typing out. */
  onSettled?: (msg: Msg) => void;
}) {
  const [copied, copy] = useCopied();
  const [showSources, setShowSources] = useState(false);
  const typed = useTypewriter(msg.text, Boolean(msg.live));
  const writing = msg.streaming || !typed.done;
  const settled = !writing && msg.text.length > 0;
  const flags = (msg.flags ?? []).filter((f) => f in FLAG_NOTE);
  // Once settled, a Teach or Coach closing question is the learner's turn —
  // shown as one. An Answer's closing offer stays part of the answer.
  const split = settled && awaitsReply(msg.mode) ? splitClosingQuestion(msg.text) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: report each message once, when it settles.
  useEffect(() => {
    if (settled) onSettled?.(msg);
  }, [settled, msg.id]);

  return (
    <article className="msg msg-assistant" aria-label="Grasp said" aria-busy={writing}>
      <span className={`msg-avatar${!msg.text && msg.streaming ? ' thinking-avatar' : ''}`} aria-hidden="true">
        <GraspMark size={20} />
      </span>
      <div className="msg-main">
        {!msg.text && msg.streaming ? (
          <Thinking
            phase={msg.phase === 'thinking' ? 'thinking' : 'reading'}
            sources={msg.sources?.length ?? 0}
            files={msg.files ?? 0}
            mode={msg.mode ?? 'teach'}
          />
        ) : (
          <div className="msg-body">
            {split ? (
              <>
                {split.body && <Markdown text={split.body} />}
                <div className={`msg-ask${awaitingReply ? ' awaiting' : ''}`} id={`ask-${msg.id}`}>
                  <span className="msg-ask-label">
                    <ReplyIcon size={14} />
                    {awaitingReply ? 'Your turn' : 'Grasp asked'}
                  </span>
                  <Markdown text={split.question} />
                </div>
              </>
            ) : (
              typed.text && <Markdown text={typed.text} streaming={writing} />
            )}
            {writing && <span className="ask-caret" aria-hidden="true" />}
          </div>
        )}

        {settled && (
          <div className="msg-foot">
            <div className="msg-actions">
              <Action label={copied ? 'Copied' : 'Copy answer'} onClick={() => copy(msg.text)}>
                {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
              </Action>
              <Action label={speaking ? 'Stop reading' : 'Read aloud'} pressed={speaking} onClick={() => onSpeak(msg)}>
                {speaking ? <StopIcon size={16} /> : <SpeakerIcon size={16} />}
              </Action>
              <Action
                label="Good answer"
                pressed={msg.feedback === 'up'}
                onClick={() => onFeedback(msg, msg.feedback === 'up' ? null : 'up')}
              >
                <ThumbUpIcon size={16} />
              </Action>
              <Action
                label="Bad answer"
                pressed={msg.feedback === 'down'}
                onClick={() => onFeedback(msg, msg.feedback === 'down' ? null : 'down')}
              >
                <ThumbDownIcon size={16} />
              </Action>
              {canRegenerate && (
                <Action label="Regenerate answer" onClick={onRegenerate}>
                  <RetryIcon size={16} />
                </Action>
              )}
            </div>

            <div className="msg-meta">
              {msg.mode && <span className="msg-mode">{modeLabel(msg.mode)}</span>}
              {flags.map((f) => (
                <span key={f} className="msg-flag" title={FLAG_NOTE[f]?.title}>
                  {FLAG_NOTE[f]?.label}
                </span>
              ))}
              {msg.sources && msg.sources.length > 0 && (
                <button
                  type="button"
                  className="msg-sources-btn"
                  aria-expanded={showSources}
                  onClick={() => setShowSources((s) => !s)}
                >
                  <BookIcon size={15} />
                  {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>
        )}

        {settled && showSources && msg.sources && (
          <div className="ask-detail">
            {msg.meta?.rewritten && (
              <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                Understood as: <em>{msg.meta.rewritten}</em>
              </p>
            )}
            {msg.sources.map((s) => (
              <div key={s.citeId} className="ask-source">
                <span className="pill pill-info">{s.citeId}</span>
                <div>
                  <strong>{s.heading}</strong>
                  <p className="muted">{s.excerpt}…</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
});
