import { createElement } from 'react';
import { MASCOT_VIEWBOX, mascotShapes, type MascotPose } from './mascot-shapes';

/**
 * Lensprout mascot and wordmark, adapted from extension/src/components/brand/brand.tsx (copied,
 * not imported, so the landing page builds on its own).
 */
export function Mascot({
  pose = 'idle',
  className = '',
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
      className={`shrink-0 ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
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
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-heading leading-none font-semibold tracking-tight ${className}`}>
      <span className="text-foreground">Lens</span>
      <span className="text-primary">prout</span>
    </span>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mascot className="size-9" />
      <Wordmark className="text-xl" />
    </span>
  );
}
