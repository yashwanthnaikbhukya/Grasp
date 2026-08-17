'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LearnerProfile } from '@grasp/schema';

interface CurriculumOption {
  id: string;
  name: string;
  authority: string;
  regions: string[];
  subject: string;
  stageMin: number;
  stageMax: number;
}

interface StageOption {
  stage: number;
  label: string;
  age: string;
}

const REGIONS = [
  ['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['NG', 'Nigeria'],
  ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['ID', 'Indonesia'], ['PH', 'Philippines'],
  ['BR', 'Brazil'], ['MX', 'Mexico'], ['ZA', 'South Africa'], ['KE', 'Kenya'],
  ['GH', 'Ghana'], ['EG', 'Egypt'], ['AE', 'UAE'], ['VN', 'Vietnam'],
  ['MY', 'Malaysia'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['SG', 'Singapore'],
  ['CA', 'Canada'], ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['JP', 'Japan'],
  ['XX', 'Somewhere else'],
] as const;

const GOALS = [
  ['exam', 'An exam I have coming up'],
  ['coursework', 'Keeping up with school'],
  ['self-study', 'Learning on my own'],
  ['competition', 'A competition or olympiad'],
] as const;

const LANGUAGES = [
  ['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['pt', 'Portuguese'],
  ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['ar', 'Arabic'], ['fr', 'French'],
  ['bn', 'Bengali'], ['ur', 'Urdu'], ['sw', 'Swahili'], ['tl', 'Tagalog'],
] as const;

const TOTAL_STEPS = 4;

export function OnboardingFlow({
  name,
  initial,
  curricula,
  stageLadders,
}: {
  name: string;
  initial: LearnerProfile;
  curricula: CurriculumOption[];
  stageLadders: Record<string, StageOption[]>;
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
  const [examDate, setExamDate] = useState('');
  const [minutes, setMinutes] = useState(String(initial.minutesPerDay));
  const [instruction, setInstruction] = useState(initial.language.instruction);
  const [codeSwitch, setCodeSwitch] = useState<string | null>(initial.language.codeSwitch);

  const ladder = stageLadders[region || 'XX'] ?? stageLadders.XX ?? [];

  // Candidates for this learner: their region (or international) and, once a
  // stage is picked, ones that actually cover it.
  const candidates = useMemo(() => {
    if (!region) return [];
    return curricula
      .filter((c) => c.regions.includes('*') || c.regions.includes(region))
      .filter((c) => stage === null || (stage >= c.stageMin - 1 && stage <= c.stageMax + 1))
      .sort((a, b) => (a.regions.includes('*') ? 1 : 0) - (b.regions.includes('*') ? 1 : 0));
  }, [curricula, region, stage]);

  const availableSubjects = useMemo(() => {
    const picked = curricula.filter((c) => curriculumIds.includes(c.id));
    const set = new Set(picked.map((c) => c.subject));
    if (set.size === 0) set.add('mathematics');
    return [...set];
  }, [curricula, curriculumIds]);

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

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
      if (!(await save({ curriculumIds, subjects }))) return;
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

  return (
    <main className="wrap" style={{ maxWidth: '34rem' }}>
      <p className="eyebrow">Setting up · {step + 1} of {TOTAL_STEPS}</p>
      <div className="steps" aria-hidden="true">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <i key={i} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <>
          <h1 style={{ fontSize: '1.6rem', margin: '0 0 var(--s2)' }}>
            Hi{name ? ` ${name}` : ''} — where are you?
          </h1>
          <p className="muted" style={{ marginBottom: 'var(--s5)' }}>
            This sets which curricula we offer, and the notation and units used in
            explanations.
          </p>
          <div className="chips">
            {REGIONS.map(([code, label]) => (
              <button
                key={code}
                type="button"
                className="chip"
                aria-pressed={region === code}
                onClick={() => setRegion(code)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h1 style={{ fontSize: '1.6rem', margin: '0 0 var(--s2)' }}>
            Where are you in your education?
          </h1>
          <p className="muted" style={{ marginBottom: 'var(--s5)' }}>
            Age is the reliable part — it works whether you&apos;re in school, repeating a
            year, or studying on your own.
          </p>

          <label style={{ display: 'grid', gap: 'var(--s2)', maxWidth: '9rem' }}>
            <span className="eyebrow" style={{ margin: 0 }}>Age</span>
            <input
              className="input"
              type="number"
              min={4}
              max={120}
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </label>

          <label className="row" style={{ gap: 'var(--s2)', margin: 'var(--s5) 0 var(--s4)' }}>
            <input
              type="checkbox"
              checked={!inSchool}
              onChange={(e) => {
                setInSchool(!e.target.checked);
                if (e.target.checked) setStage(null);
              }}
            />
            <span>I&apos;m not in formal education</span>
          </label>

          {inSchool && (
            <>
              <p className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>
                Year{region ? ` — as named in ${REGIONS.find(([c]) => c === region)?.[1]}` : ''}
              </p>
              <div className="chips">
                {ladder.map((o) => (
                  <button
                    key={o.stage}
                    type="button"
                    className="chip"
                    aria-pressed={stage === o.stage}
                    onClick={() => setStage(o.stage)}
                    title={`typically age ${o.age}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h1 style={{ fontSize: '1.6rem', margin: '0 0 var(--s2)' }}>What are you studying?</h1>
          <p className="muted" style={{ marginBottom: 'var(--s5)' }}>
            Pick any that apply. If yours isn&apos;t listed, self-study works fine — you
            just get the full concept graph instead of a filtered one.
          </p>

          <div className="chips" style={{ marginBottom: 'var(--s5)' }}>
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={curriculumIds.includes(c.id)}
                onClick={() => toggle(curriculumIds, c.id, setCurriculumIds)}
                title={c.authority}
              >
                {c.name}
              </button>
            ))}
          </div>

          <p className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>Subjects</p>
          <div className="chips">
            {availableSubjects.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={subjects.includes(s)}
                onClick={() => toggle(subjects, s, setSubjects)}
              >
                {s[0]?.toUpperCase()}{s.slice(1)}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h1 style={{ fontSize: '1.6rem', margin: '0 0 var(--s2)' }}>
            What are you working toward?
          </h1>
          <p className="muted" style={{ marginBottom: 'var(--s5)' }}>
            You can change any of this later.
          </p>

          <div className="chips" style={{ marginBottom: 'var(--s4)' }}>
            {GOALS.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className="chip"
                aria-pressed={goalKind === kind}
                onClick={() => setGoalKind(kind)}
              >
                {label}
              </button>
            ))}
          </div>

          {goalKind === 'exam' && (
            <div className="row" style={{ gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
              <input
                className="input"
                style={{ flex: 2, minWidth: '10rem' }}
                placeholder="Which exam?"
                value={goalLabel}
                onChange={(e) => setGoalLabel(e.target.value)}
              />
              <input
                className="input"
                style={{ flex: 1, minWidth: '9rem' }}
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
              />
            </div>
          )}

          <label style={{ display: 'grid', gap: 'var(--s2)', maxWidth: '12rem', marginBottom: 'var(--s5)' }}>
            <span className="eyebrow" style={{ margin: 0 }}>Minutes a day</span>
            <input
              className="input"
              type="number"
              min={5}
              max={600}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>

          <p className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>Explain things in</p>
          <select
            className="select"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            style={{ maxWidth: '16rem', marginBottom: 'var(--s4)' }}
          >
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>

          <p className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>
            Mix in another language?
          </p>
          <p className="muted" style={{ fontSize: '0.875rem', marginTop: 0 }}>
            Plenty of people study in two at once — technical terms in one, the
            explanation in another.
          </p>
          <div className="chips">
            <button
              type="button"
              className="chip"
              aria-pressed={codeSwitch === null}
              onClick={() => setCodeSwitch(null)}
            >
              No, just one
            </button>
            {LANGUAGES.filter(([c]) => c !== instruction).slice(0, 6).map(([code, label]) => (
              <button
                key={code}
                type="button"
                className="chip"
                aria-pressed={codeSwitch === code}
                onClick={() => setCodeSwitch(code)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="pill pill-bad" style={{ padding: 'var(--s3)', marginTop: 'var(--s4)', whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0 }}>
          {error}
        </p>
      )}

      <div className="row" style={{ marginTop: 'var(--s6)', justifyContent: 'space-between' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0 || busy}
        >
          Back
        </button>
        <button type="button" className="btn" onClick={next} disabled={!canAdvance || busy}>
          {busy ? 'Saving…' : step === TOTAL_STEPS - 1 ? 'Done' : 'Continue'}
        </button>
      </div>
    </main>
  );
}
