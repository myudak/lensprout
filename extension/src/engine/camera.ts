import { cropEvents } from '../domain/crop';
import {
  clamp,
  normalizeEvents,
  type InputEvent,
  type Point,
  type Project,
  type Zoom,
} from '../domain/model';
/**
 * x/y/zoom: the 2D view into the cropped frame. yaw/pitch/roll (degrees) and push (0–0.3) pose the
 * 3D stage; they stay 0 in flat mode. Positive yaw turns the screen to face left (its right edge
 * recedes); positive pitch tips its bottom edge away.
 */
export type Camera = {
  x: number;
  y: number;
  zoom: number;
  /** View size at zoom 1 as a fraction of the cropped frame per axis (fill < 1, contain 1). */
  fx: number;
  fy: number;
  yaw: number;
  pitch: number;
  roll: number;
  push: number;
};
type Spring = { value: number; velocity: number };
type State = {
  x: Spring;
  y: Spring;
  z: Spring;
  yaw: Spring;
  pitch: Spring;
  roll: Spring;
  push: Spring;
  gx: number;
  gy: number;
  active: string | null;
};

/** Times are seconds. Values were chosen to resemble the reference's ~150 ms damper, independently tuned. */
export const CAMERA = {
  rate: 60,
  panDecay: 0.17,
  zoomInDecay: 0.16,
  zoomOutDecay: 0.22,
  /** Retarget when the pointer is this fraction of the visible width away from the held center. */
  deadZone: 0.33,
  /** Lookahead multiplier on pan decay × √depth. */
  lookahead: 1.5,
  interpolateGapUs: 250_000,
  /** 3D moves: rotation springs entering a move, leaving it, and following the pointer (swing). */
  turnInDecay: 0.28,
  turnOutDecay: 0.35,
  swingDecay: 0.3,
  pushDecay: 0.24,
  /** Degrees at strength 1. */
  tiltYaw: 18,
  tiltPitch: 8,
  tiltRoll: 2,
  orbitYaw: 22,
  orbitPitch: 6,
  dollyPush: 0.25,
  dollyPitch: 4,
  swingYaw: 20,
  swingPitch: 12,
  maxYaw: 35,
  maxPitch: 30,
};

/** Exact critically damped step with time constant `decay`; snaps once the residual is negligible. */
export function spring(state: Spring, target: number, dt: number, decay: number): Spring {
  const omega = 1 / decay;
  const displacement = state.value - target;
  const rate = state.velocity + omega * displacement;
  const fall = Math.exp(-omega * dt);
  const value = target + (displacement + rate * dt) * fall;
  const velocity = (state.velocity - omega * rate * dt) * fall;
  if (Math.abs(value - target) < 1e-5 && Math.abs(velocity) < 1e-4)
    return { value: target, velocity: 0 };
  return { value, velocity };
}

const sameZoom = (a?: Zoom, b?: Zoom) =>
  !!a &&
  !!b &&
  a.id === b.id &&
  a.startUs === b.startUs &&
  a.endUs === b.endUs &&
  a.magnification === b.magnification &&
  JSON.stringify(a.focus) === JSON.stringify(b.focus) &&
  JSON.stringify(a.move) === JSON.stringify(b.move);

/** Pose targets for a time: resting stage tilt plus the active zoom's move (3D stage only). */
function poseTarget(
  project: Pick<Project, 'stage'>,
  zoom: Zoom | undefined,
  t: number,
  look: () => Point,
) {
  const stage = project.stage;
  if (stage?.mode !== '3d') return { yaw: 0, pitch: 0, roll: 0, push: 0, swing: false };
  let yaw = stage.tilt.yaw,
    pitch = stage.tilt.pitch,
    roll = 0,
    push = 0,
    swing = false;
  const move = zoom?.move;
  if (zoom && move && move.kind !== 'none') {
    const s = move.strength,
      sign = move.direction === 'left' ? 1 : -1;
    if (move.kind === 'tilt') {
      yaw += sign * CAMERA.tiltYaw * s;
      pitch -= CAMERA.tiltPitch * s;
      roll += sign * CAMERA.tiltRoll * s;
    } else if (move.kind === 'orbit') {
      // A steady sweep from one side to the other across the zoom.
      const p = clamp((t - zoom.startUs) / Math.max(1, zoom.endUs - zoom.startUs), 0, 1);
      yaw += sign * CAMERA.orbitYaw * s * (1 - 2 * p);
      pitch -= CAMERA.orbitPitch * s;
    } else if (move.kind === 'dolly') {
      push = CAMERA.dollyPush * s;
      pitch -= CAMERA.dollyPitch * s;
    } else {
      // Swing: the near side of the screen turns toward the cursor/clicks.
      const p = look();
      yaw -= (p.x - 0.5) * 2 * CAMERA.swingYaw * s;
      pitch -= (p.y - 0.5) * 2 * CAMERA.swingPitch * s;
      swing = true;
    }
  }
  return {
    yaw: clamp(yaw, -CAMERA.maxYaw, CAMERA.maxYaw),
    pitch: clamp(pitch, -CAMERA.maxPitch, CAMERA.maxPitch),
    roll,
    push,
    swing,
  };
}

export type CameraEvaluator = ReturnType<typeof createCamera>;

/**
 * Fixed 60 Hz integration makes seek independent of playback history. `previous` lets an edit reuse
 * the cached states that precede the first changed zoom, because a state only depends on earlier zooms.
 */
export function createCamera(
  project: Project,
  rawEvents: InputEvent[],
  previous?: {
    readonly internals: {
      events: InputEvent[];
      zooms: Zoom[];
      states: State[];
      source: InputEvent[];
      cropKey: string;
      stageKey?: string;
      extentKey?: string;
    };
  },
  /** From viewExtents(project, recording.width, recording.height); contain is { 1, 1 }. */
  extents: { fx: number; fy: number } = { fx: 1, fy: 1 },
) {
  const zooms = [...structuredClone(project.zooms)].sort((a, b) => a.startUs - b.startUs);
  // Camera space is the cropped frame; pointer samples are mapped into it.
  const crop = project.composition.crop,
    cropKey = JSON.stringify(crop),
    stageKey = JSON.stringify(project.stage ?? null),
    extentKey = `${extents.fx}x${extents.fy}`,
    { fx, fy } = extents,
    // Fill pans a narrower view, so it follows the cursor even outside zooms.
    filling = fx < 1 || fy < 1;
  const reuse =
    previous?.internals.source === rawEvents &&
    previous.internals.cropKey === cropKey &&
    previous.internals.stageKey === stageKey &&
    previous.internals.extentKey === extentKey
      ? previous.internals
      : undefined;
  const events =
    reuse?.events ??
    cropEvents(
      normalizeEvents(rawEvents, Number.MAX_SAFE_INTEGER).filter((e) => e.kind !== 'chord'),
      crop,
    );
  const initial: State = {
    x: { value: 0.5, velocity: 0 },
    y: { value: 0.5, velocity: 0 },
    z: { value: 1, velocity: 0 },
    ...restingPose(),
    gx: 0.5,
    gy: 0.5,
    active: null,
  };
  function restingPose() {
    const r = poseTarget(project, undefined, 0, () => ({ x: 0.5, y: 0.5 }));
    return {
      yaw: { value: r.yaw, velocity: 0 },
      pitch: { value: r.pitch, velocity: 0 },
      roll: { value: 0, velocity: 0 },
      push: { value: 0, velocity: 0 },
    };
  }
  let states: State[] = [initial];
  if (reuse) {
    let firstChange = Infinity;
    for (let i = 0; i < Math.max(zooms.length, reuse.zooms.length); i++)
      if (!sameZoom(zooms[i], reuse.zooms[i])) {
        firstChange = Math.min(zooms[i]?.startUs ?? Infinity, reuse.zooms[i]?.startUs ?? Infinity);
        break;
      }
    const keep = Number.isFinite(firstChange)
      ? Math.max(1, Math.ceil((firstChange * CAMERA.rate) / 1_000_000))
      : reuse.states.length;
    states = reuse.states.slice(0, Math.min(keep, reuse.states.length));
  }
  function pointer(atUs: number): Point {
    let low = 0,
      high = events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (events[middle]!.atUs <= atUs) low = middle + 1;
      else high = middle;
    }
    const before = events[low - 1],
      after = events[low];
    if (!before) return { x: 0.5, y: 0.5 };
    if (
      !after ||
      before.kind === 'caret' ||
      after.kind === 'caret' ||
      after.atUs - before.atUs > CAMERA.interpolateGapUs
    )
      return before.point;
    const f = (atUs - before.atUs) / (after.atUs - before.atUs);
    return {
      x: before.point.x + (after.point.x - before.point.x) * f,
      y: before.point.y + (after.point.y - before.point.y) * f,
    };
  }
  let cursor = 0;
  const activeAt = (t: number) => {
    // Stepping is monotonic, so a moving cursor avoids rescanning the zoom list.
    while (cursor < zooms.length && zooms[cursor]!.endUs <= t) cursor++;
    const z = zooms[cursor];
    return z && z.startUs <= t && t < z.endUs ? z : undefined;
  };
  function step(previousState: State, t: number): State {
    const zoom = activeAt(t),
      m = zoom?.magnification ?? 1,
      hx = (0.5 * fx) / m,
      hy = (0.5 * fy) / m,
      dt = 1 / CAMERA.rate;
    let gx = 0.5,
      gy = 0.5;
    if (zoom?.focus.mode === 'fixed') {
      gx = zoom.focus.point.x;
      gy = zoom.focus.point.y;
    } else if (zoom || filling) {
      const look = pointer(t + CAMERA.lookahead * CAMERA.panDecay * Math.sqrt(m) * 1_000_000);
      const offset = zoom?.focus.mode === 'follow-pointer' ? zoom.focus.offset : undefined;
      // The offset places the cursor off-center: view center = cursor − offset × view size.
      const tx = look.x - ((offset?.x ?? 0) * fx) / m,
        ty = look.y - ((offset?.y ?? 0) * fy) / m;
      const active = zoom?.id ?? 'fill';
      if (previousState.active !== active) {
        gx = tx;
        gy = ty;
      } else {
        gx = Math.abs(tx - previousState.gx) > (CAMERA.deadZone * fx) / m ? tx : previousState.gx;
        gy = Math.abs(ty - previousState.gy) > (CAMERA.deadZone * fy) / m ? ty : previousState.gy;
      }
    }
    gx = clamp(gx, hx, 1 - hx);
    gy = clamp(gy, hy, 1 - hy);
    const zoomDecay = m >= previousState.z.value ? CAMERA.zoomInDecay : CAMERA.zoomOutDecay;
    const pose = poseTarget(project, zoom, t, () =>
      zoom?.focus.mode === 'fixed'
        ? zoom.focus.point
        : pointer(t + CAMERA.lookahead * CAMERA.panDecay * Math.sqrt(m) * 1_000_000),
    );
    const turn = (s: Spring, target: number) =>
      spring(
        s,
        target,
        dt,
        pose.swing
          ? CAMERA.swingDecay
          : Math.abs(target) >= Math.abs(s.value)
            ? CAMERA.turnInDecay
            : CAMERA.turnOutDecay,
      );
    return {
      x: spring(previousState.x, gx, dt, CAMERA.panDecay),
      y: spring(previousState.y, gy, dt, CAMERA.panDecay),
      z: spring(previousState.z, m, dt, zoomDecay),
      yaw: turn(previousState.yaw, pose.yaw),
      pitch: turn(previousState.pitch, pose.pitch),
      roll: turn(previousState.roll, pose.roll),
      push: spring(previousState.push, pose.push, dt, CAMERA.pushDecay),
      gx,
      gy,
      active: zoom?.id ?? (filling ? 'fill' : null),
    };
  }
  const maximum = Math.max(project.trim.endUs, ...zooms.map((z) => z.endUs)) + 1_000_000;
  function state(index: number) {
    if (index >= states.length) {
      cursor = 0;
      const startT = (states.length * 1_000_000) / CAMERA.rate;
      while (cursor < zooms.length && zooms[cursor]!.endUs <= startT) cursor++;
      for (let i = states.length; i <= index; i++)
        states.push(step(states[i - 1]!, (i * 1_000_000) / CAMERA.rate));
    }
    return states[index]!;
  }
  return {
    pointer,
    internals: {
      get events() {
        return events;
      },
      zooms,
      get states() {
        return states;
      },
      source: rawEvents,
      cropKey,
      stageKey,
      extentKey,
    },
    /** Sub-frame times interpolate neighbouring states so motion blur and any output rate stay smooth. */
    at(atUs: number): Camera {
      const position =
        (clamp(Number.isFinite(atUs) ? atUs : 0, 0, maximum) * CAMERA.rate) / 1_000_000;
      const index = Math.floor(position),
        f = position - index,
        a = state(index),
        b = f > 1e-9 ? state(index + 1) : a;
      const zoom = clamp(a.z.value + (b.z.value - a.z.value) * f, 1, 4),
        hx = (0.5 * fx) / zoom,
        hy = (0.5 * fy) / zoom,
        mix = (k: 'yaw' | 'pitch' | 'roll' | 'push') => a[k].value + (b[k].value - a[k].value) * f;
      return {
        x: clamp(a.x.value + (b.x.value - a.x.value) * f, hx, 1 - hx),
        y: clamp(a.y.value + (b.y.value - a.y.value) * f, hy, 1 - hy),
        zoom,
        fx,
        fy,
        yaw: mix('yaw'),
        pitch: mix('pitch'),
        roll: mix('roll'),
        push: mix('push'),
      };
    },
  };
}
