import { PageSkeleton, Skel } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageSkeleton label="your profile">
      <Skel h={360} r={20} className="skel-block" />
      <Skel h={88} r={20} className="skel-block" />
    </PageSkeleton>
  );
}
