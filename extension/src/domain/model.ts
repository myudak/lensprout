import { conflicts, items, overlaps } from './segments';
import { createEditMap } from './edit-map';

export const SCHEMA = 6;
export const ENGINE = 'camera-2';
export const us = (seconds: number) => Math.round(seconds * 1_000_000);
export const seconds = (timeUs: number) => timeUs / 1_000_000;
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export type Point = { x: number; y: number };
/** Normalized rectangle (0–1) in the space named by its field. */
export type Rect = { x: number; y: number; width: number; height: number };
export const FULL_FRAME: Rect = { x: 0, y: 0, width: 1, height: 1 };
export type EventKind =
  'pointer-move' | 'pointer-down' | 'pointer-up' | 'pointer-leave' | 'caret' | 'chord';
export const EVENT_KINDS: EventKind[] = [
  'pointer-move',
  'pointer-down',
  'pointer-up',
  'pointer-leave',
  'caret',
  'chord',
];
/** Cursor shape the page showed at a pointer event (CSS `cursor`, simplified). */
export type CursorStyle = 'arrow' | 'pointer' | 'text' | 'grab' | 'other';
export const CURSOR_STYLES: CursorStyle[] = ['arrow', 'pointer', 'text', 'grab', 'other'];
/**
 * `point` is normalized to the captured frame. `keys` is only present on modifier chords;
 * `cursor` only on pointer events. `pointer-leave` repeats the last point (the pointer left the page).
 */
export type InputEvent = {
  id: string;
  atUs: number;
  kind: EventKind;
  point: Point;
  geometryId: string;
  keys?: string;
  cursor?: CursorStyle;
};
export type Geometry = {
  id: string;
  atUs: number;
  widthCss: number;
  heightCss: number;
  dpr: number;
};
export type Zoom = {
  id: string;
  startUs: number;
  endUs: number;
  magnification: number;
  /**
   * Follow mode may carry `offset`: where the cursor sits inside the zoomed view, as a fraction of
   * the view from its center (−0.4…0.4); absent means centered.
   */
  focus: { mode: 'follow-pointer'; offset?: Point } | { mode: 'fixed'; point: Point };
  provenance: 'manual' | 'generated';
  /** Timeline lane, 0-based. */
  track: number;
  /** 3D camera move while this zoom is active (3D stage only); absent = none. */
  move?: CameraMove;
};
/** How the 3D stage moves during a zoom. Strength scales the angles (0.2–1). */
export type CameraMoveKind = 'none' | 'tilt' | 'orbit' | 'dolly' | 'swing';
export const CAMERA_MOVES: CameraMoveKind[] = ['none', 'tilt', 'orbit', 'dolly', 'swing'];
export type CameraMove = { kind: CameraMoveKind; direction: 'left' | 'right'; strength: number };
export type DeviceKind = 'none' | 'browser' | 'laptop' | 'tablet' | 'phone' | 'monitor';
export const DEVICES: DeviceKind[] = ['none', 'browser', 'laptop', 'tablet', 'phone', 'monitor'];
/**
 * Presentation of the recording as an object in space. Flat with no device renders exactly like
 * schema 4; anything else uses the WebGL stage. Angles are degrees.
 */
export type Stage = {
  mode: 'flat' | '3d';
  device: DeviceKind;
  deviceTheme: 'light' | 'dark';
  /** Resting pose of the 3D stage (ignored in flat mode). */
  tilt: { yaw: number; pitch: number };
  /** 0–1: field of view 15°–45°. */
  perspective: number;
  /** Move given to generated zooms. */
  defaultMove: CameraMove;
};
export type BackgroundMotion = { kind: 'none' | 'drift' | 'aurora' | 'waves'; speed: number };
export const BACKGROUND_MOTIONS: BackgroundMotion['kind'][] = ['none', 'drift', 'aurora', 'waves'];
export type CursorPack = 'classic' | 'glass' | 'pop' | 'ink' | 'sprout';
export const CURSOR_PACKS: CursorPack[] = ['classic', 'glass', 'pop', 'ink', 'sprout'];
type SegmentBase = { id: string; startUs: number; endUs: number; track: number };
/**
 * Non-zoom timeline segments, in logical time. Cut removes the range from the output; speed
 * retimes it; audio scales volume; text and blur are overlays. Blur rects are in cropped-source
 * space (they follow the camera); text positions are in output space.
 */
export type Segment =
  | (SegmentBase & { kind: 'cut' })
  | (SegmentBase & { kind: 'speed'; speed: number })
  | (SegmentBase & { kind: 'audio'; volume: number })
  | (SegmentBase & {
      kind: 'text';
      text: string;
      position: Point;
      /** Font size in pixels at a 1080-pixel short side. */
      size: number;
      color: string;
      style: 'plain' | 'pill' | 'box';
    })
  | (SegmentBase & { kind: 'blur'; rect: Rect; strength: number })
  | (SegmentBase & { kind: 'camera'; layout: CameraLayout });
/** Webcam presentation for a time range (overrides the global webcam style). */
export type CameraLayout =
  'hidden' | 'small' | 'large' | 'fullscreen' | 'pip' | 'side-by-side' | 'stacked';
export const CAMERA_LAYOUTS: CameraLayout[] = [
  'pip',
  'small',
  'large',
  'side-by-side',
  'stacked',
  'fullscreen',
  'hidden',
];
/** Global arrangement of screen and webcam. */
export type WebcamArrangement = 'pip' | 'side-by-side' | 'stacked';
export type SegmentKind = Segment['kind'];
export const SPEEDS = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4, 8];
/** tab: tabCapture of one tab. monitor/window: desktop capture through Chrome's picker. */
export type CaptureSource = 'tab' | 'monitor' | 'window';
export type Recording = {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: string;
  durationUs: number;
  rawDurationUs: number;
  pauses: { startUs: number; endUs: number }[];
  width: number;
  height: number;
  mediaRef: string;
  mimeType: string;
  hasAudio: boolean;
  status: 'capturing' | 'ready' | 'incomplete';
  geometry: Geometry[];
  source: CaptureSource;
  /** False when pointer coordinates could not be mapped into the captured surface. */
  pointerTracked?: boolean;
  /** Screen/window captures: where web-page viewports appeared in the frame (for auto crop). */
  viewports?: { rect: Rect; count: number }[];
  /**
   * Separately recorded webcam. Its raw time = main raw time − offsetUs; both share the pause
   * map because pausing disables both streams together.
   */
  camera?: { mediaRef: string; width: number; height: number; offsetUs: number };
};
export type Aspect = 'native' | '16:9' | '9:16' | '1:1' | '4:3';
export const ASPECTS: { id: Aspect; label: string }[] = [
  { id: 'native', label: 'Native' },
  { id: '16:9', label: 'Wide 16:9' },
  { id: '9:16', label: 'Vertical 9:16' },
  { id: '1:1', label: 'Square 1:1' },
  { id: '4:3', label: 'Classic 4:3' },
];
export type Blur = 'none' | 'light' | 'moderate' | 'strong';
export type Background =
  | { type: 'hidden' }
  | { type: 'color'; color: string }
  | { type: 'gradient'; preset: string }
  | { type: 'image'; preset: string; blur: Blur }
  | { type: 'custom'; mediaRef: string; blur: Blur }
  /** An image from the local wallpaper pack (public path wallpapers/<id>.webp, local builds only). */
  | { type: 'wallpaper'; id: string; blur: Blur };
export type Composition = {
  aspect: Aspect;
  background: Background;
  /** Fraction of the output's short side. */
  padding: number;
  /** Corner radius in pixels at a 1080-pixel short side. */
  radius: number;
  shadow: boolean;
  /** Part of the source frame that is used, normalized to the recording. */
  crop: Rect;
  /** Animated background (stage path). */
  backgroundMotion: BackgroundMotion;
  /**
   * contain: the whole cropped source sits inside the output (padding, frame styling).
   * fill: the view takes the output's aspect inside the source and follows the cursor, so a 9:16
   * output shows a moving column instead of a letterboxed screen.
   */
  fit: 'contain' | 'fill';
};
export type ClickStyle = 'none' | 'orb' | 'ring';
export type Force = 'weak' | 'moderate' | 'strong';
export type Effects = {
  click: { style: ClickStyle; force: Force; color: string };
  motionBlur: boolean;
  keystrokes: boolean;
  /** Synthesized click and keyboard sounds mixed into the export (and played in preview). */
  sounds: { clicks: boolean; keys: boolean; volume: number };
};
export type WebcamStyle = {
  shape: 'circle' | 'rounded' | 'square';
  corner: 'tl' | 'tr' | 'bl' | 'br';
  /** Fraction of the output's short side. */
  size: number;
  /** Fraction of the output's short side. */
  margin: number;
  mirror: boolean;
  shadow: boolean;
  border: boolean;
  /** Picture in picture, or screen and camera sharing the frame. */
  layout: WebcamArrangement;
  /** Camera share of the frame in side-by-side/stacked (0.25–0.5). */
  split: number;
};
/**
 * Chrome draws the real cursor into captured frames, so these never replace it: the overlay is a
 * larger cursor drawn exactly on top of it, the highlight sits around it.
 */
export type CursorSettings = {
  overlay: {
    enabled: boolean;
    size: number;
    style: 'auto' | 'arrow';
    shadow: boolean;
    color: string;
    pack: CursorPack;
  };
  highlight: {
    style: 'none' | 'ring' | 'halo' | 'spotlight';
    color: string;
    size: number;
    opacity: number;
  };
};
export const QUALITIES = [720, 1080, 1440, 2160] as const;
export type OutputSettings = { quality: (typeof QUALITIES)[number]; fps: 30 | 60 };
export type Project = {
  id: string;
  schemaVersion: number;
  engineVersion: string;
  revision: number;
  recordingId: string;
  name: string;
  trim: { startUs: number; endUs: number };
  zooms: Zoom[];
  segments: Segment[];
  composition: Composition;
  effects: Effects;
  output: OutputSettings;
  autoZoom: { depth: number; typing: boolean; offset: Point };
  webcam: WebcamStyle;
  cursor: CursorSettings;
  stage: Stage;
};
export type CaptureMode = 'tab' | 'screen';
export type Session = {
  id: string;
  /** Present when the action was invoked on an HTTP/HTTPS tab. */
  sourceTabId?: number;
  sourceWindowId?: number;
  /** The tab the action was invoked on, so screen recordings can return to it. */
  returnTabId?: number;
  recorderTabId: number;
  sourceTitle: string;
  status: 'ready' | 'countdown' | 'recording' | 'paused';
  mode?: CaptureMode;
  /** Tabs that received the collector, so they can be stopped. */
  injected?: number[];
};
export type MeasuredEvent = {
  kind: EventKind;
  epochMs: number;
  /** Client (viewport) CSS pixels of the reporting frame. */
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
  /** Screen DIP coordinates; null when the frame cannot derive them (caret before any pointer). */
  screenX: number | null;
  screenY: number | null;
  win: { x: number; y: number; width: number; height: number };
  top: boolean;
  keys?: string;
  cursor?: CursorStyle;
};
export type Message =
  | { type: 'capture'; sessionId: string; audio: boolean; mode: CaptureMode }
  | { type: 'session-state'; sessionId: string; status: Session['status'] }
  | { type: 'end-session'; sessionId: string }
  | { type: 'collector-event'; sessionId: string; event: MeasuredEvent }
  | { type: 'input'; sessionId: string; event: MeasuredEvent; windowId?: number; tabId?: number }
  | { type: 'collector-start'; sessionId: string; mode: CaptureMode }
  | { type: 'collector-stop' }
  | { type: 'control'; command: 'stop' | 'pause' | 'resume' | 'cancel'; sessionId: string }
  | { type: 'countdown'; sessionId: string; seconds: number }
  | { type: 'countdown-tick'; seconds: number }
  | { type: 'countdown-cancel' };

export const DEFAULT_DEPTH = 1.8;
export const DEPTH_PRESETS = [
  { id: 'shallow', label: 'Shallow', value: 1.4 },
  { id: 'default', label: 'Default', value: DEFAULT_DEPTH },
  { id: 'deep', label: 'Deep', value: 2.3 },
  { id: 'max', label: 'Maximum', value: 3 },
];
export function defaultComposition(): Composition {
  return {
    aspect: 'native',
    background: { type: 'image', preset: 'meadow', blur: 'moderate' },
    padding: 0.06,
    radius: 14,
    shadow: true,
    crop: { ...FULL_FRAME },
    backgroundMotion: { kind: 'none', speed: 1 },
    fit: 'contain',
  };
}
export function defaultEffects(): Effects {
  return {
    click: { style: 'orb', force: 'moderate', color: '#ff4d4d' },
    motionBlur: true,
    keystrokes: true,
    sounds: { clicks: false, keys: false, volume: 0.6 },
  };
}
export function defaultWebcam(): WebcamStyle {
  return {
    shape: 'circle',
    corner: 'br',
    size: 0.26,
    margin: 0.04,
    mirror: true,
    shadow: true,
    border: true,
    layout: 'pip',
    split: 0.4,
  };
}
export const NO_MOVE: CameraMove = { kind: 'none', direction: 'left', strength: 0.6 };
export function defaultStage(): Stage {
  return {
    mode: 'flat',
    device: 'none',
    deviceTheme: 'dark',
    tilt: { yaw: 0, pitch: 0 },
    perspective: 0.5,
    defaultMove: { ...NO_MOVE },
  };
}
export function defaultCursor(): CursorSettings {
  return {
    overlay: {
      enabled: false,
      size: 1.6,
      style: 'auto',
      shadow: true,
      color: '#111827',
      pack: 'classic',
    },
    highlight: { style: 'none', color: '#facc15', size: 1, opacity: 0.45 },
  };
}
export function makeProject(recording: Recording, zooms: Zoom[] = []): Project {
  return {
    id: recording.id,
    schemaVersion: SCHEMA,
    engineVersion: ENGINE,
    revision: 0,
    recordingId: recording.id,
    name: recording.name,
    trim: { startUs: 0, endUs: recording.durationUs },
    zooms,
    segments: [],
    composition: defaultComposition(),
    effects: defaultEffects(),
    output: { quality: 1080, fps: 60 },
    autoZoom: { depth: DEFAULT_DEPTH, typing: true, offset: { x: 0, y: 0 } },
    webcam: defaultWebcam(),
    cursor: defaultCursor(),
    stage: defaultStage(),
  };
}

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const point = (p: Point) =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const hex = (c: unknown) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const BLURS: Blur[] = ['none', 'light', 'moderate', 'strong'];
export const rectValid = (r: Rect, minimum = 0) =>
  !!r &&
  [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
  r.x >= 0 &&
  r.y >= 0 &&
  r.width >= minimum &&
  r.height >= minimum &&
  r.width > 0 &&
  r.height > 0 &&
  r.x + r.width <= 1 + 1e-9 &&
  r.y + r.height <= 1 + 1e-9;
const track = (n: number) => Number.isInteger(n) && n >= 0 && n < 32;
export const OFFSET_LIMIT = 0.4;
const offsetValid = (p: Point) =>
  !!p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  Math.abs(p.x) <= OFFSET_LIMIT &&
  Math.abs(p.y) <= OFFSET_LIMIT;
const within = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
export const TILT_LIMIT = 25;
const moveValid = (m: CameraMove) =>
  !!m &&
  CAMERA_MOVES.includes(m.kind) &&
  (m.direction === 'left' || m.direction === 'right') &&
  within(m.strength, 0.2, 1);

function validateSegment(s: Segment, durationUs: number) {
  assert(
    s && typeof s.id === 'string' && time(s.startUs) && time(s.endUs) && s.startUs < s.endUs,
    'Invalid segment range.',
  );
  assert(s.endUs <= durationUs && track(s.track), 'Invalid segment range.');
  switch (s.kind) {
    case 'cut':
      return;
    case 'speed':
      return assert(SPEEDS.includes(s.speed), 'Invalid speed.');
    case 'audio':
      return assert(Number.isFinite(s.volume) && s.volume >= 0 && s.volume <= 1, 'Invalid volume.');
    case 'text':
      return assert(
        typeof s.text === 'string' &&
          s.text.length <= 200 &&
          point(s.position) &&
          Number.isFinite(s.size) &&
          s.size >= 12 &&
          s.size <= 200 &&
          hex(s.color) &&
          ['plain', 'pill', 'box'].includes(s.style),
        'Invalid text segment.',
      );
    case 'blur':
      return assert(
        rectValid(s.rect, 0.01) &&
          Number.isFinite(s.strength) &&
          s.strength >= 2 &&
          s.strength <= 60,
        'Invalid blur segment.',
      );
    case 'camera':
      return assert(CAMERA_LAYOUTS.includes(s.layout), 'Invalid camera segment.');
    default:
      throw new Error('Invalid segment type.');
  }
}

function validateBackground(b: Background) {
  assert(b && typeof b === 'object', 'Invalid background.');
  switch (b.type) {
    case 'hidden':
      return;
    case 'color':
      return assert(hex(b.color), 'Invalid background color.');
    case 'gradient':
      return assert(typeof b.preset === 'string' && b.preset.length < 40, 'Invalid gradient.');
    case 'image':
      return assert(
        typeof b.preset === 'string' && b.preset.length < 40 && BLURS.includes(b.blur),
        'Invalid background image.',
      );
    case 'custom':
      return assert(
        typeof b.mediaRef === 'string' &&
          /^background-[a-f0-9-]+$/.test(b.mediaRef) &&
          BLURS.includes(b.blur),
        'Invalid custom background.',
      );
    case 'wallpaper':
      return assert(
        typeof b.id === 'string' && /^[a-z0-9-]{1,40}$/.test(b.id) && BLURS.includes(b.blur),
        'Invalid wallpaper background.',
      );
    default:
      throw new Error('Invalid background type.');
  }
}

export function validateProject(project: Project, recording: Recording): void {
  assert(
    project && recording && typeof project === 'object' && typeof recording === 'object',
    'Invalid project or recording.',
  );
  assert(
    time(recording.rawDurationUs) && Array.isArray(recording.pauses),
    'Invalid source time map.',
  );
  let previousPause = 0;
  for (const p of recording.pauses) {
    assert(
      time(p.startUs) &&
        time(p.endUs) &&
        p.startUs >= previousPause &&
        p.startUs < p.endUs &&
        p.endUs <= recording.rawDurationUs,
      'Invalid pause map.',
    );
    previousPause = p.endUs;
  }
  assert(
    typeof project.id === 'string' &&
      typeof project.name === 'string' &&
      project.name.length <= 200 &&
      time(project.revision),
    'Invalid project identity.',
  );
  assert(
    project.schemaVersion === SCHEMA && recording.schemaVersion === SCHEMA,
    'Unsupported project version.',
  );
  assert(project.engineVersion === ENGINE, 'Unsupported camera engine version.');
  assert(project.recordingId === recording.id, 'Recording does not match this project.');
  assert(
    project.trim &&
      time(recording.durationUs) &&
      time(project.trim.startUs) &&
      time(project.trim.endUs) &&
      project.trim.startUs < project.trim.endUs &&
      project.trim.endUs <= recording.durationUs,
    'Invalid trim range.',
  );
  const c = project.composition;
  assert(c && ASPECTS.some((a) => a.id === c.aspect), 'Invalid aspect ratio.');
  validateBackground(c.background);
  assert(Number.isFinite(c.padding) && c.padding >= 0 && c.padding <= 0.3, 'Invalid padding.');
  assert(Number.isFinite(c.radius) && c.radius >= 0 && c.radius <= 80, 'Invalid corner radius.');
  assert(typeof c.shadow === 'boolean', 'Invalid shadow setting.');
  assert(rectValid(c.crop, 0.1), 'Invalid crop.');
  assert(
    c.backgroundMotion &&
      BACKGROUND_MOTIONS.includes(c.backgroundMotion.kind) &&
      within(c.backgroundMotion.speed, 0.25, 2),
    'Invalid background motion.',
  );
  assert(c.fit === 'contain' || c.fit === 'fill', 'Invalid fit.');
  const fx = project.effects;
  assert(
    fx &&
      ['none', 'orb', 'ring'].includes(fx.click?.style) &&
      ['weak', 'moderate', 'strong'].includes(fx.click?.force) &&
      hex(fx.click?.color) &&
      typeof fx.motionBlur === 'boolean' &&
      typeof fx.keystrokes === 'boolean' &&
      typeof fx.sounds?.clicks === 'boolean' &&
      typeof fx.sounds?.keys === 'boolean' &&
      within(fx.sounds?.volume, 0, 1),
    'Invalid effects.',
  );
  assert(
    project.output &&
      (QUALITIES as readonly number[]).includes(project.output.quality) &&
      (project.output.fps === 30 || project.output.fps === 60),
    'Invalid output settings.',
  );
  assert(
    project.autoZoom &&
      Number.isFinite(project.autoZoom.depth) &&
      project.autoZoom.depth >= 1 &&
      project.autoZoom.depth <= 4 &&
      typeof project.autoZoom.typing === 'boolean' &&
      offsetValid(project.autoZoom.offset),
    'Invalid auto zoom settings.',
  );
  const w = project.webcam;
  assert(
    w &&
      ['circle', 'rounded', 'square'].includes(w.shape) &&
      ['tl', 'tr', 'bl', 'br'].includes(w.corner) &&
      within(w.size, 0.1, 0.6) &&
      within(w.margin, 0, 0.15) &&
      [w.mirror, w.shadow, w.border].every((b) => typeof b === 'boolean') &&
      ['pip', 'side-by-side', 'stacked'].includes(w.layout) &&
      within(w.split, 0.25, 0.5),
    'Invalid webcam settings.',
  );
  const cur = project.cursor;
  assert(
    cur?.overlay &&
      cur.highlight &&
      typeof cur.overlay.enabled === 'boolean' &&
      within(cur.overlay.size, 1, 4) &&
      ['auto', 'arrow'].includes(cur.overlay.style) &&
      typeof cur.overlay.shadow === 'boolean' &&
      hex(cur.overlay.color) &&
      CURSOR_PACKS.includes(cur.overlay.pack) &&
      ['none', 'ring', 'halo', 'spotlight'].includes(cur.highlight.style) &&
      hex(cur.highlight.color) &&
      within(cur.highlight.size, 0.5, 3) &&
      within(cur.highlight.opacity, 0, 1),
    'Invalid cursor settings.',
  );
  const st = project.stage;
  assert(
    st &&
      (st.mode === 'flat' || st.mode === '3d') &&
      DEVICES.includes(st.device) &&
      (st.deviceTheme === 'light' || st.deviceTheme === 'dark') &&
      within(st.tilt?.yaw, -TILT_LIMIT, TILT_LIMIT) &&
      within(st.tilt?.pitch, -TILT_LIMIT, TILT_LIMIT) &&
      within(st.perspective, 0, 1) &&
      moveValid(st.defaultMove),
    'Invalid stage settings.',
  );
  assert(
    !project.segments?.some((s) => s?.kind === 'camera') || !!recording.camera,
    'Camera segments need a recording with a webcam.',
  );
  assert(Array.isArray(project.zooms), 'Invalid zoom list.');
  let lastEnd = 0;
  const ids = new Set<string>();
  for (const z of [...project.zooms].sort((a, b) => a.startUs - b.startUs)) {
    assert(z && typeof z.id === 'string' && !ids.has(z.id), 'Invalid or duplicate zoom ID.');
    ids.add(z.id);
    assert(
      time(z.startUs) && time(z.endUs) && z.startUs < z.endUs && z.endUs <= recording.durationUs,
      'Invalid zoom range.',
    );
    assert(z.startUs >= lastEnd, 'Zoom periods cannot overlap.');
    lastEnd = z.endUs;
    assert(
      Number.isFinite(z.magnification) && z.magnification >= 1 && z.magnification <= 4,
      'Zoom depth must be between 1 and 4.',
    );
    assert(
      (z.focus?.mode === 'follow-pointer' &&
        (z.focus.offset === undefined || offsetValid(z.focus.offset))) ||
        (z.focus?.mode === 'fixed' && point(z.focus.point)),
      'Invalid focus point.',
    );
    assert(z.provenance === 'manual' || z.provenance === 'generated', 'Invalid segment origin.');
    assert(z.move === undefined || moveValid(z.move), 'Invalid camera move.');
    assert(track(z.track), 'Invalid zoom track.');
  }
  assert(Array.isArray(project.segments), 'Invalid segment list.');
  for (const s of project.segments) {
    assert(!ids.has(s?.id), 'Invalid or duplicate segment ID.');
    ids.add(s.id);
    validateSegment(s, recording.durationUs);
  }
  // Same track never overlaps; zoom/speed/audio never overlap their own kind on any track.
  const all = items(project).sort((a, b) => a.startUs - b.startUs);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length && all[j]!.startUs < all[i]!.endUs; j++)
      assert(
        !(conflicts(all[i]!, all[j]!) && overlaps(all[i]!, all[j]!)),
        'Segments on the same track (or of the same exclusive type) cannot overlap.',
      );
  assert(
    createEditMap(project).durationUs >= 100_000,
    'Cuts leave less than 0.1 seconds of video.',
  );
}

export function normalizeEvents(events: InputEvent[], durationUs: number): InputEvent[] {
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const valid =
        e &&
        time(e.atUs) &&
        e.atUs <= durationUs &&
        point(e.point) &&
        !seen.has(e.id) &&
        EVENT_KINDS.includes(e.kind) &&
        (e.kind !== 'chord' || (typeof e.keys === 'string' && e.keys.length <= 60)) &&
        (e.cursor === undefined || CURSOR_STYLES.includes(e.cursor));
      if (valid) seen.add(e.id);
      return valid;
    })
    .sort((a, b) => a.atUs - b.atUs);
}
