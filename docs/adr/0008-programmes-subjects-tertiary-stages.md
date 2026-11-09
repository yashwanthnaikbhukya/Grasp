# ADR 0008 — Programmes, a subject catalogue, and stages past school

**Status:** accepted · 2026-11-09 · **extends [ADR 0006](0006-curriculum-agnostic-concepts.md)**

## Context

ADR 0006 made scope a property of the learner. Its first data was narrow, and
onboarding inherited the narrowness:

1. **Every curriculum row carried one `subject`**, and onboarding derived the
   subject list from the curricula picked — so the only subject anyone could
   choose was mathematics. A CBSE student taking physics, chemistry and biology
   had nowhere to say so; neither did a history student, a nurse or a programmer.
2. **The stage ladder stopped at school.** Stage 13 was "Undergraduate" and 14
   "Postgraduate": one chip for every year of every degree. A first-year and a
   final-year engineering student got the same pitch.
3. **Exams, degrees and professional qualifications didn't exist** as things to
   pick — NEET, JEE, SAT, GRE, a B.Tech, ACCA.

## Decision

**Curricula are programmes. Subjects are a catalogue of their own. The ladder
runs from school to a doctorate.**

```
curricula                        a programme a learner is enrolled in or preparing for
  _id, name, authority, regions, stageRange, language, notation, exam
  kind      school | exam | university | professional | competition | self-study
  subjects  SubjectId[]          what it offers — suggested at onboarding, never a limit

SUBJECTS                         packages/schema/src/subjects.ts — ~100, in 12 groups
  id (stable slug), name, group, stage {min,max} (advisory: orders the picker)

stage                            0 pre-primary · 1–12 school · 13–16 first degree,
                                 year by year · 17 master's · 18 doctorate
```

- **Subjects stand alone.** A learner picks subjects from the whole catalogue;
  their programmes' subjects are shown first. A subject that isn't listed can be
  typed in and becomes a slug (`customSubjectId`) — a first-class case, like
  self-study. Everything downstream already treats `subjects` as strings.
- **Programmes, not board × subject rows.** "CBSE Senior Secondary" is one row
  offering 19 subjects, not 19 rows. Existing ids are kept (`in-cbse-secondary-math`
  now names *CBSE Secondary*, all subjects) because profiles and indexed chunks
  reference them; an id is a key, not a description.
- **The ladder keeps counting years.** Stage stays "nominal years of education
  completed", so 13 is the first year after school. Labels are regional like
  everywhere else: *College freshman* (US), *College year 1 (UG)* (South Asia),
  *University year 1* (elsewhere), then *Master's* and *Doctorate (PhD)*. Still
  advisory — a three-year degree or a career change lands a year "off", which is
  fine.

## Consequences

- No migration was needed: no stored profile, concept, chunk or question used a
  stage above 12 when this landed, and the old `subject` field is removed by the
  seed's `replaceOne`.
- Content is still maths-only. Ask works for any subject (retrieval comes back
  empty and the answer is marked *General explanation*); Map and Reps say their
  material is on its way. Coverage grows subject by subject through ingestion,
  with no further schema change.
- The tutor prompts lost their "maths tutor" identity (`tutor.*@2`), checked
  against the v1 golden sets before the switch.
- `data/curricula.seed.json` is tested like code (`curricula-seed.test.ts`):
  every subject id exists, and every hand-checked region has a real programme at
  every school stage and university options past it.
