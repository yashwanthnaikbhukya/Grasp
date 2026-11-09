import { PageSkeleton, Skel } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageSkeleton label="Today">
      <Skel h={112} r={20} className="skel-block" />
      <div className="skel-row">
        <Skel h={96} r={16} />
        <Skel h={96} r={16} />
        <Skel h={96} r={16} />
      </div>
      <div className="skel-row skel-row-2">
        <Skel h={150} r={16} />
        <Skel h={150} r={16} />
      </div>
    </PageSkeleton>
  );
}
