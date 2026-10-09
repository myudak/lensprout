import {
  DEFAULT_DEPTH,
  normalizeEvents,
  us,
  type Geometry,
  type InputEvent,
  type CameraMove,
  type Point,
  type Zoom,
} from '../domain/model';

/** Original implementation of interaction grouping, not extracted bundle code. */
export const PLANNER = {
  anticipationUs: us(0.5),
  releaseUs: us(0.1),
  mergeGapUs: us(3),
  separateGapUs: us(1),
  /** Fraction of the surface diagonal. */
  separateDistance: 0.5,
  longPressUs: us(2),
  endGuardUs: us(1),
  typingGapUs: us(3),
  typingTailUs: us(0.6),
};
export type PlannerOptions = {
  depth?: number;
  typing?: boolean;
  geometry?: Geometry[];
  /** Where the cursor sits in generated follow zooms (see Zoom.focus). */
  offset?: Point;
  /** 3D move for generated zooms; 'none' adds nothing. */
  move?: CameraMove;
};
type Action = {
  start: number;
  end: number;
  point: Point;
  id: string;
  long: boolean;
  geometryId: string;
};

/** Typing periods become synthetic presses so mouse and keyboard share one grouping rule. */
function typingActions(events: InputEvent[]): Action[] {
  const actions: Action[] = [];
  let group: InputEvent[] = [];
  const flush = (nextPressUs: number) => {
    if (!group.length) return;
    const first = group[0]!,
      last = group.at(-1)!,
      end = Math.max(last.atUs, Math.min(last.atUs + PLANNER.typingTailUs, nextPressUs - 1));
    actions.push({
      start: first.atUs,
      end,
      point: last.point,
      id: first.id,
      long: end - first.atUs > PLANNER.longPressUs,
      geometryId: last.geometryId,
    });
    group = [];
  };
  for (const e of events) {
    if (e.kind === 'pointer-down') flush(e.atUs);
    if (e.kind !== 'caret') continue;
    if (group.length && e.atUs - group.at(-1)!.atUs > PLANNER.typingGapUs) flush(Infinity);
    group.push(e);
  }
  flush(Infinity);
  return actions;
}

/** Typing periods (caret clusters) in logical time; shared with smart trim. */
export function typingPeriods(input: InputEvent[], durationUs = Number.MAX_SAFE_INTEGER) {
  return typingActions(normalizeEvents(input, durationUs)).map((a) => ({
    startUs: a.start,
    endUs: a.end,
  }));
}

export function planZooms(
  input: InputEvent[],
  durationUs: number,
  options: PlannerOptions = {},
): Zoom[] {
  const events = normalizeEvents(input, durationUs);
  const sizes = new Map((options.geometry ?? []).map((g) => [g.id, g]));
  const actions: Action[] = [];
  let down: InputEvent | undefined;
  for (const e of events) {
    if (e.kind === 'pointer-down') down = e;
    if (e.kind === 'pointer-up' && down) {
      actions.push({
        start: down.atUs,
        end: e.atUs,
        point: down.point,
        id: down.id,
        long: e.atUs - down.atUs > PLANNER.longPressUs,
        geometryId: down.geometryId,
      });
      down = undefined;
    }
  }
  if (down)
    actions.push({
      start: down.atUs,
      end: Math.min(durationUs, down.atUs + us(0.5)),
      point: down.point,
      id: down.id,
      long: false,
      geometryId: down.geometryId,
    });
  if (options.typing !== false) actions.push(...typingActions(events));
  // Distance is measured in surface pixels relative to its diagonal, so wide frames are not distorted.
  const distance = (a: Action, b: { point: Point }) => {
    const g = sizes.get(a.geometryId),
      w = g?.widthCss ?? 16,
      h = g?.heightCss ?? 9;
    return Math.hypot((a.point.x - b.point.x) * w, (a.point.y - b.point.y) * h) / Math.hypot(w, h);
  };
  const groups: { start: number; end: number; point: Point; ids: string[]; keep: boolean }[] = [];
  for (const action of actions.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))) {
    const previous = groups.at(-1);
    const gap = action.start - PLANNER.anticipationUs - (previous?.end ?? 0);
    const far = previous && distance(action, previous) > PLANNER.separateDistance;
    if (previous && gap < PLANNER.mergeGapUs && !(gap >= PLANNER.separateGapUs && far)) {
      previous.end = Math.max(previous.end, action.end + PLANNER.releaseUs);
      previous.ids.push(action.id);
      previous.keep = true;
      previous.point = action.point;
    } else
      groups.push({
        start: Math.max(0, action.start - PLANNER.anticipationUs),
        end: Math.min(durationUs, action.end + PLANNER.releaseUs),
        point: action.point,
        ids: [action.id],
        keep: action.long,
      });
  }
  return groups
    .filter((g) => g.keep && g.start < durationUs - PLANNER.endGuardUs && g.end > g.start)
    .map((g) => ({
      id: `auto:${g.ids[0]}`,
      startUs: g.start,
      endUs: Math.min(g.end, durationUs),
      magnification: options.depth ?? DEFAULT_DEPTH,
      focus:
        options.offset && (options.offset.x || options.offset.y)
          ? { mode: 'follow-pointer', offset: { ...options.offset } }
          : { mode: 'follow-pointer' },
      provenance: 'generated',
      track: 0,
      ...(options.move && options.move.kind !== 'none' ? { move: { ...options.move } } : {}),
    }));
}

export function regenerateZooms(
  current: Zoom[],
  input: InputEvent[],
  durationUs: number,
  options: PlannerOptions = {},
): Zoom[] {
  const manual = current.filter((z) => z.provenance === 'manual');
  const generated = planZooms(input, durationUs, options).filter(
    (z) => !manual.some((m) => z.startUs < m.endUs && z.endUs > m.startUs),
  );
  return [...manual, ...generated].sort((a, b) => a.startUs - b.startUs);
}
