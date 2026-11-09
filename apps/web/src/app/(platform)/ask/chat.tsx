'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_CHAT_MODE, stageLabel, type ChatMode } from '@grasp/schema';
import { ArrowDownIcon } from '@/components/brand/icons';
import { GraspMark } from '@/components/brand/logo';
import { CHATS_CHANGED } from '@/components/shell/frame';
import { Composer, type AttachmentView, type ComposerHandle } from './composer';
import { AssistantMessage, UserMessage, type Msg, type Source } from './message';
import { MODES } from './mode-menu';
import { awaitsReply, splitClosingQuestion } from './question';
import { speechLang, toSpeech } from './speakable';
import { starterQuestions } from './suggestions';

const MODE_KEY = 'grasp.ask.mode';

function readStoredMode(): ChatMode {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return MODES.some((m) => m.id === v) ? (v as ChatMode) : DEFAULT_CHAT_MODE;
  } catch {
    return DEFAULT_CHAT_MODE;
  }
}

function storeMode(mode: ChatMode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode or blocked storage — the default is fine */
  }
}


type SendOptions = { regenerate?: boolean; editLast?: boolean };

export function AskChat({
  learnerName,
  profileSummary,
}: {
  learnerName: string;
  profileSummary: { stage: number | null; region: string; subjects: string[]; goal: string; language: string };
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [title, setTitle] = useState('');
  // The latest answer that has finished arriving and typing out — only then is
  // its closing question the learner's turn.
  const [settledId, setSettledId] = useState<string | null>(null);
  // The question the learner chose not to answer — the composer goes back to normal.
  const [skippedId, setSkippedId] = useState<string | null>(null);

  const lang = speechLang(profileSummary.language, profileSummary.region);

  // Read after mount — localStorage does not exist during server render.
  useEffect(() => setModeState(readStoredMode()), []);
  const setMode = (next: ChatMode) => {
    setModeState(next);
    storeMode(next);
  };

  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  /**
   * The open conversation lives in the URL (`/ask?session=…`) — chats are listed
   * in the shell's sidebar, so a conversation is linkable, reload-safe and works
   * with Back/Forward. `shownRef` is the session on screen, so the URL catching
   * up after a new chat is created doesn't reload what is already showing.
   */
  const params = useSearchParams();
  const sessionParam = params.get('session');
  // Opening a saved conversation: show neither the greeting nor an empty thread
  // while it loads — the greeting flashed up on every reload.
  const [loading, setLoading] = useState(Boolean(sessionParam));
  const prefill = params.get('q');
  const shownRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the URL only; the helpers are stable in effect.
  useEffect(() => {
    if (sessionParam === shownRef.current) return;
    if (sessionParam) void openConvo(sessionParam);
    else newConvo();
  }, [sessionParam]);

  // `?q=` — another feature handing over a question ("Ask about this").
  // Prefilled, not sent: the learner stays in charge of what goes to the tutor.
  useEffect(() => {
    if (prefill) composerRef.current?.setText(prefill);
  }, [prefill]);

  // Stop reading aloud when leaving the page.
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  // --- scrolling: follow the answer only while the learner is at the bottom ---
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
      stickRef.current = near;
      setAtBottom(near);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // The typing reveal grows the thread without re-rendering this component, so
  // watch its size rather than the message list.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom();
    });
    ro.observe(thread);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  async function openConvo(id: string) {
    abortRef.current?.abort();
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
    shownRef.current = id;
    setSessionId(id);
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/sessions?id=${id}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setError('That conversation could not be opened.');
      return;
    }
    const data = (await res.json()) as { session?: { mode?: ChatMode; title?: string }; messages: Msg[] };
    stickRef.current = true;
    setMessages(data.messages);
    setTitle(data.session?.title ?? '');
    // Reopen in the mode the conversation was last in.
    if (data.session?.mode) setModeState(data.session.mode);
    requestAnimationFrame(() => scrollToBottom());
  }

  function newConvo() {
    abortRef.current?.abort();
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
    shownRef.current = null;
    setSessionId(null);
    setMessages([]);
    setTitle('');
    setError(null);
    composerRef.current?.focus();
  }

  async function send(text: string, files: AttachmentView[] = [], opts: SendOptions = {}) {
    if (busy) return;
    if (!opts.regenerate && !text.trim() && files.length === 0) return;

    setError(null);
    setBusy(true);
    stickRef.current = true;
    if (!title && !opts.regenerate) setTitle(text || files[0]?.name || 'New chat');

    const now = Date.now();
    const assistantMsg: Msg = {
      id: `tmp-a-${now}`,
      localKey: `tmp-a-${now}`,
      role: 'assistant',
      text: '',
      streaming: true,
      live: true,
      phase: 'reading',
      mode,
      files: files.length,
    };

    setMessages((all) => {
      const lastUser = all.map((m) => m.role).lastIndexOf('user');
      if (opts.regenerate) {
        // The question stays; its old answer gives way to the new one.
        const kept = lastUser >= 0 ? all.slice(0, lastUser + 1) : all;
        const q = kept[kept.length - 1];
        return [...kept, { ...assistantMsg, files: q?.attachments?.length ?? 0 }];
      }
      if (opts.editLast && lastUser >= 0) {
        const prev = all[lastUser];
        const edited: Msg = { id: `tmp-u-${now}`, localKey: `tmp-u-${now}`, role: 'user', text, attachments: prev?.attachments };
        return [...all.slice(0, lastUser), edited, { ...assistantMsg, files: prev?.attachments?.length ?? 0 }];
      }
      return [...all, { id: `tmp-u-${now}`, localKey: `tmp-u-${now}`, role: 'user', text, attachments: files }, assistantMsg];
    });
    requestAnimationFrame(() => scrollToBottom(true));

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (fn: (m: Msg) => Msg) =>
      setMessages((all) => all.map((m) => (m.id === assistantMsg.id ? fn(m) : m)));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId,
          mode,
          attachmentIds: files.map((f) => f.id),
          regenerate: Boolean(opts.regenerate),
          editLast: Boolean(opts.editLast),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          res.status === 429
            ? 'You are sending messages quickly — give it a few seconds.'
            : res.status === 400 || res.status === 409
              ? (body.error ?? 'That message could not be sent.')
              : 'Could not reach the tutor. Try again.',
        );
        setMessages((m) => m.filter((x) => x.id !== assistantMsg.id));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a network chunk can split
        // one, so only complete frames are parsed.
        for (let sep = buffer.indexOf('\n\n'); sep >= 0; sep = buffer.indexOf('\n\n')) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          const eventLine = frame.split('\n').find((l) => l.startsWith('event:'));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.slice(6).trim();
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event === 'meta') {
            if (!sessionId) {
              const id = String(data.sessionId);
              shownRef.current = id;
              setSessionId(id);
              // Give the new conversation its address without a navigation.
              window.history.replaceState(null, '', `/ask?session=${id}`);
            }
            patch((m) => ({
              ...m,
              phase: m.text ? m.phase : 'thinking',
              sources: data.sources as Source[],
              mode: (data.mode as ChatMode | undefined) ?? m.mode,
              meta: {
                intent: data.intent as string,
                rewritten: data.rewritten as string,
                concepts: data.concepts as string[],
                ms: (data.timings as { total?: number })?.total,
              },
            }));
          } else if (event === 'token') {
            patch((m) => ({ ...m, phase: 'writing', text: m.text + String(data.text ?? '') }));
          } else if (event === 'cite') {
            patch((m) => ({ ...m, flags: data.flags as string[] }));
          } else if (event === 'done') {
            const realId = String(data.assistantMessageId);
            setMessages((all) =>
              all.map((m) => (m.id === assistantMsg.id ? { ...m, id: realId, streaming: false } : m)),
            );
            // Later patches must find it under its new id.
            assistantMsg.id = realId;
            // The sidebar lists chats; a new or retitled one should appear now.
            window.dispatchEvent(new Event(CHATS_CHANGED));
          } else if (event === 'error') {
            setError(String(data.message ?? 'Something went wrong.'));
            patch((m) => ({ ...m, streaming: false }));
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Lost connection. Try again.');
    } finally {
      setMessages((all) =>
        all
          .map((x) => (x.streaming ? { ...x, streaming: false } : x))
          // Stopped before a single word: nothing worth keeping on screen.
          .filter((x) => !(x.id === assistantMsg.id && !x.text)),
      );
      setBusy(false);
      abortRef.current = null;
    }
  }

  function speak(msg: Msg) {
    const synth = window.speechSynthesis;
    if (!synth) {
      setError('Reading aloud is not available in this browser.');
      return;
    }
    synth.cancel();
    if (speakingId === msg.id) {
      setSpeakingId(null);
      return;
    }
    const utter = new SpeechSynthesisUtterance(toSpeech(msg.text));
    utter.lang = lang;
    const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
    if (voice) utter.voice = voice;
    utter.onend = () => setSpeakingId((id) => (id === msg.id ? null : id));
    utter.onerror = () => setSpeakingId((id) => (id === msg.id ? null : id));
    setSpeakingId(msg.id);
    synth.speak(utter);
  }

  async function rate(msg: Msg, rating: 'up' | 'down' | null) {
    const before = msg.feedback ?? null;
    setMessages((all) => all.map((m) => (m.id === msg.id ? { ...m, feedback: rating } : m)));
    const res = await fetch('/api/chat/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: msg.id, rating }),
    }).catch(() => null);
    if (!res?.ok) {
      setMessages((all) => all.map((m) => (m.id === msg.id ? { ...m, feedback: before } : m)));
    }
  }

  const markSettled = useCallback((m: Msg) => setSettledId(m.id), []);

  // The tutor's closing question, while it waits for the learner (question.ts):
  // Teach and Coach only, and never once the learner has skipped it.
  const last = messages[messages.length - 1];
  const lastQuestion =
    last &&
    last.role === 'assistant' &&
    awaitsReply(last.mode) &&
    last.id !== skippedId &&
    !busy &&
    !last.streaming &&
    (settledId === last.id || !last.live)
      ? splitClosingQuestion(last.text)
      : null;
  const replyTo = last && lastQuestion ? { messageId: last.id, question: lastQuestion.question, mode: last.mode } : null;

  // Hand the turn over: put the cursor in the reply box. Not on touch screens,
  // where focusing would throw the keyboard up over the answer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per question, keyed by its message.
  useEffect(() => {
    if (!replyTo) return;
    if (window.matchMedia('(pointer: fine)').matches) composerRef.current?.focus();
  }, [replyTo?.messageId]);

  const stageText =
    profileSummary.stage !== null ? stageLabel(profileSummary.stage, profileSummary.region) : 'Self-study';
  const empty = messages.length === 0 && !loading;
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  const lastIdx = messages.length - 1;

  return (
    <main className="ask" data-empty={empty || undefined}>
      <div className="ask-scroll" ref={scrollerRef}>
        <div ref={threadRef}>
          {loading && messages.length === 0 ? (
            <div className="ask-thread" aria-busy="true">
              <div className="ask-loading" />
            </div>
          ) : empty ? (
            <div className="ask-hello">
              <GraspMark size={44} />
              <h1>What are you working on{learnerName ? `, ${learnerName.split(' ')[0]}` : ''}?</h1>
              <p className="muted">Answers are grounded in your syllabus and pitched at {stageText}.</p>
            </div>
          ) : (
            <div className="ask-thread">
              <h1 className="sr-only">{title || 'Conversation'}</h1>
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <UserMessage
                    key={m.localKey ?? m.id}
                    msg={m}
                    canEdit={!busy && i === lastUserIdx && Boolean(sessionId)}
                    onEdit={(t) => void send(t, [], { editLast: true })}
                  />
                ) : (
                  <AssistantMessage
                    key={m.localKey ?? m.id}
                    msg={m}
                    canRegenerate={!busy && i === lastIdx && Boolean(sessionId)}
                    speaking={speakingId === m.id}
                    awaitingReply={Boolean(replyTo) && i === lastIdx}
                    onSettled={markSettled}
                    onRegenerate={() => void send('', [], { regenerate: true })}
                    onSpeak={speak}
                    onFeedback={(msg, r) => void rate(msg, r)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>

      <div className="ask-dock">
        {!empty && !atBottom && (
          <button
            type="button"
            className="jump-btn"
            aria-label="Jump to latest"
            onClick={() => {
              stickRef.current = true;
              scrollToBottom(true);
            }}
          >
            <ArrowDownIcon size={18} />
          </button>
        )}
        {error && (
          <p role="alert" className="ask-error">
            {error}
          </p>
        )}
        <Composer
          ref={composerRef}
          busy={busy}
          mode={mode}
          onMode={setMode}
          onSend={(t, f) => void send(t, f)}
          onStop={() => abortRef.current?.abort()}
          sessionId={sessionId}
          lang={lang}
          replyTo={replyTo}
          onSkipReply={() => replyTo && setSkippedId(replyTo.messageId)}
        />
        {empty && (
          <div className="ask-suggest">
            {starterQuestions(profileSummary.subjects).map((q) => (
              <button key={q} type="button" className="chip" onClick={() => void send(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
