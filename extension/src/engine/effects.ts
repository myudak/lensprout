import {
  FULL_FRAME,
  normalizeEvents,
  type Force,
  type Geometry,
  type InputEvent,
  type Point,
  type Rect,
} from '../domain/model';
import { toCrop } from '../domain/crop';
import { createCursorTrack } from './cursor';

export const CLICK_US = 550_000;
export const CHORD_US = 1_300_000;
export const FORCE: Record<Force, number> = { weak: 0.75, moderate: 1, strong: 1.35 };

function lastIndexAtOrBefore(events: InputEvent[], atUs: number) {
  let low = 0,
    high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle]!.atUs <= atUs) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export type Overlays = ReturnType<typeof createOverlays>;
/** Time-indexed overlay lookup shared by preview and export. */
export function createOverlays(
  rawEvents: InputEvent[],
  crop: Rect = FULL_FRAME,
  geometry: Geometry[] = [],
) {
  const cursorTrack = createCursorTrack(rawEvents, crop, geometry);
  const events = normalizeEvents(rawEvents, Number.MAX_SAFE_INTEGER);
  // Clicks on cropped-away areas (e.g. browser bars) are not shown.
  const inside = (p: Point) =>
    p.x >= crop.x && p.x <= crop.x + crop.width && p.y >= crop.y && p.y <= crop.y + crop.height;
  const clicks = events
      .filter((e) => e.kind === 'pointer-down' && inside(e.point))
      .map((e) => ({ ...e, point: toCrop(e.point, crop) })),
    chords = events.filter((e) => e.kind === 'chord');
  return {
    cursor: cursorTrack.at,
    clicks(atUs: number): { point: Point; ageUs: number }[] {
      const result: { point: Point; ageUs: number }[] = [];
      for (let i = lastIndexAtOrBefore(clicks, atUs); i >= 0; i--) {
        const age = atUs - clicks[i]!.atUs;
        if (age >= CLICK_US) break;
        result.push({ point: clicks[i]!.point, ageUs: age });
      }
      return result;
    },
    chord(atUs: number): { keys: string; ageUs: number } | undefined {
      const c = chords[lastIndexAtOrBefore(chords, atUs)];
      return c && atUs - c.atUs < CHORD_US ? { keys: c.keys!, ageUs: atUs - c.atUs } : undefined;
    },
  };
}
