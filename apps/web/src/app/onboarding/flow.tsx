'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CURRICULUM_KIND_NAME,
  curriculumCandidates,
  customSubjectId,
  LAST_SCHOOL_STAGE,
  SELF_STUDY_CURRICULUM_ID,
  stageOptions,
  SUBJECT_GROUP_NAME,
  SUBJECTS,
  subjectFitsStage,
  subjectName,
  type CurriculumKind,
  type LearnerProfile,
  type SubjectGroup,
} from '@grasp/schema';
import { CloseIcon, PlusIcon } from '@/components/brand/icons';
import { POPULAR_COUNTRIES } from '@/lib/countries';

/** A programme as onboarding needs it — see page.tsx. */
export interface ProgrammeOption {
  id: string;
  name: string;
  authority: string;
  regions: string[];
  kind: CurriculumKind;
  subjects: string[];
  stageMin: number;
  stageMax: number;
  exam: string | null;
}

const LANGUAGES = [
  ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'],
  ['mr', 'Marathi'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'],
  ['ur', 'Urdu'], ['ne', 'Nepali'], ['si', 'Sinhala'], ['es', 'Spanish'], ['pt', 'Portuguese'],
  ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['ar', 'Arabic'], ['tr', 'Turkish'],
  ['fa', 'Persian'], ['ru', 'Russian'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['id', 'Indonesian'], ['ms', 'Malay'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['tl', 'Tagalog'],
  ['sw', 'Swahili'], ['yo', 'Yoruba'], ['ha', 'Hausa'], ['am', 'Amharic'],
] as const;

const TOTAL_STEPS = 4;
const STEP_IDS = Array.from({ length: TOTAL_STEPS }, (_, i) => `step-${i + 1}`);
/** More than this is a timetable, not a focus — and every one dilutes retrieval. */
const MAX_SUBJECTS = 12;
/** Programmes shown per section before "Show more". */
const SECTION_PREVIEW = 8;
const KIND_ORDER = Object.keys(CURRICULUM_KIND_NAME) as CurriculumKind[];
const UNIVERSITY_KIND_ORDER: CurriculumKind[] = ['university', 'professional', 'exam', 'competition', 'school', 'self-study'];
const GROUP_ORDER = Object.keys(SUBJECT_GROUP_NAME) as SubjectGroup[];

function Chip({
  pressed,
  onClick,
  children,
  title,
  disabled,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick} title={title} disabled={disabled}>
      {children}
    </button>
  );
}

export function OnboardingFlow({
  name,
  initial,
  programmes,
  countries,
}: {
  name: string;
  initial: LearnerProfile;
  programmes: ProgrammeOption[];
  /** Named on the server so both renders agree (see page.tsx). */
  countries: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [region, setRegion] = useState(initial.region === 'XX' ? '' : initial.region);
  const [age, setAge] = useState<string>(initial.age ? String(initial.age) : '');
  const [inSchool, setInSchool] = useState(initial.inFormalEducation);
  const [stage, setStage] = useState<number | null>(initial.stage);
  const [curriculumIds, setCurriculumIds] = useState<string[]>(initial.curriculumIds);
  const [subjects, setSubjects] = useState<string[]>(initial.subjects);
  const [goalKind, setGoalKind] = useState(initial.goal.kind);
  const [goalLabel, setGoalLabel] = useState(initial.goal.label);
  const [examDate, setExamDate] = useState(
    initial.goal.examDate ? new Date(initial.goal.examDate).toISOString().slice(0, 10) : '',
  );
  const [minutes, setMinutes] = useState(String(initial.minutesPerDay));
  const [instruction, setInstruction] = useState(initial.language.instruction);
  const [codeSwitch, setCodeSwitch] = useState<string | null>(initial.language.codeSwitch);

  const [programmeQuery, setProgrammeQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<CurriculumKind>>(new Set());
  const [subjectQuery, setSubjectQuery] = useState('');

  // --- step 0: where -----------------------------------------------------------
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  // --- step 1: stage ------------------------------------------------------------
  const ladder = useMemo(() => stageOptions(region || undefined), [region]);
  const university = (stage ?? 0) > LAST_SCHOOL_STAGE;
  // An adult most likely studies at college level; show that group first.
  const uniFirst = Number(age) >= 18;

  // --- step 2: programmes and subjects --------------------------------------------
  // Everything on offer for this region and stage — before the search filter.
  const available = useMemo(
    () => curriculumCandidates(programmes, region || 'XX', inSchool ? stage : null),
    [programmes, region, inSchool, stage],
  );
  // A programme picked under another country or stage no longer applies; it
  // must not keep suggesting subjects or be saved (found switching GB → IN).
  const chosenIds = curriculumIds.filter((id) => available.some((p) => p.id === id));

  const candidates = useMemo(() => {
    const list = available;
    const q = programmeQuery.trim().toLowerCase();
    return q
      ? list.filter((p) => `${p.name} ${p.authority} ${p.exam ?? ''}`.toLowerCase().includes(q))
      : list;
  }, [available, programmeQuery]);

  const byKind = useMemo(() => {
    const groups = new Map<CurriculumKind, ProgrammeOption[]>();
    for (const p of candidates) groups.set(p.kind, [...(groups.get(p.kind) ?? []), p]);
    // What a learner at this stage most likely picks comes first.
    const order: CurriculumKind[] = university || !inSchool ? UNIVERSITY_KIND_ORDER : KIND_ORDER;
    return order.flatMap((k) => (groups.get(k)?.length ? [[k, groups.get(k) ?? []] as const] : []));
  }, [candidates, university, inSchool]);

  const picked = programmes.filter((p) => chosenIds.includes(p.id));
  const suggested = [...new Set(picked.flatMap((p) => p.subjects))].filter((s) => !subjects.includes(s));
  const atLimit = subjects.length >= MAX_SUBJECTS;

  const subjectMatches = useMemo(() => {
    const q = subjectQuery.trim().toLowerCase();
    if (!q) return [];
    return SUBJECTS.filter((s) => s.name.toLowerCase().includes(q) || s.id.includes(q.replace(/\s+/g, '-')))
      .sort((a, b) => Number(subjectFitsStage(b, stage)) - Number(subjectFitsStage(a, stage)))
      .slice(0, 12);
  }, [subjectQuery, stage]);
  const customId = customSubjectId(subjectQuery);
  const offerCustom =
    subjectQuery.trim().length > 1 && customId !== null && !subjects.includes(customId) &&
    !subjectMatches.some((s) => s.id === customId);

  const browseGroups = useMemo(
    () =>
      GROUP_ORDER.map((g) => ({
        group: g,
        items: SUBJECTS.filter((s) => s.group === g).sort(
          (a, b) => Number(subjectFitsStage(b, stage)) - Number(subjectFitsStage(a, stage)),
        ),
      })),
    [stage],
  );

  const addSubject = (id: string) => {
    if (subjects.includes(id) || atLimit) return;
    setSubjects((s) => [...s, id]);
  };
  const removeSubject = (id: string) => setSubjects((s) => s.filter((x) => x !== id));
  const toggleProgramme = (id: string) =>
    setCurriculumIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // --- step 3: goal -----------------------------------------------------------------
  const examSuggestions = [...new Set(picked.map((p) => p.exam).filter((e): e is string => Boolean(e)))];
  const GOALS: [LearnerProfile['goal']['kind'], string][] = [
    ['exam', 'An exam I have coming up'],
    ['coursework', university ? 'Keeping up with my course' : 'Keeping up with school'],
    ['self-study', 'Learning on my own'],
    ['competition', 'A competition or olympiad'],
    ['career', 'Skills for work or my career'],
  ];

  async function save(partial: Record<string, unknown>, done = false) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(partial),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Could not save that. Try again.');
      return false;
    }
    if (done) {
      router.push('/app');
      router.refresh();
    }
    return true;
  }

  const canAdvance =
    step === 0 ? region !== '' :
    step === 1 ? age !== '' && (!inSchool || stage !== null) :
    step === 2 ? subjects.length > 0 :
    true;

  async function next() {
    if (step === 0) {
      if (!(await save({ region, locale: region === 'XX' ? 'en' : `en-${region}` }))) return;
    } else if (step === 1) {
      if (!(await save({ age: Number(age), stage: inSchool ? stage : null, inFormalEducation: inSchool }))) return;
    } else if (step === 2) {
      if (!(await save({ curriculumIds: chosenIds, subjects }))) return;
    } else {
      await save(
        {
          goal: {
            kind: goalKind,
            label: goalLabel,
            examDate: goalKind === 'exam' && examDate ? examDate : null,
          },
          minutesPerDay: Number(minutes) || 30,
          language: { instruction, codeSwitch },
          completedSteps: ['region', 'stage', 'curriculum', 'goal', 'language'],
        },
        true,
      );
      return;
    }
    setStep(step + 1);
  }

  const regionName = region === 'XX' ? '' : region ? countryName(region) : '';

  return (
    <main className="wrap rise onboarding" style={{ maxWidth: '40rem' }}>
      <p className="eyebrow">Setting up · {step + 1} of {TOTAL_STEPS}</p>
      <div className="steps" aria-hidden="true">
        {STEP_IDS.map((id, i) => (
          <i key={id} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      <div key={step} className="card slide-in" style={{ padding: 'var(--s6)' }}>
        {step === 0 && (
          <>
            <h1 className="ob-title">Hi{name ? ` ${name.split(' ')[0]}` : ''} — where do you study?</h1>
            <p className="muted ob-lead">
              This sets the curricula and exams we offer, and the notation and units in explanations.
            </p>
            <fieldset className="chips ob-fieldset">
              <legend className="sr-only">Common countries</legend>
              {POPULAR_COUNTRIES.map((code) => (
                <Chip key={code} pressed={region === code} onClick={() => setRegion(code)}>
                  {countryName(code)}
                </Chip>
              ))}
            </fieldset>
            <label className="ob-field">
              <span className="eyebrow">Another country</span>
              <select
                className="select"
                value={POPULAR_COUNTRIES.includes(region) ? '' : region}
                onChange={(e) => setRegion(e.target.value)}
              >
                <option value="">Choose a country…</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
                <option value="XX">Prefer not to say</option>
              </select>
            </label>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="ob-title">Where are you in your education?</h1>
            <p className="muted ob-lead">
              From your first year of school to a doctorate. Age is the reliable part — it works whether
              you&apos;re in school, at university, repeating a year, or learning on your own.
            </p>

            <label className="ob-field" style={{ maxWidth: '9rem' }}>
              <span className="eyebrow">Age</span>
              <input className="input" type="number" min={4} max={120} value={age} onChange={(e) => setAge(e.target.value)} />
            </label>

            <label className="row ob-check">
              <input
                type="checkbox"
                checked={!inSchool}
                onChange={(e) => {
                  setInSchool(!e.target.checked);
                  if (e.target.checked) setStage(null);
                }}
              />
              <span>I&apos;m not at school, college or university right now</span>
            </label>

            {inSchool &&
              (uniFirst ? (['university', 'school'] as const) : (['school', 'university'] as const)).map((band) => (
                <fieldset key={band} className="ob-group">
                  <legend className="eyebrow">
                    {band === 'school'
                      ? `School${regionName ? ` — as named in ${regionName}` : ''}`
                      : 'College & university'}
                  </legend>
                  <div className="chips">
                    {ladder
                      .filter((o) => o.band === band)
                      .map((o) => (
                        <Chip key={o.stage} pressed={stage === o.stage} onClick={() => setStage(o.stage)} title={`typically age ${o.age}`}>
                          {o.label}
                        </Chip>
                      ))}
                  </div>
                </fieldset>
              ))}
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="ob-title">What are you studying?</h1>
            <p className="muted ob-lead">
              Pick your board, exam, course or qualification — as many as apply — then your subjects. Nothing
              listed? Skip straight to subjects; everything still works.
            </p>

            <label className="ob-field">
              <span className="sr-only">Search programs and exams</span>
              <input
                className="input"
                type="search"
                placeholder="Search boards, exams, degrees… e.g. NEET, A Level, GRE"
                value={programmeQuery}
                onChange={(e) => setProgrammeQuery(e.target.value)}
              />
            </label>

            {byKind.map(([kind, items]) => {
              const open = expanded.has(kind) || programmeQuery.trim() !== '';
              const shown = open ? items : items.slice(0, SECTION_PREVIEW);
              return (
                <section key={kind} className="ob-group" aria-labelledby={`kind-${kind}`}>
                  <h2 id={`kind-${kind}`} className="eyebrow">
                    {CURRICULUM_KIND_NAME[kind]}
                  </h2>
                  <div className="chips">
                    {shown.map((p) => (
                      <Chip
                        key={p.id}
                        pressed={chosenIds.includes(p.id)}
                        onClick={() => toggleProgramme(p.id)}
                        title={p.authority}
                      >
                        {p.id === SELF_STUDY_CURRICULUM_ID ? 'Not listed / studying on my own' : p.name}
                      </Chip>
                    ))}
                    {!open && items.length > SECTION_PREVIEW && (
                      <button type="button" className="linkbtn" onClick={() => setExpanded((s) => new Set(s).add(kind))}>
                        Show {items.length - SECTION_PREVIEW} more
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
            {byKind.length === 0 && <p className="muted">Nothing matches “{programmeQuery}”. Pick subjects below instead.</p>}

            <div className="ob-subjects">
              <h2 className="ob-subtitle">
                Your subjects <span className="muted">({subjects.length}/{MAX_SUBJECTS})</span>
              </h2>
              {subjects.length > 0 ? (
                <ul className="chips ob-picked" aria-label="Chosen subjects">
                  {subjects.map((s) => (
                    <li key={s}>
                      <button type="button" className="chip chip-remove" aria-label={`Remove ${subjectName(s)}`} onClick={() => removeSubject(s)}>
                        {subjectName(s)} <CloseIcon size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ fontSize: '0.88rem' }}>None yet — pick at least one.</p>
              )}

              {suggested.length > 0 && (
                <div className="ob-group">
                  <h3 className="eyebrow">From what you picked</h3>
                  <div className="chips">
                    {suggested.map((s) => (
                      <Chip key={s} pressed={false} onClick={() => addSubject(s)} disabled={atLimit}>
                        {subjectName(s)}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <label className="ob-field">
                <span className="eyebrow">Find any subject</span>
                <input
                  className="input"
                  type="search"
                  placeholder="e.g. Organic Chemistry, Accounting, Machine Learning"
                  value={subjectQuery}
                  onChange={(e) => setSubjectQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const first = subjectMatches.find((s) => !subjects.includes(s.id));
                    if (first) addSubject(first.id);
                    else if (offerCustom && customId) addSubject(customId);
                    setSubjectQuery('');
                  }}
                />
              </label>
              {(subjectMatches.length > 0 || offerCustom) && (
                <div className="chips" aria-live="polite">
                  {subjectMatches.map((s) => (
                    <Chip
                      key={s.id}
                      pressed={subjects.includes(s.id)}
                      onClick={() => (subjects.includes(s.id) ? removeSubject(s.id) : addSubject(s.id))}
                      disabled={atLimit && !subjects.includes(s.id)}
                    >
                      {s.name}
                    </Chip>
                  ))}
                  {offerCustom && customId && (
                    <button
                      type="button"
                      className="chip chip-add"
                      disabled={atLimit}
                      onClick={() => {
                        addSubject(customId);
                        setSubjectQuery('');
                      }}
                    >
                      <PlusIcon size={14} /> Add “{subjectQuery.trim()}”
                    </button>
                  )}
                </div>
              )}

              <details className="ob-browse">
                <summary>Browse all subjects</summary>
                {browseGroups.map(({ group, items }) => (
                  <div key={group} className="ob-group">
                    <h3 className="eyebrow">{SUBJECT_GROUP_NAME[group]}</h3>
                    <div className="chips">
                      {items.map((s) => (
                        <Chip
                          key={s.id}
                          pressed={subjects.includes(s.id)}
                          onClick={() => (subjects.includes(s.id) ? removeSubject(s.id) : addSubject(s.id))}
                          disabled={atLimit && !subjects.includes(s.id)}
                        >
                          {s.name}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </details>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="ob-title">What are you working toward?</h1>
            <p className="muted ob-lead">You can change any of this later.</p>

            <div className="chips" style={{ marginBottom: 'var(--s4)' }}>
              {GOALS.map(([kind, label]) => (
                <Chip
                  key={kind}
                  pressed={goalKind === kind}
                  onClick={() => {
                    setGoalKind(kind);
                    // One exam on the table: name it for them.
                    if (kind === 'exam' && !goalLabel && examSuggestions.length === 1) setGoalLabel(examSuggestions[0] ?? '');
                  }}
                >
                  {label}
                </Chip>
              ))}
            </div>

            {goalKind === 'exam' && (
              <>
                {examSuggestions.length > 1 && (
                  <fieldset className="chips ob-fieldset" style={{ marginBottom: 'var(--s3)' }}>
                    <legend className="sr-only">Exams from your programs</legend>
                    {examSuggestions.map((e) => (
                      <Chip key={e} pressed={goalLabel === e} onClick={() => setGoalLabel(e)}>
                        {e}
                      </Chip>
                    ))}
                  </fieldset>
                )}
                {/* Labelled fields, not placeholders: a placeholder vanishes as you type
                    and the date field had no name at all (2026-11-09 test pass). */}
                <div className="row" style={{ gap: 'var(--s3)', marginBottom: 'var(--s4)', alignItems: 'flex-end' }}>
                  <label className="ob-field" style={{ flex: 2, minWidth: '10rem', margin: 0 }}>
                    <span className="eyebrow">Which exam</span>
                    <input className="input" placeholder="e.g. NEET-UG, A Level, GRE" value={goalLabel} onChange={(e) => setGoalLabel(e.target.value)} />
                  </label>
                  <label className="ob-field" style={{ flex: 1, minWidth: '9rem', margin: 0 }}>
                    <span className="eyebrow">Exam date</span>
                    <input className="input" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
                  </label>
                </div>
              </>
            )}

            <label className="ob-field" style={{ maxWidth: '12rem' }}>
              <span className="eyebrow">Minutes a day</span>
              <input className="input" type="number" min={5} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </label>

            <div className="row" style={{ gap: 'var(--s4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label className="ob-field" style={{ flex: 1, minWidth: '12rem', margin: 0 }}>
                <span className="eyebrow">Explain things in</span>
                <select className="select" value={instruction} onChange={(e) => setInstruction(e.target.value)}>
                  {LANGUAGES.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ob-field" style={{ flex: 1, minWidth: '12rem', margin: 0 }}>
                <span className="eyebrow">Mix in another language?</span>
                <select
                  className="select"
                  value={codeSwitch ?? ''}
                  onChange={(e) => setCodeSwitch(e.target.value || null)}
                >
                  <option value="">No, just one</option>
                  {LANGUAGES.filter(([c]) => c !== instruction).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: 'var(--s2)' }}>
              Plenty of people study in two at once — technical terms in one, the explanation in another.
            </p>
          </>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="pill pill-bad"
          style={{ padding: 'var(--s3)', marginTop: 'var(--s4)', whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0 }}
        >
          {error}
        </p>
      )}

      <div className="row" style={{ marginTop: 'var(--s6)', justifyContent: 'space-between' }}>
        <button type="button" className="btn btn-ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || busy}>
          Back
        </button>
        <button type="button" className="btn" onClick={next} disabled={!canAdvance || busy}>
          {busy ? 'Saving…' : step === TOTAL_STEPS - 1 ? 'Done' : 'Continue'}
        </button>
      </div>
    </main>
  );
}
