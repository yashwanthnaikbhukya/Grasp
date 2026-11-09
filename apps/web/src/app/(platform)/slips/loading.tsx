import { PageSkeleton, Skel } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageSkeleton label="your slips">
      <Skel h={120} r={20} className="skel-block" />
      <Skel h={220} r={20} className="skel-block" />
    </PageSkeleton>
  );
}
