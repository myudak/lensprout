import { clamp, us, type Project, type Segment, type SegmentKind, type Zoom } from './model';
import {
  EXCLUSIVE,
  conflicts,
  items,
  overlaps,
  patchItems,
  type Item,
  type ItemKind,
} from './segments';

export const MIN_ZOOM_US = us(0.1);
const MAX_TRACKS = 32;
const sortZooms = (zooms: Zoom[]) => [...zooms].sort((a, b) => a.startUs - b.startUs);

/** Neighbouring limits for an item: the closest conflicting items before and after it. */
function boundsFor(project: Project, item: Item, durationUs: number) {
  let start = 0,
    end = durationUs;
  for (const o of items(project)) {
    if (!conflicts(item, o)) continue;
    if (o.endUs <= item.startUs) start = Math.max(start, o.endUs);
    else if (o.startUs >= item.endUs) end = Math.min(end, o.startUs);
  }
  return { start, end };
}
export function zoomBounds(project: Project, id: string, durationUs: number) {
  const item = items(project).find((i) => i.id === id)!;
  return boundsFor(project, item, durationUs);
}

/**
 * Places a new item at `atUs`: exclusive kinds may not start inside one of their kind and stop at
 * the next; the item goes on the lowest track that is free for its whole range.
 */
function place(project: Project, kind: ItemKind, atUs: number, lengthUs: number) {
  const startUs = Math.max(project.trim.startUs, Math.round(atUs));
  const all = items(project);
  let endUs = Math.min(project.trim.endUs, startUs + lengthUs);
  if (EXCLUSIVE.includes(kind)) {
    if (all.some((i) => i.kind === kind && i.startUs <= startUs && i.endUs > startUs))
      throw new Error(
        `Move the playhead outside an existing ${kind === 'zoom' ? 'zoom' : `${kind} segment`} to add another.`,
      );
    const next = all
      .filter((i) => i.kind === kind && i.startUs > startUs)
      .sort((a, b) => a.startUs - b.startUs)[0];
    endUs = Math.min(endUs, next?.startUs ?? Infinity);
  }
  if (endUs - startUs < MIN_ZOOM_US) throw new Error('Leave at least 0.1 seconds for a segment.');
  for (let track = 0; track < MAX_TRACKS; track++)
    if (!all.some((i) => i.track === track && overlaps(i, { startUs, endUs })))
      return { startUs, endUs, track };
  throw new Error('No free track at the playhead.');
}

export function addZoom(project: Project, atUs: number, lengthUs = us(2)): Project {
  const at = place(project, 'zoom', atUs, lengthUs);
  const zoom: Zoom = {
    id: crypto.randomUUID(),
    ...at,
    magnification: project.autoZoom.depth,
    focus: { mode: 'follow-pointer' },
    provenance: 'manual',
  };
  return { ...project, zooms: sortZooms([...project.zooms, zoom]) };
}

export const SEGMENT_DEFAULTS: { [K in SegmentKind]: { lengthUs: number; label: string } } = {
  cut: { lengthUs: us(1), label: 'Trim (cut out)' },
  speed: { lengthUs: us(3), label: 'Speed' },
  audio: { lengthUs: us(3), label: 'Audio' },
  text: { lengthUs: us(2.5), label: 'Text' },
  blur: { lengthUs: us(3), label: 'Blur' },
  camera: { lengthUs: us(3), label: 'Camera' },
};

/** Copies an item to start where it ends (same length if room), on the lowest free track. */
export function duplicateItem(project: Project, id: string): Project {
  const item = items(project).find((i) => i.id === id);
  if (!item) return project;
  const at = place(project, item.kind, item.endUs, item.endUs - item.startUs);
  const copyId = crypto.randomUUID();
  if (item.kind === 'zoom') {
    const z = project.zooms.find((zoom) => zoom.id === id)!;
    return {
      ...project,
      zooms: sortZooms([
        ...project.zooms,
        { ...structuredClone(z), id: copyId, ...at, provenance: 'manual' },
      ]),
    };
  }
  const s = project.segments.find((segment) => segment.id === id)!;
  return {
    ...project,
    segments: [...project.segments, { ...structuredClone(s), id: copyId, ...at }],
  };
}

export function addSegment(project: Project, kind: SegmentKind, atUs: number): Project {
  const at = place(project, kind, atUs, SEGMENT_DEFAULTS[kind].lengthUs);
  const base = { id: crypto.randomUUID(), ...at };
  const segment: Segment =
    kind === 'cut'
      ? { ...base, kind }
      : kind === 'speed'
        ? { ...base, kind, speed: 2 }
        : kind === 'audio'
          ? { ...base, kind, volume: 0 }
          : kind === 'text'
            ? {
                ...base,
                kind,
                text: 'Your text here',
                position: { x: 0.5, y: 0.85 },
                size: 56,
                color: '#ffffff',
                style: 'pill',
              }
            : kind === 'camera'
              ? { ...base, kind, layout: 'large' }
              : {
                  ...base,
                  kind,
                  rect: { x: 0.35, y: 0.35, width: 0.3, height: 0.2 },
                  strength: 18,
                };
  return { ...project, segments: [...project.segments, segment] };
}

export function resizeItem(
  project: Project,
  id: string,
  edge: 'start' | 'end',
  atUs: number,
  durationUs: number,
): Project {
  const item = items(project).find((i) => i.id === id);
  if (!item) return project;
  const bounds = boundsFor(project, item, durationUs);
  return patchItems(project, (i) =>
    i.id !== id
      ? undefined
      : edge === 'start'
        ? { startUs: Math.round(clamp(atUs, bounds.start, i.endUs - MIN_ZOOM_US)) }
        : { endUs: Math.round(clamp(atUs, i.startUs + MIN_ZOOM_US, bounds.end)) },
  );
}
export const resizeZoom = resizeItem;

function tryMove(
  project: Project,
  ids: Set<string>,
  deltaUs: number,
  durationUs: number,
  trackDelta: number,
): Project | null {
  const all = items(project),
    selected = all.filter((i) => ids.has(i.id)),
    others = all.filter((i) => !ids.has(i.id));
  if (!selected.length) return null;
  let low = -Infinity,
    high = Infinity;
  for (const s of selected) {
    const moved = { ...s, track: s.track + trackDelta };
    if (moved.track < 0 || moved.track >= MAX_TRACKS) return null;
    for (const o of others) {
      if (!conflicts(moved, o)) continue;
      if (overlaps(s, o)) return null;
      if (o.endUs <= s.startUs) low = Math.max(low, o.endUs - s.startUs);
      else high = Math.min(high, o.startUs - s.endUs);
    }
    low = Math.max(low, -s.startUs);
    high = Math.min(high, durationUs - s.endUs);
  }
  const shift = Math.round(clamp(deltaUs, Math.min(0, low), Math.max(0, high)));
  if (!shift && !trackDelta) return project;
  return patchItems(project, (i) =>
    ids.has(i.id)
      ? { startUs: i.startUs + shift, endUs: i.endUs + shift, track: i.track + trackDelta }
      : undefined,
  );
}

/**
 * Moves the selected items together in time (and optionally across tracks). The shift is clamped
 * so nothing crosses a conflicting item; a blocked track change falls back to a same-track move.
 */
export function moveItems(
  project: Project,
  ids: string[],
  deltaUs: number,
  durationUs: number,
  trackDelta = 0,
): Project {
  const set = new Set(ids);
  return (
    (trackDelta ? tryMove(project, set, deltaUs, durationUs, trackDelta) : null) ??
    tryMove(project, set, deltaUs, durationUs, 0) ??
    project
  );
}
export const moveZooms = (project: Project, ids: string[], deltaUs: number, durationUs: number) =>
  moveItems(project, ids, deltaUs, durationUs);

export function splitItem(project: Project, id: string, atUs: number): Project {
  const item = items(project).find((i) => i.id === id);
  if (!item || atUs - item.startUs < MIN_ZOOM_US || item.endUs - atUs < MIN_ZOOM_US)
    throw new Error(
      'Place the playhead inside the segment, at least 0.1 seconds from either edge.',
    );
  const at = Math.round(atUs),
    newId = crypto.randomUUID();
  if (item.kind === 'zoom') {
    const z = project.zooms.find((zoom) => zoom.id === id)!;
    return {
      ...project,
      zooms: sortZooms([
        ...project.zooms.filter((zoom) => zoom.id !== id),
        { ...z, endUs: at, provenance: 'manual' },
        { ...z, id: newId, startUs: at, provenance: 'manual' },
      ]),
    };
  }
  const s = project.segments.find((segment) => segment.id === id)!;
  return {
    ...project,
    segments: [
      ...project.segments.filter((segment) => segment.id !== id),
      { ...s, endUs: at },
      { ...s, id: newId, startUs: at },
    ],
  };
}
export const splitZoom = splitItem;

export function removeItems(project: Project, ids: string[]): Project {
  const selected = new Set(ids);
  return {
    ...project,
    zooms: project.zooms.filter((z) => !selected.has(z.id)),
    segments: project.segments.filter((s) => !selected.has(s.id)),
  };
}
export const removeZooms = removeItems;

/** Moves each listed item that conflicts on its track to the lowest free track (e.g. after regeneration). */
export function settleTracks(project: Project, ids: string[]): Project {
  let next = project;
  for (const id of ids) {
    const all = items(next),
      item = all.find((i) => i.id === id);
    if (!item || !all.some((o) => o.track === item.track && o.id !== id && overlaps(o, item)))
      continue;
    for (let track = 0; track < MAX_TRACKS; track++)
      if (!all.some((o) => o.id !== id && o.track === track && overlaps(o, item))) {
        next = patchItems(next, (i) => (i.id === id ? { track } : undefined));
        break;
      }
  }
  return next;
}

export function setTrim(
  project: Project,
  edge: 'start' | 'end',
  atUs: number,
  durationUs: number,
): Project {
  const { startUs, endUs } = project.trim;
  const minimum = us(0.5);
  return {
    ...project,
    trim:
      edge === 'start'
        ? { startUs: Math.round(clamp(atUs, 0, endUs - minimum)), endUs }
        : { startUs, endUs: Math.round(clamp(atUs, startUs + minimum, durationUs)) },
  };
}
