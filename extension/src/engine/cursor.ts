import {
  normalizeEvents,
  type CursorPack,
  type CursorSettings,
  type CursorStyle,
  type Geometry,
  type InputEvent,
  type Point,
  type Rect,
} from '../domain/model';
import { toCrop } from '../domain/crop';
import type { Context2D } from './render';

/** A typical system cursor is about 22 CSS px tall; geometry turns that into frame units. */
const CURSOR_CSS_PX = 22;
/** Pointer samples closer than this are interpolated; longer gaps hold the last position. */
const INTERPOLATE_US = 120_000;

export type CursorSample = {
  point: Point;
  style: CursorStyle;
  /** Height of a real cursor as a fraction of the cropped frame height. */
  height: number;
};

/**
 * The recorded pointer path in cropped-frame space, with no smoothing: the overlay must sit exactly
 * on the cursor Chrome burned into the frames. Hidden after the pointer leaves the page.
 */
export function createCursorTrack(rawEvents: InputEvent[], crop: Rect, geometry: Geometry[] = []) {
  const sizes = new Map(geometry.map((g) => [g.id, g.heightCss]));
  const events = normalizeEvents(rawEvents, Number.MAX_SAFE_INTEGER).filter(
    (e) =>
      e.kind === 'pointer-move' ||
      e.kind === 'pointer-down' ||
      e.kind === 'pointer-up' ||
      e.kind === 'pointer-leave',
  );
  const points = events.map((e) => toCrop(e.point, crop));
  function lastAtOrBefore(atUs: number) {
    let low = 0,
      high = events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (events[middle]!.atUs <= atUs) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }
  return {
    at(atUs: number): CursorSample | undefined {
      const i = lastAtOrBefore(atUs);
      const e = events[i];
      if (!e || e.kind === 'pointer-leave') return undefined;
      let point = points[i]!;
      const next = events[i + 1];
      if (next && next.kind !== 'pointer-leave' && next.atUs - e.atUs <= INTERPOLATE_US) {
        const f = (atUs - e.atUs) / (next.atUs - e.atUs),
          q = points[i + 1]!;
        point = { x: point.x + (q.x - point.x) * f, y: point.y + (q.y - point.y) * f };
      }
      const heightCss = sizes.get(e.geometryId) ?? 900;
      return {
        point,
        style: e.cursor ?? 'arrow',
        height: CURSOR_CSS_PX / heightCss / crop.height,
      };
    },
  };
}
export type CursorTrack = ReturnType<typeof createCursorTrack>;

// Shapes are authored on a 0–1 box whose height is the cursor height; (hx, hy) is the hotspot.
const ARROW: [number, number][] = [
  [0, 0],
  [0, 0.86],
  [0.22, 0.66],
  [0.36, 0.98],
  [0.5, 0.92],
  [0.36, 0.61],
  [0.64, 0.61],
];
function arrowPath(ctx: Context2D, x: number, y: number, h: number) {
  ctx.beginPath();
  ARROW.forEach(([px, py], i) =>
    i ? ctx.lineTo(x + px * h, y + py * h) : ctx.moveTo(x + px * h, y + py * h),
  );
  ctx.closePath();
}
/**
 * Each shape is ONE closed outline (no overlapping sub-shapes), so a single fill and a single
 * stroke never draw outlines across the inside. `u` is 1/24 of the cursor height.
 */
function handPath(ctx: Context2D, x: number, y: number, h: number) {
  // Pointing hand, hotspot at the index fingertip: finger up, folded knuckles to the right,
  // rounded heel and a thumb on the left.
  const u = h / 24,
    P = (px: number, py: number) => [x + px * u, y + py * u] as const;
  ctx.beginPath();
  ctx.moveTo(...P(-2.6, 2.6));
  ctx.arc(x, y + 2.6 * u, 2.6 * u, Math.PI, 2 * Math.PI);
  ctx.lineTo(...P(2.6, 9.4));
  ctx.arc(x + 4.5 * u, y + 9.6 * u, 1.9 * u, Math.PI, 2 * Math.PI);
  ctx.arc(x + 8.1 * u, y + 10.3 * u, 1.9 * u, Math.PI, 2 * Math.PI);
  ctx.arc(x + 11.6 * u, y + 11.8 * u, 1.6 * u, Math.PI, 2 * Math.PI);
  ctx.lineTo(...P(13.2, 16.5));
  ctx.quadraticCurveTo(...P(13.2, 23.4), ...P(6.6, 23.4));
  ctx.lineTo(...P(1.4, 23.4));
  ctx.quadraticCurveTo(...P(-3.4, 23.4), ...P(-5.6, 19.4));
  ctx.lineTo(...P(-8.9, 15.0));
  ctx.quadraticCurveTo(...P(-10.0, 12.2), ...P(-7.2, 12.4));
  ctx.lineTo(...P(-2.6, 14.2));
  ctx.closePath();
}
/** Knuckle creases of the pointing hand (thin, inside the outline). */
function handCreases(ctx: Context2D, x: number, y: number, h: number) {
  const u = h / 24;
  ctx.beginPath();
  for (const [cx, top] of [
    [6.4, 9.6],
    [10.0, 10.6],
  ] as const) {
    ctx.moveTo(x + cx * u, y + top * u);
    ctx.lineTo(x + cx * u, y + (top + 2.6) * u);
  }
  ctx.moveTo(x + 2.6 * u, y + 9.6 * u);
  ctx.lineTo(x + 2.6 * u, y + 13.6 * u);
}
function grabPath(ctx: Context2D, x: number, y: number, h: number) {
  // Closed hand centred on the hotspot: four knuckles on top, a thumb on the left.
  const u = h / 24,
    P = (px: number, py: number) => [x + px * u, y + py * u] as const;
  ctx.beginPath();
  ctx.moveTo(...P(-7.5, -1.2));
  ctx.arc(x - 5.6 * u, y - 1.6 * u, 1.9 * u, Math.PI, 2 * Math.PI);
  ctx.arc(x - 1.8 * u, y - 2.5 * u, 1.9 * u, Math.PI, 2 * Math.PI);
  ctx.arc(x + 2.0 * u, y - 2.2 * u, 1.9 * u, Math.PI, 2 * Math.PI);
  ctx.arc(x + 5.6 * u, y - 1.1 * u, 1.7 * u, Math.PI, 2 * Math.PI);
  ctx.lineTo(...P(7.8, 4.4));
  ctx.quadraticCurveTo(...P(7.8, 9.2), ...P(3.0, 9.2));
  ctx.lineTo(...P(-3.0, 9.2));
  ctx.quadraticCurveTo(...P(-7.0, 9.2), ...P(-8.0, 5.0));
  ctx.lineTo(...P(-9.8, 2.6));
  ctx.quadraticCurveTo(...P(-10.7, 0.0), ...P(-8.4, 0.3));
  ctx.closePath();
}
function grabCreases(ctx: Context2D, x: number, y: number, h: number) {
  const u = h / 24;
  ctx.beginPath();
  for (const cx of [-3.7, 0.1, 3.9]) {
    ctx.moveTo(x + cx * u, y - 1.8 * u);
    ctx.lineTo(x + cx * u, y + 0.8 * u);
  }
}
function beamPath(ctx: Context2D, x: number, y: number, h: number) {
  // I-beam as one outline: top serif, stem, bottom serif.
  const u = h / 24,
    half = 9 * u,
    stem = 0.9 * u,
    serif = 4 * u,
    t = 1.8 * u;
  ctx.beginPath();
  ctx.moveTo(x - serif, y - half - u);
  ctx.lineTo(x + serif, y - half - u);
  ctx.lineTo(x + serif, y - half - u + t);
  ctx.lineTo(x + stem, y - half - u + t);
  ctx.lineTo(x + stem, y + half - 0.8 * u);
  ctx.lineTo(x + serif, y + half - 0.8 * u);
  ctx.lineTo(x + serif, y + half - 0.8 * u + t);
  ctx.lineTo(x - serif, y + half - 0.8 * u + t);
  ctx.lineTo(x - serif, y + half - 0.8 * u);
  ctx.lineTo(x - stem, y + half - 0.8 * u);
  ctx.lineTo(x - stem, y - half - u + t);
  ctx.lineTo(x - serif, y - half - u + t);
  ctx.closePath();
}

/** Highlight (under the cursor) and overlay cursor, in output pixels. */
export function drawCursor(
  ctx: Context2D,
  settings: CursorSettings,
  sample: CursorSample,
  /** Output pixel position of the hotspot and pixels per unit of frame height. */
  at: { x: number; y: number; scale: number },
  box: { x: number; y: number; width: number; height: number },
) {
  const realHeight = sample.height * at.scale;
  const h = settings.highlight;
  if (h.style !== 'none') {
    const r = realHeight * 1.25 * h.size;
    ctx.save();
    if (h.style === 'spotlight') {
      ctx.fillStyle = `rgba(0, 0, 0, ${h.opacity})`;
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.width, box.height);
      ctx.arc(at.x, at.y, r * 1.6, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    } else if (h.style === 'ring') {
      ctx.globalAlpha = h.opacity;
      ctx.strokeStyle = h.color;
      ctx.lineWidth = Math.max(2, r * 0.16);
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
      g.addColorStop(0, h.color);
      g.addColorStop(1, `${h.color}00`);
      ctx.globalAlpha = h.opacity;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  const o = settings.overlay;
  if (!o.enabled) return;
  const size = realHeight * o.size,
    style = o.style === 'arrow' ? 'arrow' : sample.style;
  paintCursor(ctx, o.pack ?? 'classic', style, at.x, at.y, size, o.color, o.shadow);
}

type Look = {
  fill: (
    ctx: Context2D,
    x: number,
    y: number,
    size: number,
    color: string,
  ) => string | CanvasGradient;
  outline: string;
  /** Outline width as a fraction of the cursor height. */
  line: number;
  /** Darker copy behind, offset down-right, for a pressed-out 3D look; null = none. */
  extrude: string | null;
  /** Inner highlight stroke; null = none. */
  shine: string | null;
};
const shade = (ctx: Context2D, x: number, y: number, size: number, a: string, b: string) => {
  const g = ctx.createLinearGradient(x, y, x + size * 0.5, y + size);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
};
/** Original procedural cursor packs: same shapes, different materials. */
const PACKS: Record<CursorPack, Look> = {
  classic: {
    fill: (_c, _x, _y, _s, color) => color,
    outline: '#ffffff',
    line: 0.07,
    extrude: null,
    shine: null,
  },
  glass: {
    fill: (ctx, x, y, s) =>
      shade(ctx, x, y, s, 'rgba(255, 255, 255, 0.95)', 'rgba(186, 214, 255, 0.92)'),
    outline: '#1e293b',
    line: 0.06,
    extrude: 'rgba(30, 41, 59, 0.55)',
    shine: 'rgba(255, 255, 255, 0.9)',
  },
  pop: {
    fill: (_c, _x, _y, _s, color) => color,
    outline: '#0f0f14',
    line: 0.1,
    extrude: '#0f0f14',
    shine: 'rgba(255, 255, 255, 0.55)',
  },
  ink: { fill: () => '#0b0b10', outline: '#ffffff', line: 0.1, extrude: null, shine: null },
  sprout: {
    fill: (ctx, x, y, s) => shade(ctx, x, y, s, '#6ee7b7', '#059669'),
    outline: '#064e3b',
    line: 0.07,
    extrude: '#065f46',
    shine: 'rgba(236, 253, 245, 0.85)',
  },
};

/** Draws one cursor shape in a pack's material, hotspot at (x, y). Also used for pack swatches. */
export function paintCursor(
  ctx: Context2D,
  pack: CursorPack,
  style: CursorStyle,
  x: number,
  y: number,
  size: number,
  color: string,
  shadow: boolean,
) {
  const look = PACKS[pack] ?? PACKS.classic;
  const path = (px: number, py: number) => {
    if (style === 'pointer') handPath(ctx, px, py, size);
    else if (style === 'grab') grabPath(ctx, px, py, size);
    else if (style === 'text') beamPath(ctx, px, py, size);
    else arrowPath(ctx, px, py, size);
  };
  ctx.save();
  ctx.lineJoin = 'round';
  if (shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = size * 0.18;
    ctx.shadowOffsetY = size * 0.06;
  }
  if (look.extrude) {
    path(x + size * 0.035, y + size * 0.05);
    ctx.fillStyle = look.extrude;
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  path(x, y);
  ctx.fillStyle = look.fill(ctx, x, y, size, color);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = Math.max(1.5, size * look.line);
  ctx.strokeStyle = look.outline;
  ctx.stroke();
  if (style === 'pointer' || style === 'grab') {
    // Finger creases: thin interior lines, drawn after the fill and outline.
    (style === 'pointer' ? handCreases : grabCreases)(ctx, x, y, size);
    ctx.lineWidth = Math.max(1, size * look.line * 0.55);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    path(x, y);
  }
  if (look.shine) {
    // A thin highlight along the upper-left edge.
    ctx.save();
    ctx.clip();
    path(x + size * 0.03, y + size * 0.03);
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.strokeStyle = look.shine;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
