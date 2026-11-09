import { GraspMark } from '@/components/brand/logo';
import { Skel } from '@/components/ui/skeleton';

/** Shaped like a new chat: the mark, a greeting line, the composer. */
export default function Loading() {
  return (
    <main className="ask" data-empty aria-busy="true">
      <span className="sr-only" role="status">
        Loading Ask…
      </span>
      <div className="ask-scroll">
        <div className="ask-hello">
          <span className="skel-mark">
            <GraspMark size={44} />
          </span>
          <Skel w="min(360px, 70%)" h={26} r={8} />
        </div>
      </div>
      <div className="ask-dock">
        <div className="composer-wrap">
          <Skel h={92} r={24} />
        </div>
      </div>
    </main>
  );
}
