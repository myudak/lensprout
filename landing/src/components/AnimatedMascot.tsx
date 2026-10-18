import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { BRAND, mascotShapes, type MascotPose, type Shape } from '../brand/mascot-shapes';

/**
 * The Lensprout mascot, alive: it blinks, looks around (or at the pointer), sways its sprouts,
 * jumps when poked and gets watered by droplets that splash on its sprouts. It server-renders as
 * a still SVG, and every looping behavior stops under prefers-reduced-motion or off screen.
 */
export type Behavior = 'blink' | 'look' | 'follow' | 'sway' | 'droplets' | 'jumpOnVisible';

type Props = {
  pose?: MascotPose;
  className?: string;
  /** A real button: click or Enter makes it jump and waters it. */
  interactive?: boolean;
  behaviors?: Behavior[];
  /** Delay before the jump on first visibility, in ms. */
  jumpDelay?: number;
  /** Seconds between automatic waterings (with the droplets behavior). */
  waterEvery?: number;
};

// The animated version needs headroom above the sprouts for the droplets.
const VIEWBOX = '-10 -34 122 140';
const EYE = { cx: 48, cy: 60.4 };
const EYE_FREE = 23.5 - 14.1 - 1.2;
const DROP_COLORS = ['#7cc4e8', '#9fd3ee', BRAND.apricot];
const SPROUT_TIPS = [
  { x: 51, y: 9 },
  { x: 80, y: 2 },
  { x: 92, y: 22 },
];

type Drop = { id: number; x: number; y: number; color: string; delay: number };

function render(shapes: Shape[]) {
  return shapes.map((s, i) =>
    createElement(s.el, {
      key: i,
      ...Object.fromEntries(
        Object.entries(s.attrs).map(([k, v]) => [
          k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()),
          v,
        ]),
      ),
    }),
  );
}

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function AnimatedMascot({
  pose = 'idle',
  className = '',
  interactive = false,
  behaviors = ['blink', 'look', 'sway'],
  jumpDelay = 300,
  waterEvery = 7,
}: Props) {
  const shapes = mascotShapes(pose);
  const sprouts = shapes.slice(0, 3);
  const body = shapes.slice(3, 5);
  const face = shapes.slice(5);
  const hasEye = pose !== 'success';
  const eyeWhite = hasEye ? face.slice(0, 1) : [];
  const pupil = hasEye ? face.slice(1, 3) : [];
  const rest = hasEye ? face.slice(3) : face;
  const pupilShape = pupil[0];
  const pupilHome = pupilShape
    ? { x: Number(pupilShape.attrs.cx), y: Number(pupilShape.attrs.cy) }
    : { x: EYE.cx, y: EYE.cy };

  const rootRef = useRef<SVGSVGElement>(null);
  const jumpRef = useRef<SVGGElement>(null);
  const sproutRef = useRef<SVGGElement>(null);
  const eyeRef = useRef<SVGGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [drops, setDrops] = useState<Drop[]>([]);
  const [visible, setVisible] = useState(false);
  const [motion, setMotion] = useState(false);
  const dropId = useRef(0);
  const has = (b: Behavior) => behaviors.includes(b);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(!mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Only animate while on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), {
      rootMargin: '80px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const active = motion && visible;

  const jump = useCallback(() => {
    if (prefersReduced()) return;
    jumpRef.current?.animate(
      [
        { transform: 'translateY(0) scale(1, 1)' },
        { transform: 'translateY(2px) scale(1.12, 0.84)', offset: 0.18 },
        { transform: 'translateY(-26px) scale(0.92, 1.1)', offset: 0.45 },
        { transform: 'translateY(-30px) scale(1, 1)', offset: 0.55 },
        { transform: 'translateY(0) scale(1.1, 0.88)', offset: 0.8 },
        { transform: 'translateY(0) scale(1, 1)' },
      ],
      { duration: 720, easing: 'cubic-bezier(.3,.7,.4,1)' },
    );
    sproutRef.current?.animate(
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-14deg)', offset: 0.35 },
        { transform: 'rotate(10deg)', offset: 0.65 },
        { transform: 'rotate(0deg)' },
      ],
      { duration: 760, easing: 'ease-out' },
    );
  }, []);

  const water = useCallback(() => {
    if (prefersReduced()) return;
    const now = dropId.current;
    const batch: Drop[] = [0, 1, 2].map((i) => {
      const tip = SPROUT_TIPS[(now + i) % SPROUT_TIPS.length]!;
      return {
        id: ++dropId.current,
        x: tip.x + (i - 1) * 3,
        y: tip.y,
        color: DROP_COLORS[i % DROP_COLORS.length]!,
        delay: i * 260,
      };
    });
    setDrops((d) => [...d, ...batch]);
    // The sprouts perk up as the water lands.
    window.setTimeout(() => {
      sproutRef.current?.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: 'scale(1.08, 1.16)', offset: 0.4 },
          { transform: 'scale(0.98, 0.96)', offset: 0.7 },
          { transform: 'scale(1, 1)' },
        ],
        { duration: 700, easing: 'ease-out' },
      );
    }, 900);
    window.setTimeout(() => {
      setDrops((d) => d.filter((x) => !batch.some((b) => b.id === x.id)));
    }, 2200);
  }, []);

  // Blink at random intervals, sometimes twice.
  useEffect(() => {
    if (!active || !hasEye || !has('blink')) return;
    let t = 0;
    const blink = () => {
      const twice = Math.random() < 0.25;
      eyeRef.current?.animate(
        twice
          ? [
              { transform: 'scaleY(1)' },
              { transform: 'scaleY(0.08)', offset: 0.2 },
              { transform: 'scaleY(1)', offset: 0.45 },
              { transform: 'scaleY(0.08)', offset: 0.7 },
              { transform: 'scaleY(1)' },
            ]
          : [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.08)' }, { transform: 'scaleY(1)' }],
        { duration: twice ? 380 : 170, easing: 'ease-in-out' },
      );
      t = window.setTimeout(blink, 2500 + Math.random() * 3500);
    };
    t = window.setTimeout(blink, 800 + Math.random() * 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasEye]);

  // Look around when idle; follow a fine pointer when asked to.
  useEffect(() => {
    if (!active || !hasEye) return;
    const follow = has('follow') && window.matchMedia('(pointer: fine)').matches;
    let lastPointer = 0;
    let raf = 0;
    const toLook = (dx: number, dy: number) => {
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 220);
      // Home is already offset to the right; the target is relative to the eye center.
      const tx = EYE.cx + (dx / d) * EYE_FREE * k;
      const ty = EYE.cy + (dy / d) * EYE_FREE * k;
      setLook({ x: tx - pupilHome.x, y: ty - pupilHome.y });
    };
    const onMove = (e: PointerEvent) => {
      lastPointer = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = rootRef.current?.getBoundingClientRect();
        if (!r) return;
        const scale = r.width / 122;
        const ex = r.left + (EYE.cx + 10) * scale;
        const ey = r.top + (EYE.cy + 34) * scale;
        toLook(e.clientX - ex, e.clientY - ey);
      });
    };
    if (follow) window.addEventListener('pointermove', onMove, { passive: true });
    let t = 0;
    const wander = () => {
      if (has('look') && performance.now() - lastPointer > 2500) {
        const a = Math.random() * Math.PI * 2;
        const center = Math.random() < 0.3;
        if (center) setLook({ x: 0, y: 0 });
        else toLook(Math.cos(a) * 300, Math.sin(a) * 160);
      }
      t = window.setTimeout(wander, 1600 + Math.random() * 2200);
    };
    t = window.setTimeout(wander, 1200);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasEye]);

  // Water now and then.
  useEffect(() => {
    if (!active || !has('droplets')) return;
    const first = window.setTimeout(water, 1400);
    const every = window.setInterval(water, waterEvery * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, water, waterEvery]);

  // Jump the first time it scrolls into view.
  const jumped = useRef(false);
  useEffect(() => {
    if (!active || jumped.current || !has('jumpOnVisible')) return;
    jumped.current = true;
    const t = window.setTimeout(jump, jumpDelay);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, jump, jumpDelay]);

  const poke = () => {
    jump();
    if (has('droplets')) window.setTimeout(water, 250);
  };

  const svg = (
    <svg
      ref={rootRef}
      viewBox={VIEWBOX}
      className={`mascot-anim block overflow-visible ${className}`}
      data-playing={active ? 'true' : 'false'}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse className="mascot-shadow" cx="45" cy="101" rx="34" ry="4" />
      <g ref={jumpRef} className="mascot-jump">
        <g className={has('sway') ? 'mascot-sway' : undefined}>
          <g ref={sproutRef} className="mascot-sprouts">
            {render(sprouts)}
          </g>
        </g>
        <g className="mascot-body">{render(body)}</g>
        {hasEye && (
          <g ref={eyeRef} className="mascot-eye">
            {render(eyeWhite)}
            <g
              className="mascot-pupil"
              style={{ transform: `translate(${look.x}px, ${look.y}px)` }}
            >
              {render(pupil)}
            </g>
          </g>
        )}
        {render(rest)}
      </g>
      {drops.map((d) => (
        <g
          key={d.id}
          className="mascot-drop"
          style={
            {
              '--dx': `${d.x}px`,
              '--dy': `${d.y}px`,
            } as CSSProperties
          }
        >
          <path
            className="mascot-drop-body"
            d="M0 -7C2.6 -3.4 4 -1.2 4 1A4 4 0 0 1 -4 1C-4 -1.2 -2.6 -3.4 0 -7Z"
            fill={d.color}
            style={{ animationDelay: `${d.delay}ms` }}
          />
          <g className="mascot-splash" style={{ animationDelay: `${d.delay + 820}ms` }}>
            <circle cx="-6" cy="0" r="1.6" fill={d.color} />
            <circle cx="6" cy="-1" r="1.4" fill={d.color} />
            <circle cx="0" cy="-5" r="1.2" fill={d.color} />
          </g>
        </g>
      ))}
    </svg>
  );

  if (!interactive) return svg;
  return (
    <button
      type="button"
      onClick={poke}
      aria-label="Poke the Lensprout mascot"
      className="mascot-button cursor-pointer rounded-full"
    >
      {svg}
    </button>
  );
}
