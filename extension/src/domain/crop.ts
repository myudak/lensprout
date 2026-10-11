import { clamp, type InputEvent, type Point, type Project, type Rect } from './model';

export const ASPECT_RATIOS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3 } as const;

/**
 * Size of the camera's full view as a fraction of the cropped source, per axis. Contain (or a
 * native aspect) views the whole frame; fill takes the output's aspect inside it, so the camera
 * pans a narrower column (9:16) or band (16:9 of a tall source) that follows the cursor.
 */
export function viewExtents(
  project: Pick<Project, 'composition'>,
  sourceWidth: number,
  sourceHeight: number,
) {
  const c = project.composition;
  if (c.fit !== 'fill' || c.aspect === 'native' || !sourceWidth || !sourceHeight)
    return { fx: 1, fy: 1 };
  const source = (sourceWidth * c.crop.width) / (sourceHeight * c.crop.height),
    out = ASPECT_RATIOS[c.aspect];
  return out < source ? { fx: out / source, fy: 1 } : { fx: 1, fy: source / out };
}

/** Source-normalized point → cropped space (clamped, so pointers over cropped bars stay at the edge). */
export const toCrop = (p: Point, crop: Rect): Point => ({
  x: clamp((p.x - crop.x) / crop.width),
  y: clamp((p.y - crop.y) / crop.height),
});
export const isFullFrame = (crop: Rect) =>
  crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
export function cropEvents(events: InputEvent[], crop: Rect): InputEvent[] {
  return isFullFrame(crop) ? events : events.map((e) => ({ ...e, point: toCrop(e.point, crop) }));
}
/** Cropped pixel size of a source frame. */
export const croppedSize = (width: number, height: number, crop: Rect) => ({
  width: width * crop.width,
  height: height * crop.height,
});
