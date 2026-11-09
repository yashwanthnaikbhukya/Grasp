import { Skel } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <main className="reps" aria-busy="true">
      <span className="sr-only" role="status">
        Loading practice…
      </span>
      <div className="reps-head">
        <Skel w={80} h={16} />
        <Skel w={32} h={14} />
      </div>
      <div className="reps-progress" aria-hidden="true" />
      <div className="reps-stage">
        <div className="reps-card card skel-card">
          <Skel w={120} h={18} r={999} />
          <Skel w="90%" h={18} />
          <Skel w="70%" h={18} />
          <Skel h={48} r={14} />
          <Skel h={48} r={14} />
          <Skel h={48} r={14} />
          <Skel h={48} r={14} />
        </div>
      </div>
    </main>
  );
}
