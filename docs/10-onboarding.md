# 10 — Onboarding

**Phase 1 deliverable 1.0.** Built before chat, because the learner card has
nothing in it until this exists.

Onboarding is not a form. It is the moment Grasp acquires the context that makes
every later surface personalized — and the moment it learns the learner's age,
which determines what the product is legally allowed to do.

## What onboarding is for

Three jobs, in priority order:

1. **Seed the learner model** so the first tutor reply is already calibrated —
   right stage, right curriculum, right language, right notation.
2. **Establish the consent basis.** Age determines the legal regime. This has to
   happen before any substantive data processing, not after.
3. **Set expectations** — the learner should finish knowing what Grasp is for.

## Design constraints

- **Under 90 seconds, five screens.** Every extra screen loses people, and a
  learner who abandons onboarding has no profile at all — which is worse than a
  partial one.
- **Progressive.** Screens 1–3 are enough to start. Screens 4–5 can be deferred
  into the first session and asked in context. Nothing blocks on completeness.
- **Every field has a sane default and an escape hatch.** "Not listed",
  "self-study", "prefer not to say" are always available and always work.
- **Self-report is a prior, not a measurement.** What a learner says their level
  is seeds the model; the placement quiz measures it. Never treat the two as
  equivalent — people systematically misjudge both directions.

## The journey

### 0 — Account

Email magic link (Resend). No password. Ask nothing else here.

### 1 — Where are you?

Country, geo-guessed from request headers and **editable** — a guess presented as
a confirmation performs far better than an empty dropdown.

| Sets | Used for |
| --- | --- |
| `region` | Curriculum candidates on screen 3 |
| `locale` | Number formatting, date order, decimal separator |
| `units` | Metric vs imperial in generated examples |
| `notation` | `csc` vs `cosec`, `trapezoid` vs `trapezium`, digit grouping (`1,00,000` vs `100,000`) |
| Consent regime | Which age threshold applies (see below) |

Notation is not cosmetic. `trapezoid` denotes *different shapes* in US and UK
English. A tutor confidently using the wrong one is worse than one that says
nothing.

### 2 — Where are you in your education?

Two inputs:

- **Age** — a plain number. The reliable anchor: it works for a 14-year-old in
  school, a 19-year-old repeating an exam, and a 40-year-old relearning algebra.
- **Stage** — a picker showing **local labels for their region** (`Class 10`,
  `Year 11`, `Grade 10`, `MYP 5`), storing the normalized integer
  ([ADR 0006](adr/0006-curriculum-agnostic-concepts.md)).

Plus a branch: **"Not in formal education"** → skip stage, infer a band from age
and self-rated level, and treat every concept as in-scope.

> Age is the field with legal consequences. It is asked plainly, once, and never
> inferred from stage — a learner two years behind or ahead is common, and getting
> this wrong in either direction is a compliance problem.

### 3 — What are you studying?

Curriculum candidates filtered by `region` + `stage`, with search, multi-select,
and **"Other / self-study"** always present and always functional.

Then subjects, from the union of subjects the chosen curricula cover.

A learner with no matching curriculum is a first-class case, not an error state:
they get the universal concept graph with no `inScope` filtering, which is a
slightly broader experience rather than a broken one.

### 4 — What are you working toward? *(deferrable)*

| Goal | What it changes |
| --- | --- |
| Exam on a date | Review urgency, study plan backwards from the date |
| School coursework | Follows the curriculum's `sequenceIndex` order |
| Self-study | Follows prerequisite order, no external deadline |
| Competition | Higher difficulty band, less exam-format drilling |

Plus minutes available per day → the study plan's budget.

### 5 — How should I explain things? *(deferrable)*

- **Instruction language** — the language explanations are written in.
- **Code-switching** — "Explain in Hindi but keep technical terms in English?"
  This is how a large share of the world actually studies (Hinglish, Spanglish,
  Taglish, Arabizi). Offering it explicitly is a genuine differentiator, and a
  single boolean plus a language pair captures it.
- **Depth default** — brief / balanced / thorough. A starting point, later
  overridden by observed behaviour.

### 6 — Placement *(offered, skippable, resumable)*

Eight adaptive questions in the Reps card format, so it reads as trying the
product rather than sitting a test. Binary search over the concept graph's
topological depth, seeded by the self-reported stage.

Skipping is fine — the profile prior carries the first few sessions, and real
attempts overtake it quickly.

## What lands on the learner

```ts
user.profile = {
  region: 'IN',
  locale: 'en-IN',
  age: 15,
  stage: 10,                        // normalized; labelled per region for display
  inFormalEducation: true,
  curriculumIds: ['in-cbse-secondary-math'],
  subjects: ['mathematics'],
  goal: { kind: 'exam', examDate: '2027-02-14', label: 'CBSE Board' },
  minutesPerDay: 40,
  language: { instruction: 'en', codeSwitch: 'hi' },
  depth: 'balanced',
  selfRated: { mathematics: 3 },    // 1–5, a prior only
  consent: { basis: 'parental', grantedAt: '...', guardianEmail: '...' },
}
```

Every field is optional with a documented default. `profileCompleteness` is
computed, and the UI nudges toward the gaps that would most improve the
experience — never a blocking modal.

## How the profile is actually used

| Field | Effect |
| --- | --- |
| `curriculumIds` | Retrieval scope filter; `inScope` gating of concepts |
| `stage` | Advisory difficulty band; keeps calculus away from a 12-year-old |
| `age` | Consent regime, safety posture, tone |
| `language` + `codeSwitch` | Tutor output language; **retrieval stays in the corpus language** |
| `notation` (from region) | Symbol and terminology conventions in generated content |
| `goal` + `examDate` | Review urgency, study-plan direction |
| `depth` | Default response length |
| `selfRated` | Cold-start mastery prior, decayed as real attempts arrive |

All of it reaches the model through the learner card
([05-context-broker.md](05-context-broker.md#5--inject-the-learner-compactly)) —
never by branching prompt templates per country. One prompt, per-learner context.

## Content moderation

Two genuinely different problems that get conflated:

### Level-appropriateness

Is this content *useful* to this learner? Handled by `stage`, mastery, and
prerequisite gating. A stage-6 learner asking about integration gets an honest
"that's usually taught around stage 11 — here's the intuition, and here's the
prerequisite chain if you want to go after it properly." **Never a refusal.**
Curiosity ahead of the syllabus is the best signal a learner can send.

### Safety and age-appropriateness

Grasp is a global product whose users are mostly minors. That carries real
obligations, and the age captured at onboarding is what drives them:

| Regime | Threshold | Requirement |
| --- | --- | --- |
| COPPA (US) | under 13 | Verifiable parental consent before collection |
| GDPR / GDPR-K (EU) | 13–16, varies by member state | Parental consent below the national threshold |
| India DPDP Act | under 18 | Verifiable parental consent; no behavioural ad targeting |
| UK Age Appropriate Design Code | under 18 | Privacy-by-default, data minimisation, no dark patterns |

The strictest applicable rule wins. Practically:

- **Under the applicable threshold** → guardian email, consent flow, and no
  processing beyond account creation until consent is recorded.
- **Data minimisation always.** Grasp needs age, region, stage, curriculum, and
  language. It does not need a phone number, a school name, or a photo, so it
  does not ask for them.
- **PII never enters a prompt.** The learner card refers to the learner in the
  second person and carries no name, contact detail, or school. This also means a
  prompt leak is not a PII leak.
- **Off-topic and unsafe input handling.** A learner surface will receive
  personal disclosures, distress, and abuse. Route those to a safety path with
  regional helpline signposting; never let the tutor improvise. Out of scope for
  the POC, but the routing hook belongs in the broker's `intent` classification
  from the start, which is why `meta` and `chitchat` are already intents.

**None of this is required for the POC** — it runs on synthetic learners. All of
it is required before one real student signs up, which is why it's written down
now rather than discovered later. The checklist lives at the end of
[08-setup.md](08-setup.md#security-checklist-before-any-real-learner-touches-this).

## Testing

| What | How |
| --- | --- |
| Stage ladder | Unit. Round-trip `stage → label → stage` for every supported region. |
| Curriculum candidates | Unit. Every (region, stage) pair returns at least one option, always including a self-study fallback. |
| Consent gating | Integration. An under-threshold account with no recorded consent can create nothing beyond itself. |
| Learner card | Snapshot, across a matrix of profiles: full, minimal, self-study, adult learner, code-switching. |
| Retrieval isolation | Integration. Curriculum scoping never leaks another learner's `user`-scoped chunks. **Security test.** |

The minimal-profile snapshot matters most: the learner card must degrade to
something useful when four of the eight fields are missing, because for real
users they often will be.
