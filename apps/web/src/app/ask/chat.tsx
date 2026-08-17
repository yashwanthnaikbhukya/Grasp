'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { stageLabel } from '@grasp/schema';
import { Markdown } from './markdown';

interface Source {
  citeId: string;
  chunkId: string;
  heading: string;
  excerpt: string;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: Source[];
  meta?: { intent?: string; rewritten?: string; concepts?: string[]; ms?: number };
  flags?: string[];
  streaming?: boolean;
}

interface Convo {
  id: string;
  title: string;
}

export function AskChat({
  learnerName,
  profileSummary,
}: {
  learnerName: string;
  profileSummary: { stage: number | null; region: string; subjects: string[]; goal: string };
}) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadConvos = useCallback(async () => {
    const res = await fetch('/api/sessions');
    if (res.ok) setConvos(((await res.json()) as { sessions: Convo[] }).sessions);
  }, []);

  useEffect(() => {
    void loadConvos();
  }, [loadConvos]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function openConvo(id: string) {
    setSessionId(id);
    setError(null);
    const res = await fetch(`/api/sessions?id=${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: Msg[] };
    setMessages(data.messages);
  }

  function newConvo() {
    abortRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;

    setError(null);
    setInput('');
    setBusy(true);

    const userMsg: Msg = { id: `tmp-u-${Date.now()}`, role: 'user', text };
    const assistantMsg: Msg = {
      id: `tmp-a-${Date.now()}`,
      role: 'assistant',
      text: '',
      streaming: true,
    };
    setMessages((m) => [...m, userMsg, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError(await res.text());
        setMessages((m) => m.filter((x) => x.id !== assistantMsg.id));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const patch = (fn: (m: Msg) => Msg) =>
        setMessages((all) => all.map((m) => (m.id === assistantMsg.id ? fn(m) : m)));

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a network chunk can split
        // one, so only complete frames are parsed.
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
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
            if (!sessionId) setSessionId(String(data.sessionId));
            patch((m) => ({
              ...m,
              sources: data.sources as Source[],
              meta: {
                intent: data.intent as string,
                rewritten: data.rewritten as string,
                concepts: data.concepts as string[],
                ms: (data.timings as { total?: number })?.total,
              },
            }));
          } else if (event === 'token') {
            patch((m) => ({ ...m, text: m.text + String(data.text ?? '') }));
          } else if (event === 'cite') {
            patch((m) => ({ ...m, flags: data.flags as string[] }));
          } else if (event === 'done') {
            patch((m) => ({ ...m, id: String(data.assistantMessageId), streaming: false }));
            void loadConvos();
          } else if (event === 'error') {
            setError(String(data.message ?? 'Something went wrong.'));
            patch((m) => ({ ...m, streaming: false }));
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Lost connection. Try again.');
    } finally {
      setMessages((m) => m.map((x) => ({ ...x, streaming: false })));
      setBusy(false);
      abortRef.current = null;
    }
  }

  const stageText =
    profileSummary.stage !== null ? stageLabel(profileSummary.stage, profileSummary.region) : 'Self-study';

  return (
    <div className="ask">
      <aside className="ask-side">
        <div className="ask-side-head">
          <a href="/app" className="ask-brand">GRASP<span>.</span></a>
          <button type="button" className="btn" onClick={newConvo}>New chat</button>
        </div>

        <nav className="ask-convos">
          {convos.length === 0 && (
            <p className="muted" style={{ fontSize: '0.85rem', padding: '0 var(--s2)' }}>
              No conversations yet.
            </p>
          )}
          {convos.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`ask-convo${c.id === sessionId ? ' on' : ''}`}
              onClick={() => void openConvo(c.id)}
            >
              {c.title}
            </button>
          ))}
        </nav>

        <div className="ask-side-foot">
          <p className="eyebrow" style={{ margin: 0 }}>Tutoring</p>
          <p className="muted" style={{ fontSize: '0.8rem', margin: '4px 0 0' }}>
            {stageText} · {profileSummary.subjects.join(', ') || 'no subject set'}
            <br />
            {profileSummary.goal}
          </p>
        </div>
      </aside>

      <main className="ask-main">
        {messages.length === 0 ? (
          <div className="ask-empty">
            <h1>What are you working on{learnerName ? `, ${learnerName.split(' ')[0]}` : ''}?</h1>
            <p className="muted">
              Answers are grounded in your syllabus and pitched at {stageText}.
            </p>
            <div className="chips" style={{ justifyContent: 'center', marginTop: 'var(--s5)' }}>
              {[
                'Prove that sin²θ + cos²θ = 1',
                'Why is sine never more than 1?',
                'How do I prove a trig identity?',
                'Explain angles of elevation',
              ].map((q) => (
                <button key={q} type="button" className="chip" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ask-thread">
            {messages.map((m) => (
              <article key={m.id} className={`ask-msg ask-${m.role}`}>
                <div className="ask-role">{m.role === 'user' ? 'You' : 'Grasp'}</div>
                <div className="ask-body">
                  {m.role === 'assistant' ? (
                    <>
                      {m.text ? <Markdown text={m.text} /> : null}
                      {m.streaming && <span className="ask-caret" aria-label="writing" />}

                      {m.sources && m.sources.length > 0 && (
                        <div className="ask-sources">
                          <button
                            type="button"
                            className="linkbtn"
                            onClick={() => setShowDetail(showDetail === m.id ? null : m.id)}
                          >
                            {m.sources.length} source{m.sources.length > 1 ? 's' : ''}
                            {m.meta?.ms ? ` · ${m.meta.ms} ms` : ''}
                          </button>

                          {showDetail === m.id && (
                            <div className="ask-detail">
                              {m.meta?.rewritten && m.meta.rewritten !== '' && (
                                <p className="muted" style={{ fontSize: '0.8rem' }}>
                                  Understood as: <em>{m.meta.rewritten}</em>
                                  {m.meta.concepts?.length
                                    ? ` · ${m.meta.concepts.join(', ')}`
                                    : ''}
                                </p>
                              )}
                              {m.sources.map((s) => (
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
                      )}

                      {m.flags && m.flags.length > 0 && (
                        <p className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                          {m.flags.map((f) => (
                            <span key={f} className="pill pill-warn" title="Quality flag">
                              {f}
                            </span>
                          ))}
                        </p>
                      )}
                    </>
                  ) : (
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                  )}
                </div>
              </article>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {error && (
          <p role="alert" className="ask-error">
            {error}
          </p>
        )}

        <form
          className="ask-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={inputRef}
            className="input"
            rows={1}
            value={input}
            placeholder="Ask anything about what you're studying…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — what people expect
              // from every chat product they already use.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </button>
          ) : (
            <button type="submit" className="btn" disabled={!input.trim()}>
              Send
            </button>
          )}
        </form>
      </main>
    </div>
  );
}
