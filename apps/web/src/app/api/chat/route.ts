import type { Binary } from 'mongodb';
import {
  assemble,
  composeTurn,
  emit,
  generateStream,
  idempotencyKey,
  oid,
  queryForRetrieval,
  takeToken,
  taskConfig,
  verifyCitations,
  type TaskId,
  type TurnAttachment,
} from '@grasp/core';
import {
  ChatRequestSchema,
  normalizeCitations,
  type AnswerSource,
  type AttachmentKind,
  type ChatMode,
} from '@grasp/schema';
import { getSession } from '@/lib/session';
import { badRequest } from '@/lib/http';

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
 *
 * A turn can carry attachments (read into transcripts at upload — see
 * core/attachments), regenerate the latest answer, or replace the latest
 * question (`editLast`). Replaced messages are superseded, not deleted.
 *
 * The learner picks how the tutor talks — answer, teach or coach — per message;
 * the conversation remembers the latest choice. See docs/11-experience.md.
 */

/** One prompt per mode, so each mode's behaviour is attributable in the trace. */
const TUTOR_TASK: Record<ChatMode, TaskId> = {
  answer: 'tutor.answer',
  teach: 'tutor.teach',
  coach: 'tutor.coach',
};

/**
 * Earlier turns as real chat messages, merged where two of the same role are
 * adjacent (a turn whose answer failed leaves user→user, which some providers
 * reject). Empty texts are dropped.
 */
function toChatMessages(history: { role: 'user' | 'assistant'; text: string }[]) {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const h of history) {
    const text = h.text.trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === h.role) prev.content += `\n\n${text}`;
    else out.push({ role: h.role, content: text });
  }
  // The conversation must open with the student.
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}
/** Tutor turns per learner per minute. Generous for a person, tight for a script. */
const TURNS_PER_MINUTE = 12;

type MessageDoc = Record<string, unknown> & { _id: unknown; role?: string; parts?: unknown };

const textOf = (m: MessageDoc) =>
  String((m.parts as { kind?: string; text?: string }[] | undefined)?.find((p) => p.kind === 'text' || p.text)?.text ?? '');

const attachmentIdsOf = (m: MessageDoc) =>
  ((m.parts as { kind?: string; attachmentId?: unknown }[] | undefined) ?? [])
    .filter((p) => p.kind === 'attachmentRef')
    .map((p) => String(p.attachmentId));

/** Transcript kept per earlier file in history — enough to recall it, cheap to resend. */
const HISTORY_TRANSCRIPT_CHARS = 800;

export async function POST(req: Request) {
  // Time to first token is measured from here — the learner's wait, not the model's.
  const receivedAt = Date.now();
  const session = await getSession();
  if (!session) return new Response('not signed in', { status: 401 });

  const rate = takeToken(`chat:${session.userId}`, TURNS_PER_MINUTE, 60_000);
  if (!rate.ok) {
    return Response.json(
      { error: 'Too many messages in a minute — give it a few seconds.' },
      { status: 429, headers: { 'retry-after': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const parsed = ChatRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  const { mode, regenerate, editLast } = parsed.data;
  const task = TUTOR_TASK[mode];

  const scope = session.scope;

  // --- session ------------------------------------------------------------
  let sessionId = parsed.data.sessionId ?? undefined;
  if (sessionId) {
    // Scoped read: another learner's session id resolves to nothing.
    const existing = await scope.chatSessions().findOne({ _id: oid(sessionId) } as never);
    if (!existing) return new Response('no such conversation', { status: 404 });
    // The conversation reopens in the mode of its latest turn.
    if (existing.mode !== mode) {
      await scope.chatSessions().updateOne({ _id: oid(sessionId) } as never, { $set: { mode } });
    }
  } else {
    const created = await scope.chatSessions().insertOne({
      title: 'New chat',
      mode,
      digest: null,
      activeLeafId: null,
      tokenStats: { in: 0, out: 0, cachedIn: 0 },
      createdAt: new Date(),
      archivedAt: null,
    } as never);
    sessionId = String(created.insertedId);
  }

  // The *latest* 40 live messages, oldest-first. Sorting ascending before the
  // limit would freeze the context on the first 40 messages from turn 21 onward
  // — and hang every new message's parentMessageId off message #40.
  let priorDocs = (
    await scope
      .messages()
      .find({ sessionId: oid(sessionId), supersededAt: null } as never)
      .sort({ createdAt: -1 })
      .limit(40)
      .toArray()
  ).reverse() as MessageDoc[];

  // --- regenerate / edit: supersede the latest exchange --------------------
  const now = new Date();
  let lastUserIdx = -1;
  for (let i = priorDocs.length - 1; i >= 0; i--) {
    if (priorDocs[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  const lastUser = lastUserIdx >= 0 ? priorDocs[lastUserIdx] : undefined;
  if ((regenerate || editLast) && !lastUser) {
    return Response.json({ error: 'There is no question to redo in this conversation.' }, { status: 409 });
  }

  let text = parsed.data.message;
  let turnAttachmentIds = parsed.data.attachmentIds;
  let userMessageId: unknown;

  if (regenerate && lastUser) {
    // Answer the same question again: its old answer(s) step aside.
    const answers = priorDocs.slice(lastUserIdx + 1).map((d) => d._id);
    if (answers.length > 0) {
      await scope.messages().updateMany({ _id: { $in: answers } } as never, { $set: { supersededAt: now } } as never);
    }
    text = textOf(lastUser);
    turnAttachmentIds = attachmentIdsOf(lastUser);
    userMessageId = lastUser._id;
    priorDocs = priorDocs.slice(0, lastUserIdx);
  } else if (editLast && lastUser) {
    // Replace the question and everything after it. An edit that adds no new
    // files keeps the ones the original question had.
    const replaced = priorDocs.slice(lastUserIdx).map((d) => d._id);
    await scope.messages().updateMany({ _id: { $in: replaced } } as never, { $set: { supersededAt: now } } as never);
    if (turnAttachmentIds.length === 0) turnAttachmentIds = attachmentIdsOf(lastUser);
    priorDocs = priorDocs.slice(0, lastUserIdx);
  }

  // --- attachments: this turn's files, and the transcripts history mentions ---
  const historyAttachmentIds = priorDocs.flatMap(attachmentIdsOf);
  const wanted = [...new Set([...turnAttachmentIds, ...historyAttachmentIds])];
  const attachmentDocs = wanted.length
    ? await scope
        .attachments()
        .find({ _id: { $in: wanted.flatMap((id) => oid(id) ?? []) } } as never)
        .toArray()
    : [];
  const byId = new Map(attachmentDocs.map((a) => [String(a._id), a]));
  if (turnAttachmentIds.some((id) => !byId.has(id))) {
    // Another learner's id, an expired file, or a typo — all the same answer.
    return Response.json({ error: 'An attachment could not be found. Attach it again.' }, { status: 400 });
  }
  const toTurnAttachment = (id: string, withBytes: boolean): TurnAttachment => {
    const a = byId.get(id);
    const data = a?.data as Binary | null | undefined;
    return {
      filename: String(a?.filename ?? 'attachment'),
      kind: (a?.kind ?? 'text') as AttachmentKind,
      mime: String(a?.mime ?? 'text/plain'),
      text: (a?.extract as { text?: string } | null | undefined)?.text ?? null,
      ...(withBytes && data ? { bytes: new Uint8Array(data.buffer) } : {}),
    };
  };
  const turnAttachments = turnAttachmentIds.map((id) => toTurnAttachment(id, true));
  const turn = composeTurn(text, turnAttachments);

  const history = priorDocs.map((m) => {
    const role = (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant';
    const ids = attachmentIdsOf(m).filter((id) => byId.has(id));
    if (role === 'assistant' || ids.length === 0) return { role, text: textOf(m) };
    // Earlier files ride along as short transcripts, never as bytes again.
    const short = ids.map((id) => {
      const a = toTurnAttachment(id, false);
      return { ...a, text: a.text ? a.text.slice(0, HISTORY_TRANSCRIPT_CHARS) : null };
    });
    return { role, text: composeTurn(textOf(m), short).text };
  });

  const parentId = priorDocs.length > 0 ? priorDocs[priorDocs.length - 1]?._id : null;

  if (!userMessageId) {
    const inserted = await scope.messages().insertOne({
      sessionId: oid(sessionId),
      role: 'user',
      parentMessageId: parentId ?? null,
      parts: [
        { kind: 'text', text },
        ...turnAttachmentIds.map((id) => ({ kind: 'attachmentRef', attachmentId: oid(id) })),
      ],
      citations: [],
      flags: [],
      createdAt: now,
    } as never);
    userMessageId = inserted.insertedId;
    if (turnAttachmentIds.length > 0) {
      // Claimed by this message: no longer deletable from the composer.
      await scope.attachments().updateMany(
        { _id: { $in: turnAttachmentIds.flatMap((id) => oid(id) ?? []) }, messageId: null } as never,
        { $set: { messageId: userMessageId, sessionId: oid(sessionId) } } as never,
      );
    }
  }
  const userMessage = { insertedId: userMessageId };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // The learner can close the tab mid-answer. Writing to a cancelled stream
      // throws, and that used to abort the handler before the answer was saved.
      // Now a dead stream just stops receiving; the save below still happens.
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client gone */
        }
      };

      let answer = '';
      let provider = '';
      let model = '';
      let ttftMs: number | null = null;

      try {
        const bundle = await assemble({
          userId: session.userId,
          sessionId,
          // Understanding and retrieval see the message plus the start of
          // each file's transcript — "solve this" alone retrieves nothing.
          query: queryForRetrieval(text, turnAttachments),
          profile: session.profile,
          history,
          signal: req.signal,
        });

        // Sent now for the live answer, and saved with it for a reopened one.
        const sources: AnswerSource[] = bundle.retrieved.map((r) => ({
          citeId: r.citeId,
          chunkId: r.chunkId,
          heading: r.headingPath.join(' › '),
          excerpt: r.text.slice(0, 180),
        }));

        send('meta', {
          sessionId,
          userMessageId: String(userMessage.insertedId),
          intent: bundle.intent,
          rewritten: bundle.rewrittenQuery,
          concepts: bundle.conceptIds,
          sources,
          budget: { shed: bundle.budget.shed, used: bundle.budget.totalUsed },
          legs: bundle.retrievalLegs,
          timings: bundle.timings,
          mode,
        });

        for await (const chunk of generateStream({
          task,
          // Earlier turns as real messages; the template renders only this turn.
          messages: toChatMessages(bundle.history),
          // The student's message with each file's transcript under it; the
          // files themselves go to providers that can open them.
          files: turn.files,
          input: {
            query: turn.text,
            rewritten: bundle.rewrittenQuery,
            learnerCard: bundle.learnerCard,
            retrieved: bundle.retrieved,
            digest: bundle.digest,
          },
          userId: session.userId,
          signal: req.signal,
        })) {
          if (chunk.type === 'token' && chunk.text) {
            ttftMs ??= Date.now() - receivedAt;
            answer += chunk.text;
            send('token', { text: chunk.text });
          } else if (chunk.type === 'done') {
            provider = chunk.provider ?? '';
            model = chunk.model ?? '';
          } else if (chunk.type === 'error') {
            send('error', { message: chunk.error });
          }
        }

        // Saved in Grasp's marker style whatever the provider wrote (`【c1】` →
        // `[c1]`), so history, evals and a reload all read one form.
        answer = normalizeCitations(answer);

        // --- citation verification: the hallucination metric ---------------
        const check = verifyCitations(answer, bundle.citeMap);
        const flags: string[] = [];
        if (check.fabricated.length > 0) flags.push('fabricated-citation');
        if (check.ungrounded) flags.push('ungrounded');
        // Nothing relevant in the learner's material: a general-knowledge answer,
        // said so to the learner. Separate from `ungrounded` (had material, cited
        // none), which is the hallucination metric and must not be diluted.
        if (bundle.retrieved.length === 0 && ['explain', 'solve', 'quiz'].includes(bundle.intent) && answer.length > 200) {
          flags.push('no-material');
        }
        if (bundle.budget.shed.length > 0) flags.push('budget-shed');
        // The embedder was down, so retrieval was keyword-only. Visible in
        // review rather than silent (docs/07-phases.md, H.2).
        if ((bundle.retrievalLegs as { vector?: string } | undefined)?.vector === 'unavailable') {
          flags.push('keyword-only');
        }
        // Cut short by Stop or a closed tab — saved, but marked as partial.
        if (req.signal.aborted) flags.push('interrupted');

        send('cite', { cited: check.cited, fabricated: check.fabricated, flags });

        const assistantMessage = await scope.messages().insertOne({
          sessionId: oid(sessionId),
          role: 'assistant',
          parentMessageId: userMessage.insertedId,
          parts: [{ kind: 'text', text: answer }],
          citations: check.cited.map((id) => ({ chunkId: bundle.citeMap[id], quoted: '' })),
          sources,
          understoodAs: bundle.rewrittenQuery,
          model: `${provider}/${model}`,
          // From the registry, never a literal — rule 2: the version must be
          // the one that actually produced this text.
          promptVersion: taskConfig(task).prompt,
          mode,
          // Gate 1's number: request received → first token on the wire.
          ttftMs,
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
          const named = text || `About ${turnAttachments[0]?.filename ?? 'a file'}`;
          const title = named.length > 48 ? `${named.slice(0, 48).trimEnd()}…` : named;
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
          ttftMs,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Logged in full here; the learner gets a sentence, never the raw error.
        console.error('[chat]', e);
        send('error', {
          message: /provider|exhausted|rate/i.test(message)
            ? 'The tutor is busy right now. Wait a moment and try again.'
            : 'Something went wrong answering that. Try again.',
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
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
