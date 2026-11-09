# 11 — Experience

What Grasp should feel like to a learner, how the app is organised, and the bar
every screen has to clear. The other docs say what the substrate *is*; this one
says what the learner *sees*. Same honesty rule as everywhere else: what exists
is marked as existing, what is planned is marked as planned, and the work lives
in [07-phases.md](07-phases.md).

A screen that works but leaves the learner asking "what now?" is unfinished.

---

## Principles

1. **One next action.** Every screen answers "what should I do now?" with one
   primary button. Secondary things are quieter, not absent.
2. **The learner's language, never the schema's.** No `coursework`, `IN`,
   `stage 10`, `mathematics` in lowercase, or "user-scoped accessors" on a learner
   screen. Labels come from `stageLabel()`, region names and human goal names.
3. **Maths is first-class.** It is typeset, always. Raw LaTeX in a code chip
   (`sin\theta`) is a bug, not a style.
4. **Never a dead wait.** Anything model-backed shows a visible state within
   300 ms, says what it is doing by 3 s, and offers a way out by 30 s. A blinking
   cursor with no explanation is the worst state the product can be in.
5. **Show the learner model; don't narrate it.** Mastery heat, the delta after
   an answer, the weakest chain — numbers that mean something to *them*.
6. **Mobile first.** Thumb-reachable primary actions, one column under 768 px.
   Desktop is the wide case, not the default.
7. **Both themes, always** ([CLAUDE.md](../CLAUDE.md) rule 8), and
   `prefers-reduced-motion` respected.
8. **Accessible by construction** — WCAG 2.2 AA is the floor, not a polish pass.
9. **Our own interface, never the browser's.** No `window.confirm`/`alert`
   ("localhost:3000 says") — confirmations are `useConfirm()`
   (`components/ui/confirm.tsx`, a native `<dialog>`), and native form parts
   follow the theme (`color-scheme`, a drawn select chevron, one 46 px height for
   every single-line field).
10. **An icon means one thing.** Delete is a bin, close/remove-from-here is ×,
    go/next is an arrow icon — never a text glyph standing in for an icon.

---

## Design system — what exists

- **Tokens** on `:root` in `apps/web/src/app/globals.css`, redefined for dark
  under `prefers-color-scheme` *and* `[data-theme]`. Paper/ink neutrals, **cobalt**
  for action, **ochre** as the warm accent, `ok` / `bad` for verdicts.
- **Glass surfaces** (`--glass*`, `--blur`) applied uniformly; radii
  (`--r-sm` → `--r-xl`), easing and duration tokens.
- **Type**: Quicksand (display), Nunito (body), DM Mono (labels, kickers) —
  self-hosted by `next/font`, so no third-party font request at runtime.
- **Motion**: a `prefers-reduced-motion` block already exists.

Gaps:

- ☑ Theme toggle — Profile & settings and the account menu; per browser,
      applied before first paint. `data-theme` on any element themes that subtree.
- ☐ No shared accessible primitives. Choice chips, toggles and the checkbox are
      re-implemented per screen (see Accessibility). Build `Chip` (with
      `aria-pressed` or a `radiogroup`), `Field` (label + hint + error),
      `Checkbox`, `Button`, `Sheet` once, then use them everywhere.
- ☑ Maths, Markdown and diagrams on standard libraries — see *Rendering stack*.

---

## Rendering stack

Proper, maintained libraries — no hand-rolled parsers or SVG for things the
ecosystem already does well.

| What | Library | Why |
| --- | --- | --- |
| Formulas and equations | **KaTeX** (via rehype-katex) | Fast, typeset like print, emits MathML so screen readers read real maths. `trust` off, so a formula cannot inject markup |
| Answer text | **react-markdown** + **remark-gfm** + **remark-math** | CommonMark with tables, task lists and `$…$` / `$$…$$` maths. Raw HTML from the model is never rendered |
| Graphs and diagrams in answers | **Mafs** + **mathjs** | Mafs is React-native maths visualisation built for teaching (function plots, points, polygons, circles; pan and zoom). mathjs compiles `sin(x)` with its own sandboxed parser — never `eval` |
| Concept map | **React Flow** (`@xyflow/react`) | Pan, zoom, fit-to-view, arrowheads, keyboard focus; positions still come from Grasp's deterministic layout in `@grasp/core` |
| Charts (progress over time) | **Recharts** when the first chart lands | Not needed yet — no surface plots time series today |

Diagrams are a contract between the tutor prompt and the renderer: a ```plot
fence whose JSON is validated by `PlotSpecSchema` in `@grasp/schema`. A spec
that fails validation draws nothing; the words around it still teach.

---

## Identity

The **Grasp mark** is a rounded G drawn as one open stroke — a hand closing
around an idea. Its crossbar ends in a warm ochre node (the idea, held at the
centre); a second node on the open end makes the G read as an edge in a graph,
the learner model under every feature. Round caps throughout, to agree with
Quicksand and Nunito.

| Form | Where | File |
| --- | --- | --- |
| Mark + lowercase **grasp** wordmark | Sidebar, landing | `components/brand/logo.tsx` (`GraspLogo`) |
| Mark alone | Collapsed sidebar, small places | `GraspMark` |
| App icon — white G on a cobalt tile | Favicon / browser tab | `app/icon.svg` (`GraspMark variant="tile"`) |
| Single colour | Print, embossing | `GraspMark variant="mono"` |

**Feature icons** (`components/brand/icons.tsx`) are drawn for Grasp on the
logo's terms — 24 px grid, 1.8 stroke, round joins, `currentColor` — and each
carries the logo's filled node. Each feature has a colour (theme tokens, both
themes): **Today** ochre, **Ask** cobalt, **Reps** green, **Map** violet,
**Slips** rose. A `FeatureBadge` puts the icon on its tinted tile. Names, icons,
colours and one-line purposes are defined once, in `components/brand/features.tsx`
— navigation, Today, the landing page and the brand sheet all read it.

Review sheet (dev only): **`/debug/brand`** — every form at its sizes, light and dark.

---

## Information architecture — built 2026-11-08

One product, one navigation, after the pattern learners already know from
ChatGPT and Claude.

| Route | What it is |
| --- | --- |
| `/` | Public landing: what Grasp does, **Get started** / **Sign in**. Signed-in learners are sent to Today. |
| `/app` → **Today** | The learner's home (below). |
| `/ask` | The tutor. The open conversation is in the URL (`?session=`), so chats are linkable and survive reload/Back. `?q=` hands over a question from another feature (prefilled, not sent). |
| `/reps` | Practice. `?concept=` practices one idea, with a *Practice everything* way out. |
| `/map` `/slips` | Unchanged routes, inside the shell. |
| `/profile` | **Profile & settings**: onboarding answers in human words (*Edit answers*), appearance (system / light / dark), account and sign-out. |
| `/debug/*` | Developer pages; 404 in production. |

**The shell** (`components/shell/frame.tsx`, wrapping the `(platform)` route group):

- **One sidebar**: logo · **New chat** · **Today · Ask · Reps · Map · Slips** ·
  **Recent chats** (with delete) · the **account menu** at the foot (Profile &
  settings, theme, sign out). The current feature is tinted in its colour and
  marked `aria-current="page"`.
- **Desktop**: docked; collapses to a 72 px icon rail (remembered per browser,
  applied before first paint — no flash).
- **Under 900 px**: a top bar (menu · page title · new chat) opens the same
  sidebar as a drawer, with a scrim; it closes on navigation, Escape or the ×.
- A **skip link** to the content; every page has its own tab title
  (*Today · Grasp*, *Ask · Grasp*…).
- **Features hand off to each other**: Today's *Fix this first* and a Map node
  → *Practice it* (`/reps?concept=`) or *Ask about it* (`/ask?q=`); every Reps
  verdict → *Ask the tutor about this*; Today → *Continue chat*, *See your slips*.
- Snap and Duel join the sidebar only when they ship — no "not built"
  placeholders in learner UI.

### Today — the learner home ☑ (built 2026-11-08)

In priority order. Each block hides when it has nothing true to say.

1. ☑ **One next action**, chosen from state: first practice, *N ideas due for
   review*, or *keep the momentum* → Reps (or Ask, when no cards exist yet).
2. ☑ **Today / this week / ideas**: answered today and % right, days practiced
   of the last 7, ideas started and mastered.
3. ☑ **Fix this first**: the weakest started idea with a held-% meter,
   *Practice it* and *Ask about it*.
4. ☑ **Pick up where you left off**: the last conversation → *Continue chat*.
5. ☑ **Your pattern**: the dominant confident Slips root cause.
6. ☑ **Explore Grasp**: a card per feature (badge, name, one line).
7. ☐ Daily-goal ring against `minutesPerDay`; the 8-question placement for a
   brand-new learner (`placementNext` exists).

---

## Surface requirements

### Onboarding — exists (4 steps, saves as it goes)

- ☑ Accessible chips: every chip is a `<button>` with `aria-pressed`, named by
      its text; the `title` ("typically age 15–16") is only its description.
      The 2026-11-08 finding was an inspector artefact — it printed `title`
      first — corrected on 2026-11-09.
- ☑ Age input and the "not in formal education" checkbox are wrapped in their
      `<label>`s. The exam name and date fields were not; labelled 2026-11-09.
- ☐ Rank curricula by stage fit. A Class 10 learner in India sees CBSE *Senior*
      Secondary and JEE before CBSE Secondary today.
- ☐ Default the goal from the answers so far ("Keeping up with school" for an
      in-school learner, not "Learning on my own").
- ☐ Keep the primary button on screen (sticky footer) — step 4 pushes it below
      the fold at 1024×768.
- ☐ Consent step for under-threshold ages ([10-onboarding.md](10-onboarding.md)).

### Ask — exists (streaming, sessions, sources, stop, attachments, voice)

Laid out as a chat (2026-11-09): the learner's messages are tinted bubbles on the
right (`--bubble` / `--bubble-ink`, both themes); the tutor answers on the left
beside the Grasp mark, without a bubble, since answers carry maths, tables and
diagrams. A new chat centres the greeting and composer; a conversation docks the
composer at the bottom.

- ☑ **Composer** — one rounded field, no wasted padding: an auto-growing input
      (Enter sends, Shift+Enter breaks a line, never mid-IME), and inside it
      **attach** (paperclip), **dictate** (mic, Web Speech API, shown only where
      the browser supports it, in the learner's language and region), the
      **mode menu**, and an icon **send** that becomes **stop** while answering.
      Paste or drop files onto it too. A one-line note under it says Grasp can
      make mistakes, and carries upload and dictation messages when there are any
- ☑ **Mode menu** — a real ARIA menu button (↑/↓/Home/End, Enter, Escape returns
      focus), opening upward, each mode with a one-line description
- ☑ **Thinking state, told honestly** — the avatar turns and a shimmering line
      names the real step: *Reading your question / file* until the server has
      understood and searched (the `meta` event), then *Found 6 sources…*,
      *Planning the steps…* until the first token. Announced once per phase to
      screen readers
- ☑ **Typing reveal through a queue** (`use-typewriter.ts`) — tokens arrive in
      bursts; the answer comes out a few characters per tick, faster as the
      backlog grows, so it never lags the model by more than about a second.
      History appears whole; reduced motion shows text as it arrives. Unclosed
      maths is held back while streaming, so `\frac{1` never flashes up
- ☑ **Actions on every answer** — Copy, Read aloud (browser voices; maths read
      as words by `speakable.ts`), Good / Bad (stored on the message as eval
      data), Regenerate on the latest answer. On the latest question: Copy and
      **Edit** (in place; the old question and answer are superseded, not
      deleted). Mode tag, flags in plain language, and the sources toggle sit
      beside them
- ☑ **Attachments** — photos (downscaled to ≤ 1,600 px in the browser), PDFs and
      text files; up to 4 per message; each chip shows *Reading…* while the model
      transcribes it, and Send waits for that. Thumbnails in the conversation
- ☑ **The turn is handed over visibly** (`ask/question.ts`). When a Teach or
      Coach answer ends on a question — Coach always does, Teach ends on a check
      — that question becomes a *Your turn* block, and the composer becomes the
      reply box: a *Replying to Grasp* header quoting it, one-tap replies (Coach:
      *Give me a hint*, *Explain this step*, *Show the answer*; Teach: *Explain
      it again*, *Show the answer*), "Answer, or ask something else…", and the
      cursor already in it (not on touch screens). Answered or skipped questions
      step down to *Grasp asked*
  - **Never a dead end.** The header's × (or Escape) skips the question and
      returns the normal composer, and *Show the answer* is always one tap away.
      A learner short of time is never made to play along
  - **Not in Answer mode.** An Answer that ends "want to see a graph, or move
      on?" is an offer, not a question the lesson waits on; it stays part of
      the answer and the composer stays as it is
- ☑ Follows the answer only while the learner is at the bottom; scrolling up to
      read stops the follow, and a *Jump to latest* button appears
- ☑ **Three modes, chosen by the learner** — in the composer's mode menu,
      remembered per conversation and as the default for the next one:
  - **Answer** — the full answer straight away, the way a general assistant
    gives it. No quizzing.
  - **Teach** *(default)* — explained step by step at their level, then one
    short check question. Replies to the check get specific feedback.
  - **Coach** — they work it out: one step and one hint or question per message;
    "I don't know" gets that step explained, then the next step.
- ☑ **Two-way in every mode** — the tutor reads the conversation as a dialogue:
      an "I don't know" or "explain" is answered with an explanation, never
      another question; it never repeats a question; the learner can switch style
      mid-conversation ("just tell me").
- ☑ Typeset maths, tables and diagrams (see *Rendering stack*).

- ◐ **Thinking state** — built (above); still to add: elapsed time after 3 s
      and *Try again* at 30 s.
- ☑ Conversations live in the shell's sidebar (a drawer on phones), not beside the chat.
- ☐ No empty sessions: create the session row on the first saved answer, so a
      failed turn doesn't leave a nameless "New chat" behind.
- ☑ Human labels everywhere (`lib/labels.ts`): *India*, *Keeping up with school*, *English*.
- ◐ Regenerate and edit the latest turn — built. Editing an *earlier* message
      (a real branch, using the stored tree) is still to do.
- Latency budget: first visible feedback < 300 ms; time to first token p95
  < 1.5 s (Gate 1).

### Reps — exists (keyboard 1–9, verdict, delta, streak, haptics)

- ☑ In-flight guard: a second keypress can no longer record a second attempt.
- ☑ Typeset maths in stems, options and solutions.
- ☐ End-of-session summary: accuracy, concepts that moved, when the next cards
      are due, one suggested next step.
- ☐ *Report a problem* on every card → quarantines it (rule 6 has a human path).
- ☐ UI for card types beyond `mcq` — the feed only serves `mcq` until then.
- Budget: next card in < 100 ms; nothing on the swipe path awaits the network
  for content it could have prefetched.

### Map — exists (DAG, mastery heat, weakest chain, node actions)

- ☑ Labels in sentence case, full names on two lines (no mid-word truncation).
- ☑ Fit-to-view with pan and zoom (React Flow) — nothing clipped.
- ☑ Arrowheads show prerequisite → dependent.
- ☐ "Start here" for a learner with nothing started.
- ◐ Keyboard focus and selection on nodes ☑; each node states its level in text,
      not colour alone ☑; a list view for screen readers ☐.
- ☑ **The selected idea never covers the graph.** Beside it on wide pages, as a
      solid sheet over its foot on narrow ones (a container query on the page's
      own width — the sidebar takes a share of the window). Controls sit top
      right, clear of the sheet. *Builds on* / *Leads to* chips walk the graph;
      it pans the least it can to keep the selection in view, never recentres.
- ☑ Every node one size, so rows line up; selection and blocker rings are
      box-shadows, so selecting never shifts text. Concept names pass through
      `conceptLabel()` (sentence case, `sin^2` → sin²) on every screen.

### Slips — exists (grouped by root cause, good empty state)

- ☐ "Practice these" per root cause.
- ☐ Weekly digest ([07-phases.md](07-phases.md) Phase 3).

---

## Voice

Second person, plain, warm, never gamified for its own sake. Sentence case
everywhere. Say what happened and what to do next ("That one's about the sign —
want three more like it?"), never what the system did internally.
Model-authored concept names are display-normalised before they reach a screen;
the stored id never changes (rule 13).

**American spelling in the interface** (decided 2026-11-09): *practice* for noun
and verb, *math*, *color*, *program*, *analyze*. Official names keep their own
spelling ("IB Diploma Programme", "National Defence Academy"). This is the
interface only: the tutor follows the learner's curriculum, so a learner whose
programme sets `notation.spelling: en-GB` still gets British spelling in
answers (`learner-card.ts`), because that is what their exam papers use.

---

## Accessibility — WCAG 2.2 AA

Floor for every screen:

- Every control has an accessible name that matches its visible label.
- Visible focus in both themes; logical tab order; no keyboard traps.
- Targets ≥ 24 px (≥ 44 px on touch layouts).
- Text contrast ≥ 4.5:1 in both themes — **including on glass**, where the
  background varies.
- Nothing communicated by colour alone (mastery heat, verdicts).
- `prefers-reduced-motion` honoured for every animation, including entrance fades.
- Automated: axe with 0 serious violations on onboarding, Ask, Reps, Map in the
  Playwright suite ([07-phases.md](07-phases.md)). Until that suite exists, axe
  4.10 is run by hand: 2026-11-09, every signed-in page, both themes, sidebar
  expanded and collapsed — 0 violations after the fixes in the log below.

---

## Performance budgets

| Metric | Budget |
| --- | --- |
| LCP | < 2.5 s p75, mid-range Android over 4G |
| INP | < 200 ms |
| JS per route | < 200 KB gzipped |
| Ask — first visible feedback | < 300 ms |
| Ask — time to first token | p95 < 1.5 s |
| Reps — next card | < 100 ms |
| Switching features — first visible change | < 100 ms |

**Measured 2026-11-09, production build, local → Atlas M0:**

| | Before | After |
| --- | --- | --- |
| Sidebar click → first visible change | 170–1,000 ms (old page lingered, no feedback) | **5–7 ms** — every feature has a `loading.tsx` skeleton, prefetched |
| → content: Ask / Slips | ~320 ms | ~320 ms |
| → content: Reps | 950 ms median (page, then a second fetch) | **320 ms** — first cards rendered on the server, one query batch |
| → content: Map | 530 ms | **325 ms** |
| → content: Today | 620 ms | 310–660 ms — the slowest of eight parallel queries on the free tier |
| Answer a card → verdict | 430–1,180 ms | **~400 ms** — attempt row and mastery fold in one round trip |
| Ask — first token | p50 5.5 s (Gemini), 14 s after a failover | unchanged — free-tier provider queueing; minimal thinking saved < 1 s in a noisy benchmark |

Each Atlas M0 query costs 35–380 ms, so the rule is: **independent reads in one
`Promise.all`, never a query that waits on another without need.** In dev,
`pnpm dev` runs on Turbopack (first compile per page 0.5–0.9 s, was 1–3 s) —
judge speed on a production build, not on dev.

---

## Review log

**2026-11-08** — full walk-through as a new learner (sign-up → onboarding → Ask →
Reps → Map → Slips), desktop and 375 px, light and dark.

| Finding | Status |
| --- | --- |
| Ask hung forever on a blank caret when Gemini's mid model stalled | ☑ fixed — first-token deadline + failover + provider cooldown |
| Reps showed "sin heta": LaTeX `\t` parsed as a TAB from model JSON | ☑ fixed at the parser; 2 stored questions repaired |
| Reps: a fast double keypress counted twice | ☑ fixed (client guard; server idempotency in Phase H) |
| No navigation between surfaces; `/` and `/app` are developer pages | ☑ one sidebar shell, Today, Profile & settings, landing page |
| Maths renders as raw LaTeX | ☑ KaTeX via rehype-katex |
| Tutor asked the same question twice after "I don't know, explain me whole" | ☑ shared dialogue rules + real chat history; three learner-chosen modes |
| Map labels truncated, first column clipped | ☑ React Flow, full names, fit-to-view |
| Onboarding chips, age field, checkbox inaccessible | ☑ misdiagnosed — they were accessible (see Onboarding); exam fields were not, now labelled |
| Ask session list eats a phone screen | ☑ chats moved into the shell's sidebar / drawer |

**2026-11-09** — full test pass, signed-out → new learner (UK, Year 11, GCSE) →
every surface, keyboard and pointer, desktop and 375 px, light and dark, then
the production build. Full write-up: [test-reports/2026-11-09.md](test-reports/2026-11-09.md).

| Finding | Status |
| --- | --- |
| Link-styled buttons lost their label on hover (`a:hover` outranked `.btn`) | ☑ fixed in `globals.css` |
| Reps re-served a card seconds after it was answered — free mastery | ☑ cards answered in the last 12 h are held back; "All caught up" end state |
| Reps verdict showed the concept slug (`bounds-of-sine-… → 45% learning`) | ☑ concept name, "now 45% held" |
| Ask showed internal flags (`UNGROUNDED`, `budget-shed`) to learners | ☑ two translated ("General explanation", "Stopped early"), rest kept for review only |
| Today said "Welcome back" to a brand-new learner; no exam countdown | ☑ |
| Sign-up with a short password showed the sign-in error | ☑ messages per form |
| Collapsed sidebar: "New chat" and the account button had no accessible name; toggle always said "Collapse" | ☑ |
| Phone drawer: closed drawer still in the tab order; focus not moved in or returned | ☑ `visibility` + focus management + scroll lock |
| Ochre text 3.6:1 in light theme (Slips pills, exam chip) | ☑ `--ochre-ink` text token |
| Reps had no `h1`; Slips filters had no pressed state; skip-link target not focusable | ☑ |
| `sin\theta` set in italics as s·i·n | ☑ function names set upright inside maths |
| Reps first-load JS 378 kB (plot renderer bundled everywhere) | ☑ plot renderer loaded on first use — 239 kB |

**2026-11-09, later** — layout pass on every page at 375, 768, 1024 and 1440 px,
light and dark, with a scripted check for overflow, cut-off text and
overlapping controls. (Measure against `screen.width` under phone emulation:
the browser widens `innerWidth` to fit overflowing content, which hid the Slips
bug from the first run.)

| Finding | Status |
| --- | --- |
| Map: the selected-idea panel stuck to the window's foot, over the graph's zoom controls, with nodes showing through | ☑ side panel / solid sheet, controls top right |
| Map: hydration mismatch — React Flow `colorMode="system"` rendered `light` on the server, `dark` in the browser | ☑ fixed mode; every map colour is a Grasp token |
| Map: nodes of two heights; selection shifted text by 1 px; dimmed names unreadable (20%) | ☑ one size, box-shadow rings, 38% |
| Map / Today: "sin^2 + cos^2 = 1" shown with carets | ☑ `conceptLabel()` |
| Slips on a phone: one long cause pill widened the page to 458 px; content cut off | ☑ cause above the note; pills capped at their container |
| Primary buttons in dark: white on #7ea2ff, 2.5:1 | ☑ `--on-cobalt` (navy in dark) |
| Phone top bar 9% opaque in dark — page text showed through the title | ☑ 94% `--paper` |
| Answer tables split words mid-word ("Concentratio\|n") | ☑ `overflow-wrap: break-word` in tables |
