import { assemble, emit, generateStream, idempotencyKey, oid, verifyCitations } from '@grasp/core';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
// Streaming needs the Node runtime — the Mongo driver is not edge-compatible.
export const runtime = 'nodejs';

/**
 * The Ask turn.
 *
 * Streams over SSE rather than returning a completed answer: a visible first
 * token beats a faster complete one, and for a tutor the learner starts reading
 * while the rest is still being written.
 *
 * Events emitted:
 *   meta   — bundle diagnostics, sent before the first token
 *   token  — a fragment of the answer
 *   cite   — citation verification, after generation
 *   done   — message ids, so the client can reconcile
 *   error  — a message written for the learner, not a stack trace
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new Response('not signed in', { status: 401 });

  let body: { message?: string; sessionId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response('expected JSON', { status: 400 });
  }

  const text = (body.message ?? '').trim();
  if (!text) return new Response('empty message', { status: 400 });

  const scope = session.scope;

  // --- session ------------------------------------------------------------
  let sessionId = body.sessionId;
  if (sessionId) {
    // Scoped read: another learner's session id resolves to nothing.
    const existing = await scope.chatSessions().findOne({ _id: oid(sessionId) } as never);
    if (!existing) return new Response('no such conversation', { status: 404 });
  } else {
    const created = await scope.chatSessions().insertOne({
      title: 'New chat',
      digest: null,
      activeLeafId: null,
      tokenStats: { in: 0, out: 0, cachedIn: 0 },
      createdAt: new Date(),
      archivedAt: null,
    } as never);
    sessionId = String(created.insertedId);
  }

  const priorDocs = await scope
    .messages()
    .find({ sessionId: oid(sessionId) } as never)
    .sort({ createdAt: 1 })
    .limit(40)
    .toArray();

  const history = priorDocs.map((m) => ({
    role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    text: String((m.parts as { text?: string }[] | undefined)?.[0]?.text ?? ''),
  }));

  const parentId = priorDocs.length > 0 ? priorDocs[priorDocs.length - 1]?._id : null;

  const userMessage = await scope.messages().insertOne({
    sessionId: oid(sessionId),
    role: 'user',
    parentMessageId: parentId ?? null,
    parts: [{ kind: 'text', text }],
    citations: [],
    flags: [],
    createdAt: new Date(),
  } as never);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let answer = '';
      let provider = '';
      let model = '';

      try {
        const bundle = await assemble({
          userId: session.userId,
          sessionId,
          query: text,
          profile: session.profile,
          history,
          signal: req.signal,
        });

        send('meta', {
          sessionId,
          intent: bundle.intent,
          rewritten: bundle.rewrittenQuery,
          concepts: bundle.conceptIds,
          sources: bundle.retrieved.map((r) => ({
            citeId: r.citeId,
            chunkId: r.chunkId,
            heading: r.headingPath.join(' › '),
            excerpt: r.text.slice(0, 180),
          })),
          budget: { shed: bundle.budget.shed, used: bundle.budget.totalUsed },
          legs: bundle.retrievalLegs,
          timings: bundle.timings,
        });

        for await (const chunk of generateStream({
          task: 'tutor.reply',
          input: {
            query: text,
            learnerCard: bundle.learnerCard,
            retrieved: bundle.retrieved,
            history: bundle.history,
            digest: bundle.digest,
          },
          userId: session.userId,
          signal: req.signal,
        })) {
          if (chunk.type === 'token' && chunk.text) {
            answer += chunk.text;
            send('token', { text: chunk.text });
          } else if (chunk.type === 'done') {
            provider = chunk.provider ?? '';
            model = chunk.model ?? '';
          } else if (chunk.type === 'error') {
            send('error', { message: chunk.error });
          }
        }

        // --- citation verification: the hallucination metric ---------------
        const check = verifyCitations(answer, bundle.citeMap);
        const flags: string[] = [];
        if (check.fabricated.length > 0) flags.push('fabricated-citation');
        if (check.ungrounded) flags.push('ungrounded');
        if (bundle.budget.shed.length > 0) flags.push('budget-shed');

        send('cite', { cited: check.cited, fabricated: check.fabricated, flags });

        const assistantMessage = await scope.messages().insertOne({
          sessionId: oid(sessionId),
          role: 'assistant',
          parentMessageId: userMessage.insertedId,
          parts: [{ kind: 'text', text: answer }],
          citations: check.cited.map((id) => ({ chunkId: bundle.citeMap[id], quoted: '' })),
          model: `${provider}/${model}`,
          promptVersion: 'tutor.reply@1',
          flags,
          createdAt: new Date(),
        } as never);

        await scope
          .chatSessions()
          .updateOne({ _id: oid(sessionId) } as never, {
            $set: { activeLeafId: assistantMessage.insertedId },
          });

        // Auto-title once there is a real exchange to name.
        if (priorDocs.length === 0) {
          const title = text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text;
          await scope
            .chatSessions()
            .updateOne({ _id: oid(sessionId) } as never, { $set: { title } });
        }

        // The doubt enters the learner's event stream, which is what lets it
        // reach Reps and gap detection later.
        if (bundle.conceptIds.length > 0) {
          await emit({
            type: 'doubt.asked',
            userId: session.userId,
            idempotencyKey: idempotencyKey(
              'doubt.asked',
              session.userId,
              String(userMessage.insertedId),
            ),
            payload: {
              conceptIds: bundle.conceptIds,
              sourceRef: `chat:${sessionId}`,
              surface: 'ask',
            },
          }).catch(() => {
            // An event write must never fail the learner's answer.
          });
        }

        send('done', {
          sessionId,
          userMessageId: String(userMessage.insertedId),
          assistantMessageId: String(assistantMessage.insertedId),
          provider,
          model,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        send('error', {
          message: /provider|exhausted|rate/i.test(message)
            ? 'Both model providers are rate-limited right now. Wait a moment and try again.'
            : 'Something went wrong answering that. Try again.',
          detail: message.slice(0, 200),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx and similar proxies buffer SSE by default, which turns a stream
      // into a single delayed blob.
      'x-accel-buffering': 'no',
    },
  });
}
