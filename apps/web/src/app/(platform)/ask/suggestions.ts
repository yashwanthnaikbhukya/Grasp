import { subjectInfo, subjectName, type SubjectGroup } from '@grasp/schema';

/**
 * Starter questions for a new chat, from the learner's own subjects — a history
 * student shouldn't be offered trigonometry. Specific prompts for common
 * subjects, a pattern per subject group for the rest, and one built from the
 * subject's name for anything custom.
 */
const BY_SUBJECT: Record<string, string[]> = {
  mathematics: ['Why is sine never more than 1?', 'How do I prove a trig identity?'],
  physics: ['Explain Newton’s third law with an example', 'Why does a satellite not fall to Earth?'],
  chemistry: ['What decides how reactive an element is?', 'Explain moles with a simple example'],
  biology: ['How does DNA replication work, step by step?', 'What is the difference between mitosis and meiosis?'],
  science: ['Why is the sky blue?', 'What happens to food during digestion?'],
  calculus: ['What does a derivative actually mean?', 'When do I use integration by parts?'],
  statistics: ['When should I use the median instead of the mean?', 'Explain a p-value simply'],
  'computer-science': ['How does a computer store negative numbers?', 'What is recursion, with an example?'],
  programming: ['Explain recursion with a small example', 'What is the difference between a list and a dictionary?'],
  'data-structures-algorithms': ['When is a hash map better than a binary search tree?', 'Walk me through Dijkstra’s algorithm'],
  'operating-systems': ['What is the difference between a process and a thread?', 'Explain deadlock and how to prevent it'],
  'machine-learning': ['What is overfitting and how do I avoid it?', 'Explain gradient descent intuitively'],
  economics: ['Why does a price ceiling cause shortages?', 'Explain opportunity cost with an example'],
  accountancy: ['Why does a balance sheet always balance?', 'What is the difference between cash and accrual accounting?'],
  history: ['What caused the First World War?', 'How do I structure a history essay argument?'],
  geography: ['Why do monsoons happen?', 'Explain how plate tectonics forms mountains'],
  'english-language': ['How do I write a strong opening paragraph?', 'When do I use a semicolon?'],
  'english-literature': ['How do I analyze a poem’s imagery?', 'What makes a character a tragic hero?'],
  psychology: ['Explain classical vs operant conditioning', 'What is cognitive dissonance?'],
  'political-science': ['What is the separation of powers?', 'How is a federal system different from a unitary one?'],
  'anatomy-physiology': ['How does the heart’s conduction system work?', 'Explain how a nerve impulse travels'],
  law: ['What is the difference between civil and criminal law?', 'Explain the doctrine of precedent'],
  'quantitative-aptitude': ['Give me a quick way to solve percentage problems', 'How do I approach time and work questions?'],
  'logical-reasoning': ['How do I solve seating arrangement puzzles?', 'Explain syllogisms with an example'],
};

const BY_GROUP: Record<SubjectGroup, (name: string) => string> = {
  mathematics: (n) => `Explain a key idea in ${n} from scratch`,
  sciences: (n) => `What is the most important concept in ${n} to understand first?`,
  computing: (n) => `Explain a core ${n} concept with a small example`,
  engineering: (n) => `Walk me through a typical ${n} problem`,
  medicine: (n) => `Help me understand a hard topic in ${n}`,
  languages: (n) => `Help me improve my ${n} writing`,
  humanities: (n) => `Help me plan an essay in ${n}`,
  'social-sciences': (n) => `Explain a key theory in ${n} with an example`,
  business: (n) => `Explain a core ${n} concept with a real example`,
  law: (n) => `Explain a key principle in ${n}`,
  arts: (n) => `How can I get better at ${n}?`,
  aptitude: (n) => `Give me a strategy for ${n} questions`,
};

export function starterQuestions(subjects: string[], count = 4): string[] {
  const lists = subjects.map((id) => {
    const specific = BY_SUBJECT[id];
    if (specific) return specific;
    const info = subjectInfo(id);
    const name = subjectName(id);
    return [info ? BY_GROUP[info.group](name) : `Explain a key idea in ${name} from scratch`];
  });
  // One from each subject first, then second picks — a spread, not four of one.
  const out: string[] = [];
  for (let round = 0; out.length < count && round < 2; round++) {
    for (const list of lists) {
      const q = list[round];
      if (q && !out.includes(q)) out.push(q);
      if (out.length >= count) break;
    }
  }
  if (out.length === 0) return ['Explain something I’m stuck on', 'Help me plan what to revise this week'];
  return out;
}
