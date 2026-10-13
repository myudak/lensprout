import { createElement } from 'react';
import { cn } from '@/src/lib/utils';
import { MASCOT_VIEWBOX, mascotShapes, type MascotPose } from './mascot-shapes';

/** The Lensprout mascot (original vector redraw of the Coral Playground concept). */
export function Mascot({
  pose = 'idle',
  className,
  title,
}: {
  pose?: MascotPose;
  className?: string;
  /** When set, the mascot is announced; otherwise it is decorative. */
  title?: string;
}) {
  return (
    <svg
      viewBox={MASCOT_VIEWBOX}
      className={cn('size-10 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {mascotShapes(pose).map((s, i) =>
        createElement(s.el, {
          key: i,
          ...Object.fromEntries(
            Object.entries(s.attrs).map(([k, v]) => [
              k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()),
              v,
            ]),
          ),
        }),
      )}
    </svg>
  );
}

/** Wordmark "Lensprout": "Lens" in the foreground color, "prout" in the (AA) primary coral. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn('font-heading text-lg leading-none font-semibold tracking-tight', className)}
    >
      <span className="text-foreground">Lens</span>
      <span className="text-primary">prout</span>
    </span>
  );
}

export function Logo({ className, pose }: { className?: string; pose?: MascotPose }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Mascot pose={pose} className="size-8" />
      <Wordmark />
    </span>
  );
}
