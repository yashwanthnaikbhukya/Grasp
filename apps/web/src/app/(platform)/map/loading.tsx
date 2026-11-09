import { PageSkeleton, Skel } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageSkeleton label="your map">
      <Skel h={72} r={16} className="skel-block" />
      <Skel h={460} r={20} className="skel-block" />
    </PageSkeleton>
  );
}
