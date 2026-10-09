import { clamp, type Geometry, type MeasuredEvent, type Point, type Rect } from '../domain/model';

export type Bounds = { left: number; top: number; width: number; height: number };
/**
 * tab: viewport pixels of the captured tab's top document.
 * monitor: screen DIP bounds of the captured display.
 * window: the event's own browser window, accepted only when its size matches the captured frame.
 */
export type Surface = { kind: 'tab' } | { kind: 'monitor'; bounds: Bounds } | { kind: 'window' };
export type Mapped = { point: Point; geometry: Omit<Geometry, 'atUs'> };

const TOLERANCE = 0.002;
const inside = (n: number) => n >= -TOLERANCE && n <= 1 + TOLERANCE;

/** Converts a page measurement into the captured frame's normalized coordinates, or null when outside it. */
export function mapEvent(
  surface: Surface,
  e: MeasuredEvent,
  frame: { width: number; height: number },
): Mapped | null {
  if (
    ![e.x, e.y, e.width, e.height, e.dpr].every(Number.isFinite) ||
    e.width <= 0 ||
    e.height <= 0 ||
    e.dpr <= 0
  )
    return null;
  if (surface.kind === 'tab') {
    if (!e.top) return null;
    return {
      point: { x: clamp(e.x / e.width), y: clamp(e.y / e.height) },
      geometry: {
        id: `${e.width}:${e.height}:${e.dpr}`,
        widthCss: e.width,
        heightCss: e.height,
        dpr: e.dpr,
      },
    };
  }
  if (e.screenX === null || e.screenY === null || !Number.isFinite(e.screenX + e.screenY))
    return null;
  if (surface.kind === 'monitor') {
    const b = surface.bounds,
      x = (e.screenX - b.left) / b.width,
      y = (e.screenY - b.top) / b.height;
    if (!inside(x) || !inside(y)) return null;
    return {
      point: { x: clamp(x), y: clamp(y) },
      geometry: {
        id: `display:${b.width}:${b.height}`,
        widthCss: b.width,
        heightCss: b.height,
        dpr: e.dpr,
      },
    };
  }
  if (!(frame.width > 0 && frame.height > 0)) return null;
  const w = e.win;
  // Window capture excludes invisible resize borders that the window bounds include on some systems.
  let visibleWidth = frame.width / e.dpr,
    visibleHeight = frame.height / e.dpr,
    offsetX = (w.width - visibleWidth) / 2;
  if (Math.abs(w.width - visibleWidth) > 24 || Math.abs(w.height - visibleHeight) > 24) {
    // A downscaled frame keeps the aspect ratio; anything else is another window.
    if (Math.abs(w.width / w.height - frame.width / frame.height) > 0.03) return null;
    visibleWidth = w.width;
    visibleHeight = w.height;
    offsetX = 0;
  }
  const x = (e.screenX - w.x - offsetX) / visibleWidth,
    y = (e.screenY - w.y) / visibleHeight;
  if (!inside(x) || !inside(y)) return null;
  const gw = Math.round(visibleWidth),
    gh = Math.round(visibleHeight);
  return {
    point: { x: clamp(x), y: clamp(y) },
    geometry: { id: `window:${gw}:${gh}`, widthCss: gw, heightCss: gh, dpr: e.dpr },
  };
}

/** Picks the display whose aspect ratio matches the captured frame; ties prefer the given point. */
export function pickDisplay(
  displays: Bounds[],
  frame: { width: number; height: number },
  near?: { x: number; y: number },
) {
  const ratio = frame.width / frame.height;
  const candidates = displays.filter((d) => Math.abs(d.width / d.height - ratio) < 0.02);
  if (candidates.length <= 1 || !near) return candidates[0];
  return (
    candidates.find(
      (d) =>
        near.x >= d.left &&
        near.x < d.left + d.width &&
        near.y >= d.top &&
        near.y < d.top + d.height,
    ) ?? candidates[0]
  );
}

/**
 * Where the reporting page's viewport sits inside a screen/window capture (normalized, rounded to
 * 0.1%). Used to offer a crop that removes browser tabs and toolbars. Null for tab capture.
 */
export function viewportRect(
  surface: Surface,
  e: MeasuredEvent,
  frame: { width: number; height: number },
): Rect | null {
  if (surface.kind === 'tab' || !e.top || e.screenX === null || e.screenY === null) return null;
  // The viewport's top-left in screen DIPs, mapped like any pointer position.
  const corner = mapEvent(
    surface,
    { ...e, x: 0, y: 0, screenX: e.screenX - e.x, screenY: e.screenY - e.y },
    frame,
  );
  const far = mapEvent(
    surface,
    {
      ...e,
      x: e.width,
      y: e.height,
      screenX: e.screenX - e.x + e.width,
      screenY: e.screenY - e.y + e.height,
    },
    frame,
  );
  if (!corner || !far) return null;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const rect = {
    x: round(corner.point.x),
    y: round(corner.point.y),
    width: round(far.point.x - corner.point.x),
    height: round(far.point.y - corner.point.y),
  };
  return rect.width > 0.1 && rect.height > 0.1 ? rect : null;
}
