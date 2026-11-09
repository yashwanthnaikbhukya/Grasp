import { z } from 'zod';

/**
 * What a learner can study — school through university and professional exams.
 *
 * A catalogue of its own, not a by-product of curricula: a learner picks the
 * subjects they actually take, and a programme (CBSE Senior Secondary, NEET-UG,
 * "University coursework") only *suggests* some of them. Anything missing can
 * be typed in — a custom subject is a first-class case, like self-study.
 *
 * Ids are stable kebab-case slugs: they are stored on profiles, chunks,
 * questions and concepts (`subject`), so renaming one is a migration. Names are
 * presentation and can change freely.
 *
 * `stage` is advisory (see stage.ts): it orders the picker so a Class 7 learner
 * sees Science before Organic Chemistry. It never hides a subject — search finds
 * everything.
 */

export const SubjectId = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'subject ids are kebab-case slugs');
export type SubjectId = z.infer<typeof SubjectId>;

export const SubjectGroup = z.enum([
  'mathematics',
  'sciences',
  'computing',
  'engineering',
  'medicine',
  'languages',
  'humanities',
  'social-sciences',
  'business',
  'law',
  'arts',
  'aptitude',
]);
export type SubjectGroup = z.infer<typeof SubjectGroup>;

export const SUBJECT_GROUP_NAME: Record<SubjectGroup, string> = {
  mathematics: 'Mathematics & statistics',
  sciences: 'Sciences',
  computing: 'Computing & data',
  engineering: 'Engineering',
  medicine: 'Medicine & health',
  languages: 'Languages & literature',
  humanities: 'Humanities',
  'social-sciences': 'Social sciences',
  business: 'Business & commerce',
  law: 'Law',
  arts: 'Arts, design & PE',
  aptitude: 'Aptitude & test skills',
};

export interface SubjectInfo {
  id: SubjectId;
  name: string;
  group: SubjectGroup;
  /** Typical stage band (stage.ts), advisory: it orders the picker, never hides. */
  stage: { min: number; max: number };
}

const S = (id: string, name: string, group: SubjectGroup, min: number, max: number): SubjectInfo => ({
  id,
  name,
  group,
  stage: { min, max },
});

/** Ordered within each group roughly from earliest-taught to most advanced. */
export const SUBJECTS: readonly SubjectInfo[] = [
  // Mathematics & statistics
  S('mathematics', 'Mathematics', 'mathematics', 1, 18),
  S('further-mathematics', 'Further Mathematics', 'mathematics', 11, 12),
  S('statistics', 'Statistics & Probability', 'mathematics', 9, 18),
  S('calculus', 'Calculus', 'mathematics', 11, 16),
  S('linear-algebra', 'Linear Algebra', 'mathematics', 13, 17),
  S('discrete-mathematics', 'Discrete Mathematics', 'mathematics', 13, 16),
  S('engineering-mathematics', 'Engineering Mathematics', 'mathematics', 13, 16),
  S('real-analysis', 'Real Analysis', 'mathematics', 14, 18),
  S('abstract-algebra', 'Abstract Algebra', 'mathematics', 14, 18),

  // Sciences
  S('science', 'Science (general)', 'sciences', 1, 10),
  S('environmental-science', 'Environmental Science', 'sciences', 1, 16),
  S('physics', 'Physics', 'sciences', 6, 18),
  S('chemistry', 'Chemistry', 'sciences', 6, 18),
  S('biology', 'Biology', 'sciences', 6, 18),
  S('earth-science', 'Earth & Space Science', 'sciences', 6, 14),
  S('organic-chemistry', 'Organic Chemistry', 'sciences', 11, 16),
  S('biochemistry', 'Biochemistry', 'sciences', 13, 18),
  S('microbiology', 'Microbiology', 'sciences', 13, 18),
  S('biotechnology', 'Biotechnology', 'sciences', 11, 18),
  S('genetics', 'Genetics', 'sciences', 13, 18),
  S('astronomy', 'Astronomy & Astrophysics', 'sciences', 11, 18),

  // Computing & data
  S('computer-science', 'Computer Science', 'computing', 6, 18),
  S('information-technology', 'Information Technology / ICT', 'computing', 6, 16),
  S('programming', 'Programming', 'computing', 6, 18),
  S('web-development', 'Web Development', 'computing', 9, 18),
  S('data-structures-algorithms', 'Data Structures & Algorithms', 'computing', 11, 18),
  S('databases', 'Databases & SQL', 'computing', 11, 17),
  S('operating-systems', 'Operating Systems', 'computing', 13, 17),
  S('computer-networks', 'Computer Networks', 'computing', 13, 17),
  S('data-science', 'Data Science', 'computing', 13, 18),
  S('machine-learning', 'Machine Learning & AI', 'computing', 13, 18),
  S('cybersecurity', 'Cybersecurity', 'computing', 13, 18),

  // Engineering
  S('engineering-mechanics', 'Engineering Mechanics', 'engineering', 13, 16),
  S('electrical-engineering', 'Circuits & Electrical Engineering', 'engineering', 13, 17),
  S('electronics', 'Electronics', 'engineering', 11, 17),
  S('thermodynamics', 'Thermodynamics', 'engineering', 13, 17),
  S('mechanical-engineering', 'Mechanical Engineering', 'engineering', 13, 17),
  S('civil-engineering', 'Civil Engineering', 'engineering', 13, 17),
  S('chemical-engineering', 'Chemical Engineering', 'engineering', 13, 17),

  // Medicine & health
  S('anatomy-physiology', 'Anatomy & Physiology', 'medicine', 13, 18),
  S('pharmacology', 'Pharmacology', 'medicine', 13, 18),
  S('pathology', 'Pathology', 'medicine', 13, 18),
  S('clinical-medicine', 'Clinical Medicine', 'medicine', 14, 18),
  S('nursing', 'Nursing', 'medicine', 13, 17),
  S('public-health', 'Public Health', 'medicine', 13, 18),

  // Languages & literature
  S('english-language', 'English Language', 'languages', 1, 18),
  S('english-literature', 'English Literature', 'languages', 6, 18),
  S('hindi', 'Hindi', 'languages', 1, 12),
  S('sanskrit', 'Sanskrit', 'languages', 6, 12),
  S('urdu', 'Urdu', 'languages', 1, 12),
  S('bengali', 'Bengali', 'languages', 1, 12),
  S('tamil', 'Tamil', 'languages', 1, 12),
  S('telugu', 'Telugu', 'languages', 1, 12),
  S('marathi', 'Marathi', 'languages', 1, 12),
  S('kannada', 'Kannada', 'languages', 1, 12),
  S('malayalam', 'Malayalam', 'languages', 1, 12),
  S('gujarati', 'Gujarati', 'languages', 1, 12),
  S('punjabi', 'Punjabi', 'languages', 1, 12),
  S('spanish', 'Spanish', 'languages', 1, 18),
  S('french', 'French', 'languages', 1, 18),
  S('german', 'German', 'languages', 1, 18),
  S('italian', 'Italian', 'languages', 6, 18),
  S('portuguese', 'Portuguese', 'languages', 1, 18),
  S('arabic', 'Arabic', 'languages', 1, 18),
  S('chinese', 'Chinese (Mandarin)', 'languages', 1, 18),
  S('japanese', 'Japanese', 'languages', 1, 18),
  S('korean', 'Korean', 'languages', 1, 18),
  S('russian', 'Russian', 'languages', 6, 18),
  S('indonesian', 'Indonesian', 'languages', 1, 12),
  S('swahili', 'Swahili', 'languages', 1, 12),
  S('latin', 'Latin', 'languages', 6, 16),

  // Humanities
  S('social-studies', 'Social Studies / Social Science', 'humanities', 1, 10),
  S('history', 'History', 'humanities', 3, 18),
  S('geography', 'Geography', 'humanities', 3, 18),
  S('political-science', 'Civics & Political Science', 'humanities', 6, 18),
  S('philosophy', 'Philosophy', 'humanities', 11, 18),
  S('religious-studies', 'Religious Studies', 'humanities', 6, 16),

  // Social sciences
  S('economics', 'Economics', 'social-sciences', 9, 18),
  S('psychology', 'Psychology', 'social-sciences', 11, 18),
  S('sociology', 'Sociology', 'social-sciences', 11, 18),
  S('anthropology', 'Anthropology', 'social-sciences', 13, 18),

  // Business & commerce
  S('business-studies', 'Business Studies', 'business', 9, 16),
  S('accountancy', 'Accounting', 'business', 9, 18),
  S('finance', 'Finance', 'business', 13, 18),
  S('marketing', 'Marketing', 'business', 13, 18),
  S('management', 'Management', 'business', 13, 18),
  S('entrepreneurship', 'Entrepreneurship', 'business', 11, 18),

  // Law
  S('law', 'Law', 'law', 13, 18),
  S('legal-reasoning', 'Legal Reasoning', 'law', 11, 18),

  // Arts, design & PE
  S('art-design', 'Art & Design', 'arts', 1, 18),
  S('music', 'Music', 'arts', 1, 18),
  S('drama', 'Drama & Theatre', 'arts', 6, 16),
  S('design-technology', 'Design & Technology', 'arts', 6, 12),
  S('media-studies', 'Media Studies', 'arts', 9, 16),
  S('physical-education', 'Physical Education', 'arts', 1, 12),

  // Aptitude & test skills — what entrance and recruitment exams test
  S('quantitative-aptitude', 'Quantitative Aptitude', 'aptitude', 9, 18),
  S('logical-reasoning', 'Logical Reasoning', 'aptitude', 9, 18),
  S('verbal-ability', 'Verbal Ability & Reading', 'aptitude', 9, 18),
  S('data-interpretation', 'Data Interpretation', 'aptitude', 11, 18),
  S('general-knowledge', 'General Knowledge & Current Affairs', 'aptitude', 9, 18),
];

const BY_ID = new Map(SUBJECTS.map((s) => [s.id, s]));

export function subjectInfo(id: string): SubjectInfo | undefined {
  return BY_ID.get(id);
}

/** The display name; a custom subject (not in the catalogue) in title case, like the rest. */
export function subjectName(id: string): string {
  const known = BY_ID.get(id);
  if (known) return known.name;
  return id
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** A learner-typed subject → a stable slug. "Organic Chem!" → "organic-chem". */
export function customSubjectId(text: string): string | null {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  if (slug.length < 2) return null;
  // Typing the name of a catalogue subject picks that subject.
  const byName = SUBJECTS.find((s) => s.name.toLowerCase() === text.trim().toLowerCase());
  return byName?.id ?? slug;
}

/** True when the subject's typical band is within a stage of the learner's. */
export function subjectFitsStage(s: SubjectInfo, stage: number | null): boolean {
  if (stage === null) return true;
  return stage >= s.stage.min - 1 && stage <= s.stage.max + 1;
}
