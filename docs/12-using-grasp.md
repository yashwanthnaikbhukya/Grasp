# 12 — Using Grasp

How to run Grasp locally and use it as a learner — and, honestly, what works
today and what doesn't. Last walked end to end: **2026-11-08**.

---

## Start it

You need four things running. `pnpm setup:check` tells you which one is missing.

| Need | Check | If not |
| --- | --- | --- |
| Node 22 | `node -v` | `nvm use` in the repo (`.nvmrc` says 22). Node 14 fails with `Unexpected token '??='` |
| MongoDB Atlas | `pnpm setup:check` shows ✓ | Free clusters **pause** when idle — resume it in Atlas, wait a minute for DNS |
| Ollama | `curl -s localhost:11434/api/tags` | `brew services start ollama` — Ask needs it for search |
| At least two model keys | `pnpm setup:check` | Gemini + Groq are in `.env.local` already |

Then, from the repo root:

```bash
pnpm dev
```

Open **http://localhost:3000**.

---

## First visit

1. On the landing page, click **Get started**.
2. Create an account — name, email, a password of at least 8 characters.
   (No email is sent; verification isn't built yet.)
3. Answer four short questions, about a minute:
   1. **Where you are** — any country; sets the programmes offered, notation
      and units.
   2. **Age and year** — school (in your country's own labels) or college and
      university, from first year to a doctorate. Or "not studying right now".
   3. **What you're studying** — your board, entrance exam, degree,
      professional qualification or olympiad (search, or skip), then your
      subjects: suggested from what you picked, or search the full list, or type
      your own.
   4. **Goal, minutes a day, and language** for explanations.

   Only math has study material so far: for other subjects the tutor answers
   from general knowledge (marked *General explanation*), and Map and Reps say
   their material is on its way.
4. You land on **Today**, your home.

## Getting around

Everything lives in one sidebar, like ChatGPT or Claude:

- **New chat** at the top starts a fresh conversation with the tutor.
- **Today · Ask · Reps · Map · Slips** — the five parts of Grasp.
- **Recent chats** — click to reopen one; hover for ×  to delete it.
- **Your name** at the bottom opens the account menu: *Profile & settings*,
  the theme (system / light / dark) and *Sign out*.

On a phone, tap the ☰-style button at the top left to open the same sidebar.
On a computer, the button beside the logo collapses it to icons.

The features link to each other: *Fix this first* on Today and any idea on the
Map have **Practice it** and **Ask about it**; every practice answer has
**Ask the tutor about this**.

### Today — `/app`

Your next step (one button), how today and this week are going, your weakest
idea, your last conversation, and your most common kind of mistake.

### Profile & settings — `/profile`

What Grasp knows about you, in plain words — change it with **Edit answers** —
plus appearance and sign-out.

Signing in later: **Sign in** on the landing page. If you're already signed in,
`/` takes you straight to `/app`.

---

## What you can do

### Ask — `/ask`

A tutor for your math questions. Type a question or tap a suggestion.

**Pick how it answers** with the mode menu at the right of the message box
(it shows the current mode, e.g. *Teach ▾*):

| Mode | What you get |
| --- | --- |
| **Answer** | The full answer straight away — like a search or a general chatbot |
| **Teach** *(default)* | Explained step by step, then one quick question to check you followed |
| **Coach** | You work it out: one step and one hint at a time. Say "I don't know" and it explains that step |

In any mode you can just say "explain it", "just tell me" or "quiz me", and it
will. Your choice is remembered for the conversation and the next new chat.

- **Attach** a photo of a question, a PDF or a text file with the paperclip — or
  paste or drop it on the message box. Up to 4 per message. The chip says
  *Reading…* while Grasp reads it (a few seconds; Send waits). Photos are
  shrunk in your browser before upload.
- **Dictate** with the mic (Chrome, Edge, Safari); press it again to stop.
- Under each answer: **Copy**, **Read aloud**, **Good / Bad answer**, and
  **Regenerate** on the latest one. Hover your latest question to **Edit** it —
  the tutor answers the new version.
- Math is typeset; answers can include tables and **diagrams** (graphs,
  triangles, the unit circle) you can pan and zoom.
- **"N sources"** under an answer opens the textbook passages it used (answers
  from before 2026-11-09 don't have them saved);
  `[c1]`-style markers in the answer point at them.
- **Stop** ends an answer early. Past conversations are in the left list.
- Best on **trigonometry** today — it is the only chapter ingested so far.
  That chapter is tagged to CBSE; if you study something else (GCSE, say), the
  tutor still uses it and labels those sources **Another syllabus**.
- A **General explanation** tag means the answer didn't draw on your study
  material — check it against your notes.

### Reps — `/reps`

Short practice. Press **1–4** (or tap) to answer, **Enter** or **Continue** for
the next card. After each answer you see whether you were right, the worked
solution, and **how your mastery of that idea moved**. The labels on each card
(*New*, *Review*, *Needs work*) say why it was picked for you.

A card you answered is held back for 12 hours, so you never get the same
question while its solution is still fresh — the idea itself comes back through
its other cards. When you have answered everything that is ready, Reps says
**All caught up**. The bank is small today (8 cards — see 07-phases.md § 2.1).

### Map — `/map`

Every concept and what it depends on, coloured by how well you hold it.
**Fix this first** names the weakest prerequisite under something you're
working on. Click a concept to practice it, ask about it, or see its
prerequisites.

### Slips — `/slips`

Your wrong answers, grouped by **why** they happened (careless arithmetic,
misread question, misconception…), not by chapter. Classification runs in the
background after each wrong answer, so give it a few seconds. Labels the system
isn't confident about are hidden and counted as "unclassified".

### Developer pages

- **`/debug`** — build status of each surface.
- **`/debug/gateway`** — live check that the AI providers work and fail over.
- **`/debug/brand`** — the Grasp logo, app icon and feature icons, light and dark.

Neither exists in a production build.

---

## What works and what doesn't

| Works today | Partly | Not built yet |
| --- | --- | --- |
| Sign-up, sign-in, sign-out | **Content**: one chapter (trigonometry), 21 concepts, **4 practice cards** | Snap (photo of a problem) |
| Onboarding, 25 regions; Today; Profile & settings | | Duel |
| Ask: three modes, typeset math, diagrams, sources, AI-provider failover | | File and photo uploads in Ask |
| Reps, with mastery updates; practice one idea | | Password reset, magic-link email |
| Map: pan/zoom, weakest chain; one sidebar for everything, phone drawer | | Study plan, voice, teacher view |
| Slips | | |

The full list, with order and exit criteria, is in [07-phases.md](07-phases.md);
the target experience is in [11-experience.md](11-experience.md).

---

## Adding content

More content makes every surface better. Each command uses model quota.

```bash
pnpm ingest data/corpus/<chapter>.md     # one Markdown chapter → searchable chunks + concepts
pnpm ingest --all                        # everything in data/corpus/
pnpm cards:build --limit=10              # generate + verify practice cards from the chunks
pnpm retrieval:eval                      # check search quality (recall@5)
```

Only cards that pass verification are ever shown to a learner.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `querySrv ENOTFOUND _mongodb._tcp…` | Atlas cluster paused — or, intermittently, your router's DNS failing this lookup | Resume the cluster; if it comes and goes, retry, or set your DNS to 1.1.1.1 / 8.8.8.8 |
| Ask takes ~10 s, then answers | Gemini's model is overloaded; Grasp waits 10 s, then fails over to Groq | Nothing — later replies skip Gemini for up to 10 minutes |
| Ask fails on every question | Ollama isn't running | `brew services start ollama` |
| Sign-in says "Something went wrong" | Was a real bug (fixed 2026-11-08) — if it returns, check the server log for `Invalid id value` | See 07-phases.md § H.0 |
| Reps says no questions are ready | No verified cards for your subject | `pnpm cards:build` |
| Reps says "All caught up" straight away | You answered every ready card in the last 12 h | Wait, or grow the bank: `pnpm cards:build --limit=<chunks>` |
| `Unexpected token '??='` | Running on Node 14 | `nvm use` |

---

## Test accounts

Two local test accounts were created during review. Their credentials are in
`.env.local` (git-ignored) as `GRASP_TEST_EMAIL` / `GRASP_TEST_PASSWORD` and
`GRASP_TEST_EMAIL_2` / `GRASP_TEST_PASSWORD_2`. Use them, or make your own.
