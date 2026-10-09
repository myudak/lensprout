import { describe, expect, test } from 'vitest';
import { SessionClock } from '../../src/capture/clock';
import {
  makeProject,
  us,
  validateProject,
  normalizeEvents,
  type InputEvent,
  type Recording,
  type Zoom,
} from '../../src/domain/model';
import { planZooms, regenerateZooms } from '../../src/engine/planner';
import { createCamera, CAMERA } from '../../src/engine/camera';
import { frameRect, motionSamples, outputSize } from '../../src/engine/render';
import { createOverlays } from '../../src/engine/effects';
import { addZoom, moveZooms, resizeZoom, setTrim, splitZoom } from '../../src/domain/commands';
import { migrateProject, migrateRecording } from '../../src/domain/migrate';
import { mapEvent, pickDisplay, viewportRect } from '../../src/capture/mapping';
import { createCursorTrack } from '../../src/engine/cursor';
import { compositionLayout, webcamLayout } from '../../src/engine/webcam';
import {
  buildDevice,
  deviceLayout,
  needsStage,
  placeDevice,
  projectPoint,
  restScale,
  shade,
} from '../../src/engine/stage';
import type { Background, CameraMove, Project } from '../../src/domain/model';
import {
  addSegment,
  duplicateItem,
  moveItems,
  removeItems,
  settleTracks,
  splitItem,
} from '../../src/domain/commands';
import { createEditMap } from '../../src/domain/edit-map';
import { cropEvents } from '../../src/domain/crop';
import type { Segment } from '../../src/domain/model';
import type { MeasuredEvent } from '../../src/domain/model';

const recording: Recording = {
  id: 'fixture',
  schemaVersion: 6,
  name: 'Fixture',
  createdAt: '2026-10-09T00:00:00Z',
  durationUs: us(15),
  rawDurationUs: us(15),
  pauses: [],
  width: 1280,
  height: 720,
  mediaRef: 'fixture.webm',
  mimeType: 'video/webm',
  hasAudio: true,
  status: 'ready',
  geometry: [{ id: 'g', atUs: 0, widthCss: 1280, heightCss: 720, dpr: 1 }],
  source: 'tab',
};
const event = (t: number, kind: InputEvent['kind'], x = 0.3, y = 0.4): InputEvent => ({
  id: `${kind}:${t}`,
  atUs: us(t),
  kind,
  point: { x, y },
  geometryId: 'g',
});
const click = (t: number, x = 0.3, y = 0.4) => [
  event(t, 'pointer-down', x, y),
  event(t + 0.1, 'pointer-up', x, y),
];
const zoom = (startS: number, endS: number, extra: Partial<Zoom> = {}): Zoom => ({
  id: `z${startS}`,
  startUs: us(startS),
  endUs: us(endS),
  magnification: 2,
  focus: { mode: 'follow-pointer' },
  provenance: 'manual',
  track: 0,
  ...extra,
});

describe('recording clock', () => {
  test('removes multiple pause intervals and rejects paused/stale timestamps', () => {
    const clock = new SessionClock(1000);
    expect(clock.at(999)).toBeNull();
    expect(clock.at(1250)).toBe(us(0.25));
    clock.pause(1500);
    expect(clock.at(1700)).toBeNull();
    expect(clock.elapsed(3000)).toBe(us(0.5));
    clock.resume(2500);
    expect(clock.at(1500)).toBeNull();
    expect(clock.at(1800)).toBeNull();
    expect(clock.at(1400)).toBe(us(0.4));
    expect(clock.at(2600)).toBe(us(0.6));
    clock.pause(3000);
    clock.resume(3500);
    expect(clock.at(3700)).toBe(us(1.2));
    expect(clock.at(NaN)).toBeNull();
  });
});

describe('automatic zoom planner', () => {
  test('groups a click cluster with anticipation/release padding and stable identity', () => {
    const events = [...click(2), ...click(3)];
    const zooms = planZooms(events, us(15));
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).toMatchObject({ startUs: us(1.5), endUs: us(3.2), id: 'auto:pointer-down:2' });
    expect(planZooms(events.toReversed(), us(15))).toEqual(zooms);
    validateProject(makeProject(recording, zooms), recording);
  });
  test('suppresses an isolated short click; keeps long drag; suppresses end-of-recording start', () => {
    expect(planZooms(click(2), us(15))).toHaveLength(0);
    expect(planZooms([event(2, 'pointer-down'), event(5, 'pointer-up')], us(15))).toHaveLength(1);
    expect(planZooms([...click(14.7), ...click(14.85)], us(15))).toHaveLength(0);
  });
  test('separates distant clusters after a meaningful gap, measured against the surface diagonal', () => {
    const zooms = planZooms(
      [
        ...click(1, 0.1, 0.1),
        ...click(1.5, 0.1, 0.1),
        ...click(4, 0.9, 0.9),
        ...click(4.5, 0.9, 0.9),
      ],
      us(15),
      { geometry: recording.geometry },
    );
    expect(zooms).toHaveLength(2);
    expect(zooms[0]!.endUs).toBeLessThan(zooms[1]!.startUs);
    // 0.45 horizontal on a wide frame is under half the diagonal, so these merge.
    const near = planZooms(
      [
        ...click(1, 0.1, 0.5),
        ...click(1.5, 0.1, 0.5),
        ...click(4, 0.55, 0.5),
        ...click(4.5, 0.55, 0.5),
      ],
      us(15),
      { geometry: recording.geometry },
    );
    expect(near).toHaveLength(1);
  });
  test('typing periods become zooms; brief typing alone does not; typing can be disabled', () => {
    const typing = Array.from({ length: 12 }, (_, i) => event(3 + i * 0.25, 'caret', 0.5, 0.6));
    const zooms = planZooms(typing, us(15));
    expect(zooms).toHaveLength(1);
    expect(zooms[0]!.startUs).toBe(us(2.5));
    expect(zooms[0]!.endUs).toBe(us(3 + 11 * 0.25 + 0.6 + 0.1));
    expect(planZooms(typing.slice(0, 3), us(15))).toHaveLength(0);
    expect(planZooms(typing, us(15), { typing: false })).toHaveLength(0);
    // A click just before typing merges with it.
    expect(planZooms([...click(2.2), ...typing.slice(0, 3)], us(15))).toHaveLength(1);
  });
  test('regeneration preserves manual edits and discards generated overlaps', () => {
    const manual = {
      ...planZooms([...click(2), ...click(3)], us(15))[0]!,
      provenance: 'manual' as const,
      magnification: 2.3,
    };
    expect(regenerateZooms([manual], [...click(2), ...click(3)], us(15))).toEqual([manual]);
  });
  test('rejects invalid events, duplicate IDs and chords without keys', () => {
    const good = event(1, 'pointer-move');
    expect(
      normalizeEvents(
        [good, good, event(-1, 'pointer-down'), event(3, 'pointer-up', NaN), event(4, 'chord')],
        us(15),
      ),
    ).toEqual([good]);
  });
});

describe('camera', () => {
  const moving = [event(2, 'pointer-move', 0, 1), event(4, 'pointer-move', 1, 0)];
  test('random/backward seeks equal linear playback and stay within frame', () => {
    const project = makeProject(recording, [zoom(1, 6, { magnification: 3 })]);
    const linear = createCamera(project, moving),
      seek = createCamera(project, moving);
    expect(seek.pointer(0)).toEqual({ x: 0.5, y: 0.5 });
    for (let i = 0; i <= 15 * 60; i++) linear.at(us(i / 60));
    for (const t of [5.123, 1.2, 9.4, 3, 0, 15]) {
      const c = seek.at(us(t));
      expect(c).toEqual(linear.at(us(t)));
      expect(c.x - 0.5 / c.zoom).toBeGreaterThanOrEqual(-1e-12);
      expect(c.y + 0.5 / c.zoom).toBeLessThanOrEqual(1 + 1e-12);
    }
    expect(seek.at(us(15)).zoom).toBe(1);
  });
  test('dead zone holds the camera while the pointer stays near the held center', () => {
    const jitter = Array.from({ length: 60 }, (_, i) =>
      event(1 + i * 0.05, 'pointer-move', 0.5 + (i % 2 ? 0.04 : -0.04), 0.5),
    );
    const cam = createCamera(makeProject(recording, [zoom(0.5, 5)]), jitter);
    const xs = Array.from({ length: 60 }, (_, i) => cam.at(us(2 + i / 30)).x);
    // ±0.04 jitter is inside the 0.33/2 dead zone, so the camera settles instead of shaking.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.002);
    const far = createCamera(makeProject(recording, [zoom(0.5, 5)]), [
      event(1, 'pointer-move', 0.3, 0.5),
      event(2, 'pointer-move', 0.75, 0.5),
    ]);
    expect(far.at(us(1.8)).x).toBeLessThan(far.at(us(3)).x);
    expect(far.at(us(3)).x).toBeCloseTo(0.75, 2);
  });
  test('interpolated sub-frame times and zoom-in smoothness', () => {
    const cam = createCamera(makeProject(recording, [zoom(1, 5)]), moving);
    const a = cam.at(us(1 + 10 / 60)),
      b = cam.at(us(1 + 11 / 60)),
      mid = cam.at(us(1 + 10.5 / 60));
    expect(mid.zoom).toBeCloseTo((a.zoom + b.zoom) / 2, 9);
    // No step larger than ~6% of the zoom range between 60 Hz frames.
    let largest = 0;
    for (let i = 55; i < 120; i++)
      largest = Math.max(largest, cam.at(us((i + 1) / 60)).zoom - cam.at(us(i / 60)).zoom);
    expect(largest).toBeLessThan(0.07);
    expect(CAMERA.zoomInDecay).toBeGreaterThan(0.1);
  });
  test('reusing a previous evaluator matches a fresh one after an edit', () => {
    const base = makeProject(recording, [zoom(1, 3), zoom(6, 9)]);
    const first = createCamera(base, moving);
    for (let i = 0; i < 15 * 60; i++) first.at(us(i / 60));
    const edited = { ...base, zooms: [base.zooms[0]!, { ...base.zooms[1]!, magnification: 3 }] };
    const reused = createCamera(edited, moving, first),
      fresh = createCamera(edited, moving);
    expect(reused.internals.states.length).toBeLessThan(first.internals.states.length);
    expect(reused.internals.states.length).toBeGreaterThan(5 * 60);
    for (const t of [0.5, 2, 6.5, 8, 12]) expect(reused.at(us(t))).toEqual(fresh.at(us(t)));
  });
  test('motion blur samples only while the camera moves', () => {
    const cam = createCamera(makeProject(recording, [zoom(1, 5)]), moving);
    expect(motionSamples(cam, us(0.5), 60, true)).toHaveLength(1);
    expect(motionSamples(cam, us(1.1), 60, true).length).toBeGreaterThan(1);
    expect(motionSamples(cam, us(1.1), 60, false)).toHaveLength(1);
  });
});

describe('commands', () => {
  test('manual resize clamps between neighbors; overlapping edits fail validation', () => {
    let project = addZoom(makeProject(recording), us(2));
    project = addZoom(project, us(7));
    const z = project.zooms[0]!;
    expect(z.magnification).toBe(project.autoZoom.depth);
    project = resizeZoom(project, z.id, 'end', us(10), recording.durationUs);
    expect(project.zooms[0]!.endUs).toBe(us(7));
    validateProject(project, recording);
    expect(() => addZoom(project, us(3))).toThrow(/existing zoom/);
    const invalid = structuredClone(project);
    invalid.zooms[0]!.endUs = us(8);
    expect(() => validateProject(invalid, recording)).toThrow(/overlap/);
  });
  test('move clamps against unselected neighbours; group moves keep spacing', () => {
    const p = makeProject(recording, [zoom(1, 2), zoom(4, 5), zoom(8, 9)]);
    const moved = moveZooms(p, ['z4'], us(10), recording.durationUs);
    expect(moved.zooms[1]).toMatchObject({ startUs: us(7), endUs: us(8) });
    const back = moveZooms(p, ['z4', 'z8'], -us(10), recording.durationUs);
    expect(back.zooms.map((z) => z.startUs)).toEqual([us(1), us(2), us(6)]);
    validateProject(back, recording);
  });
  test('split keeps both halves and rejects edges; trim keeps a minimum length', () => {
    const p = makeProject(recording, [zoom(1, 3)]);
    const s = splitZoom(p, 'z1', us(2));
    expect(s.zooms.map((z) => [z.startUs, z.endUs])).toEqual([
      [us(1), us(2)],
      [us(2), us(3)],
    ]);
    expect(() => splitZoom(p, 'z1', us(1.05))).toThrow();
    const t = setTrim(p, 'start', us(20), recording.durationUs);
    expect(t.trim.endUs - t.trim.startUs).toBe(us(0.5));
  });
  test('unknown version, nonfinite depth, invalid trim and background are rejected', () => {
    const project = makeProject(recording);
    expect(() => validateProject({ ...project, schemaVersion: 99 }, recording)).toThrow(/version/);
    expect(() =>
      validateProject({ ...project, trim: { startUs: us(10), endUs: us(2) } }, recording),
    ).toThrow(/trim/);
    const withZoom = addZoom(project, us(1));
    withZoom.zooms[0]!.magnification = NaN;
    expect(() => validateProject(withZoom, recording)).toThrow(/depth/);
    expect(() =>
      validateProject(
        {
          ...project,
          composition: { ...project.composition, background: { type: 'color', color: 'red' } },
        },
        recording,
      ),
    ).toThrow(/color/);
    expect(() =>
      validateProject(
        {
          ...project,
          composition: {
            ...project.composition,
            background: { type: 'custom', mediaRef: '../x', blur: 'none' },
          },
        },
        recording,
      ),
    ).toThrow(/custom/);
    const withBackground = (background: Background) => ({
      ...project,
      composition: { ...project.composition, background },
    });
    expect(() =>
      validateProject(
        withBackground({ type: 'wallpaper', id: 'big-sur-light', blur: 'none' }),
        recording,
      ),
    ).not.toThrow();
    expect(() =>
      validateProject(withBackground({ type: 'wallpaper', id: '../x', blur: 'none' }), recording),
    ).toThrow(/wallpaper/);
  });
});

describe('layout and overlays', () => {
  test('output size follows aspect and quality; frame contains the source with padding', () => {
    const project = makeProject(recording);
    expect(outputSize(project, recording)).toEqual({ width: 1920, height: 1080 });
    expect(
      outputSize(
        { ...project, composition: { ...project.composition, aspect: '9:16' } },
        recording,
      ),
    ).toEqual({ width: 1080, height: 1920 });
    expect(
      outputSize(
        {
          ...project,
          output: { quality: 2160, fps: 60 },
          composition: { ...project.composition, aspect: '9:16' },
        },
        recording,
      ),
    ).toEqual({ width: 2160, height: 3840 });
    const fit = frameRect(project, 1280, 720, 1920, 1080);
    expect(fit.y).toBeCloseTo(1080 * 0.06, 6);
    expect(fit.width / fit.height).toBeCloseTo(16 / 9, 9);
    const hidden = frameRect(
      { composition: { ...project.composition, background: { type: 'hidden' } } },
      1280,
      720,
      1920,
      1080,
    );
    expect(hidden).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      radius: 0,
      shadow: false,
    });
  });
  test('clicks and chords are found within their display windows', () => {
    const o = createOverlays([
      ...click(2),
      { ...event(5, 'chord'), keys: 'Ctrl+S' },
      { ...event(6, 'pointer-move') },
    ]);
    expect(o.clicks(us(2.2))).toHaveLength(1);
    expect(o.clicks(us(3))).toHaveLength(0);
    expect(o.chord(us(5.5))?.keys).toBe('Ctrl+S');
    expect(o.chord(us(7))).toBeUndefined();
  });
});

describe('schema migration', () => {
  test('schema 1 projects keep their look and validate as schema 5', () => {
    const v1Recording = { ...recording, schemaVersion: 1 } as unknown as Recording;
    const r = migrateRecording(v1Recording);
    expect(r).toMatchObject({ schemaVersion: 6, source: 'tab' });
    const { segments: _segments, ...base } = makeProject(r);
    const { track: _track, ...oldZoom } = zoom(1, 2);
    const v1 = {
      ...base,
      zooms: [oldZoom],
      schemaVersion: 1,
      engineVersion: 'camera-1',
      composition: { width: 1280, height: 720, paddingPx: 48, background: '#233c36' },
    } as unknown as Parameters<typeof migrateProject>[0];
    const p = migrateProject(v1);
    validateProject(p, r);
    expect(p.composition).toMatchObject({
      aspect: '16:9',
      background: { type: 'color', color: '#233c36' },
    });
    expect(p.composition.padding).toBeCloseTo(48 / 720, 9);
    expect(p.output).toEqual({ quality: 720, fps: 30 });
    expect(p.effects.click.style).toBe('none');
    expect(p.zooms[0]!.track).toBe(0);
    expect(p.segments).toEqual([]);
    expect(p.composition.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    // Schema 4 additions default to "no visual change".
    expect(p.cursor.overlay.enabled).toBe(false);
    expect(p.cursor.highlight.style).toBe('none');
    expect(p.autoZoom.offset).toEqual({ x: 0, y: 0 });
    expect(p.webcam.shape).toBe('circle');
    // Schema 5 additions are flat, still and classic.
    expect(p.stage).toMatchObject({ mode: 'flat', device: 'none' });
    expect(p.composition.backgroundMotion.kind).toBe('none');
    expect(p.cursor.overlay.pack).toBe('classic');
    expect(p.webcam.layout).toBe('pip');
    // Schema 6: contain and silent.
    expect(p.composition.fit).toBe('contain');
    expect(p.effects.sounds).toEqual({ clicks: false, keys: false, volume: 0.6 });
  });
});

const seg = (kind: Segment['kind'], startS: number, endS: number, extra: object = {}): Segment =>
  ({
    id: `${kind}${startS}`,
    kind,
    startUs: us(startS),
    endUs: us(endS),
    track: 1,
    ...(kind === 'speed' ? { speed: 2 } : {}),
    ...(kind === 'audio' ? { volume: 0.5 } : {}),
    ...extra,
  }) as Segment;

describe('segments and the edit map', () => {
  test('cuts are removed and speed retimes output time', () => {
    const p = { ...makeProject(recording), segments: [seg('cut', 2, 4), seg('speed', 6, 10)] };
    validateProject(p, recording);
    const m = createEditMap(p);
    // 15 s − 2 s cut − 2 s saved by 2× over 4 s = 11 s.
    expect(m.durationUs).toBe(us(11));
    expect(m.toOutput(us(1))).toBe(us(1));
    expect(m.toOutput(us(3))).toBe(us(2));
    expect(m.toOutput(us(8))).toBe(us(5));
    expect(m.toLogical(us(5))).toBe(us(8));
    expect(m.nextKept(us(2.5))).toBe(us(4));
    expect(m.pieceAt(us(7))?.speed).toBe(2);
    expect(m.pieceAt(us(3))).toBeUndefined();
    for (const o of [0, 1.5, 2.2, 7.3, 10.9])
      expect(m.toOutput(m.toLogical(us(o)))).toBeCloseTo(us(o), 3);
  });
  test('audio volume pieces and trim bounds', () => {
    const p = {
      ...makeProject(recording),
      trim: { startUs: us(1), endUs: us(9) },
      segments: [seg('audio', 0, 3)],
    };
    const m = createEditMap(p);
    expect(m.durationUs).toBe(us(8));
    expect(m.pieceAt(us(2))?.volume).toBe(0.5);
    expect(m.pieceAt(us(5))?.volume).toBe(1);
  });
  test('placement uses free tracks; exclusive kinds and same-track overlaps are rejected', () => {
    let p = makeProject(recording, [zoom(1, 4)]);
    p = addSegment(p, 'text', us(2));
    const text = p.segments[0]!;
    expect(text.track).toBe(1);
    p = addSegment(p, 'speed', us(2));
    expect(p.segments[1]!.track).toBe(2);
    expect(() => addSegment(p, 'speed', us(3))).toThrow(/speed segment/);
    validateProject(p, recording);
    const clash = {
      ...p,
      segments: [
        ...p.segments,
        seg('blur', 1, 3, {
          track: 0,
          rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
          strength: 10,
        }),
      ],
    };
    expect(() => validateProject(clash, recording)).toThrow(/overlap/);
    expect(() =>
      validateProject({ ...makeProject(recording), segments: [seg('cut', 0, 15)] }, recording),
    ).toThrow(/Cuts/);
  });
  test('vertical move changes track when free and falls back when blocked', () => {
    const p = {
      ...makeProject(recording, [zoom(1, 4)]),
      segments: [
        seg('text', 5, 7, {
          track: 1,
          text: 'a',
          position: { x: 0.5, y: 0.5 },
          size: 40,
          color: '#ffffff',
          style: 'pill',
        }),
      ],
    };
    const up = moveItems(p, ['text5'], 0, recording.durationUs, -1);
    expect(up.segments[0]!.track).toBe(0);
    const blocked = moveItems(p, ['text5'], -us(3), recording.durationUs, -1);
    // Track 0 holds a zoom at 1–4 s, so moving onto track 0 stops at its end.
    expect(blocked.segments[0]).toMatchObject({ track: 0, startUs: us(4) });
    const s = splitItem(p, 'text5', us(6));
    expect(s.segments).toHaveLength(2);
    expect(
      removeItems(
        s,
        s.segments.map((x) => x.id),
      ).segments,
    ).toEqual([]);
  });
  test('duplicate places a copy right after the original on a free track', () => {
    let p = makeProject(recording, [zoom(1, 3)]);
    p = addSegment(p, 'text', us(5));
    const text = p.segments[0]!;
    const d = duplicateItem(p, text.id);
    expect(d.segments).toHaveLength(2);
    expect(d.segments[1]).toMatchObject({
      kind: 'text',
      startUs: text.endUs,
      endUs: text.endUs + (text.endUs - text.startUs),
    });
    expect(d.segments[1]!.id).not.toBe(text.id);
    const z = duplicateItem(d, 'z1');
    // Zooms cannot overlap each other, so the copy starts where the original ends.
    expect(z.zooms.map((x) => [x.startUs, x.endUs])).toEqual([
      [us(1), us(3)],
      [us(3), us(5)],
    ]);
    validateProject(z, recording);
  });
  test('settleTracks moves colliding generated zooms off occupied tracks', () => {
    const p = {
      ...makeProject(recording, [zoom(1, 4)]),
      segments: [
        seg('blur', 0, 5, {
          track: 0,
          rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
          strength: 10,
        }),
      ],
    };
    const settled = settleTracks(p, ['z1']);
    expect(settled.zooms[0]!.track).toBe(1);
    validateProject(settled, recording);
  });
});

describe('P2: offset, cursor track, webcam layout', () => {
  test('a zero offset is identical to no offset; an offset places the cursor off-center', () => {
    const still = [event(0.5, 'pointer-move', 0.5, 0.5)];
    const plain = createCamera(makeProject(recording, [zoom(1, 6)]), still),
      zero = createCamera(
        makeProject(recording, [
          zoom(1, 6, { focus: { mode: 'follow-pointer', offset: { x: 0, y: 0 } } }),
        ]),
        still,
      );
    for (const t of [1.5, 3, 5.9]) expect(zero.at(us(t))).toEqual(plain.at(us(t)));
    // Cursor at the lower-left quarter of a 2× view: center moves up/right by 0.25 / 2.
    const off = createCamera(
      makeProject(recording, [
        zoom(1, 6, { focus: { mode: 'follow-pointer', offset: { x: -0.25, y: 0.25 } } }),
      ]),
      still,
    );
    const c = off.at(us(5));
    expect(c.x).toBeCloseTo(0.5 + 0.125, 3);
    expect(c.y).toBeCloseTo(0.5 - 0.125, 3);
    const bad = makeProject(recording, [
      zoom(1, 6, { focus: { mode: 'follow-pointer', offset: { x: 0.6, y: 0 } } }),
    ]);
    expect(() => validateProject(bad, recording)).toThrow(/focus/);
  });
  test('generated zooms take the default offset; a centered default adds none', () => {
    const clicks = [...click(2), ...click(3)];
    const plain = planZooms(clicks, us(15)),
      centered = planZooms(clicks, us(15), { offset: { x: 0, y: 0 } }),
      off = planZooms(clicks, us(15), { offset: { x: -0.2, y: 0.15 } });
    expect(centered).toEqual(plain);
    expect(off[0]!.focus).toEqual({ mode: 'follow-pointer', offset: { x: -0.2, y: 0.15 } });
    validateProject(makeProject(recording, off), recording);
  });
  test('cursor track interpolates, hides after leaving, and sizes from geometry', () => {
    const geometry = [{ id: 'g', atUs: 0, widthCss: 1100, heightCss: 880, dpr: 1 }];
    const track = createCursorTrack(
      [
        { ...event(1, 'pointer-move', 0.2, 0.2), cursor: 'pointer' },
        event(1.1, 'pointer-move', 0.4, 0.4),
        event(2, 'pointer-leave', 0.4, 0.4),
      ],
      { x: 0, y: 0, width: 1, height: 1 },
      geometry,
    );
    expect(track.at(us(0.5))).toBeUndefined();
    const mid = track.at(us(1.05))!;
    expect(mid.point.x).toBeCloseTo(0.3, 6);
    expect(mid.style).toBe('pointer');
    expect(mid.height).toBeCloseTo(22 / 880, 9);
    expect(track.at(us(2.5))).toBeUndefined();
  });
  test('webcam layout follows corner/size and eases camera segments', () => {
    const p = makeProject({
      ...recording,
      camera: { mediaRef: 'webcam-x.webm', width: 640, height: 480, offsetUs: 0 },
    });
    const base = webcamLayout(p, us(1), 1920, 1080)!;
    expect(base.x + base.width).toBeCloseTo(1920 - 1080 * p.webcam.margin, 6);
    expect(base.width).toBeCloseTo(1080 * p.webcam.size, 6);
    p.segments = [
      { id: 'c', kind: 'camera', layout: 'fullscreen', startUs: us(4), endUs: us(8), track: 1 },
    ];
    validateProject(p, {
      ...recording,
      camera: { mediaRef: 'webcam-x.webm', width: 640, height: 480, offsetUs: 0 },
    });
    expect(webcamLayout(p, us(6), 1920, 1080)).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    const entering = webcamLayout(p, us(4.15), 1920, 1080)!;
    expect(entering.width).toBeGreaterThan(base.width);
    expect(entering.width).toBeLessThan(1920);
    p.segments = [
      { id: 'h', kind: 'camera', layout: 'hidden', startUs: us(4), endUs: us(8), track: 1 },
    ];
    expect(webcamLayout(p, us(6), 1920, 1080)).toBeNull();
    expect(() => validateProject(p, recording)).toThrow(/webcam/);
  });
});

describe('v0.6: 3D poses, stage geometry, layouts', () => {
  const three = (zooms: Zoom[], patch: Partial<Project['stage']> = {}) => {
    const p = makeProject(recording, zooms);
    p.stage = { ...p.stage, mode: '3d', ...patch };
    return p;
  };
  const move = (kind: CameraMove['kind'], direction: 'left' | 'right' = 'left', strength = 1) => ({
    kind,
    direction,
    strength,
  });
  const still = [event(0.5, 'pointer-move', 0.5, 0.5)];

  test('flat projects keep v0.5 camera values and zero poses', () => {
    const p = makeProject(recording, [zoom(1, 6, { move: move('orbit') })]);
    const c = createCamera(p, still);
    for (const t of [0, 1.2, 3, 5.9, 8]) {
      const v = c.at(us(t));
      expect([v.yaw, v.pitch, v.roll, v.push]).toEqual([0, 0, 0, 0]);
    }
    const plain = createCamera(makeProject(recording, [zoom(1, 6)]), still);
    for (const t of [1.2, 3, 5.9]) expect(c.at(us(t))).toEqual(plain.at(us(t)));
    expect(needsStage(p)).toBe(false);
  });

  test('tilt, dolly and orbit reach their targets; resting tilt applies outside zooms', () => {
    const tilt = createCamera(three([zoom(1, 6, { move: move('tilt', 'left') })]), still);
    expect(tilt.at(us(4)).yaw).toBeCloseTo(CAMERA.tiltYaw, 1);
    expect(tilt.at(us(4)).pitch).toBeCloseTo(-CAMERA.tiltPitch, 1);
    expect(tilt.at(us(10)).yaw).toBeCloseTo(0, 2);
    const right = createCamera(three([zoom(1, 6, { move: move('tilt', 'right', 0.5) })]), still);
    expect(right.at(us(4)).yaw).toBeCloseTo(-CAMERA.tiltYaw * 0.5, 1);
    const dolly = createCamera(three([zoom(1, 6, { move: move('dolly') })]), still);
    expect(dolly.at(us(4)).push).toBeCloseTo(CAMERA.dollyPush, 3);
    const orbit = createCamera(three([zoom(1, 9, { move: move('orbit') })]), still);
    const yaws = [2.5, 4, 5.5, 7].map((t) => orbit.at(us(t)).yaw);
    for (let i = 1; i < yaws.length; i++) expect(yaws[i]!).toBeLessThan(yaws[i - 1]!);
    const resting = createCamera(three([], { tilt: { yaw: -10, pitch: 6 } }), still);
    expect(resting.at(us(3))).toMatchObject({ yaw: -10, pitch: 6 });
  });

  test('swing turns the near side toward the cursor; seeking and reuse are deterministic', () => {
    const right = [event(0.5, 'pointer-move', 0.85, 0.8)];
    const p = three([zoom(1, 6, { move: move('swing') })]);
    const swing = createCamera(p, right);
    const at = swing.at(us(4));
    expect(at.yaw).toBeLessThan(-5);
    expect(at.pitch).toBeLessThan(-3);
    const fresh = createCamera(p, right);
    expect(fresh.at(us(4))).toEqual(at);
    expect(fresh.at(us(2))).toEqual(swing.at(us(2)));
    // Changing a move after reuse matches a fresh evaluator.
    const edited = three([zoom(1, 6, { move: move('tilt', 'right') })]);
    const reused = createCamera(edited, right, swing),
      clean = createCamera(edited, right);
    for (const t of [0.5, 2, 4, 7]) expect(reused.at(us(t))).toEqual(clean.at(us(t)));
    // A different stage invalidates the cache.
    const tilted = three([zoom(1, 6, { move: move('swing') })], { tilt: { yaw: 12, pitch: 0 } });
    expect(createCamera(tilted, right, swing).at(us(0.2)).yaw).toBeCloseTo(12, 6);
  });

  test('motion blur samples a turning stage', () => {
    const c = createCamera(three([zoom(1, 6, { move: move('tilt') })]), still);
    expect(motionSamples(c, us(1.15), 30, true).length).toBeGreaterThan(1);
    expect(motionSamples(c, us(4.5), 30, true)).toHaveLength(1);
  });

  test('device geometry wraps the screen; projection and fit keep it in its region', () => {
    for (const device of ['laptop', 'tablet', 'phone', 'monitor', 'browser', 'none'] as const) {
      const g = deviceLayout(device, 1600, 1000);
      expect(g.screen.x + g.screen.width).toBeLessThanOrEqual(g.face.width + 1e-9);
      expect(g.screen.y + g.screen.height).toBeLessThanOrEqual(g.face.height + 1e-9);
      expect(g.face.width).toBeGreaterThan(g.face.height); // landscape recording, landscape device
    }
    const g = deviceLayout('laptop', 1600, 1000),
      meshes = buildDevice('laptop', g, 'light', 0),
      region = { x: 0, y: 0, width: 1920, height: 1080 },
      rest = restScale(g, region, 60);
    // The lid has real thickness and the base is a separate slab.
    const zs = meshes.find((m) => m.name === 'face-sides')!.tris.map((v) => v.p[2]);
    expect(Math.min(...zs)).toBeCloseTo(-g.depth, 6);
    expect(meshes.some((m) => m.name === 'deck')).toBe(true);
    const flat = placeDevice(g, meshes, { yaw: 0, pitch: 0, roll: 0, push: 0 }, region, rest, 0.5);
    const corners = flat.face.map((p) => projectPoint(p, flat.eye, flat.center, flat.focal));
    // At rest the face is a front-facing rectangle, no larger than its padded fit (the base's
    // perspective can shrink it further).
    expect(corners[1]!.y).toBeCloseTo(corners[0]!.y, 6);
    expect(corners[1]!.x - corners[0]!.x).toBeLessThanOrEqual(g.face.width * rest + 1e-6);
    expect(corners[1]!.x - corners[0]!.x).toBeGreaterThan(g.face.width * rest * 0.6);
    const turned = placeDevice(
      g,
      meshes,
      { yaw: 20, pitch: -8, roll: 0, push: 0 },
      region,
      rest,
      0.5,
    );
    const tq = turned.face.map((p) => projectPoint(p, turned.eye, turned.center, turned.focal));
    // Positive yaw: the right edge recedes, so it projects shorter than the left edge.
    expect(tq[2]!.y - tq[1]!.y).toBeLessThan(tq[3]!.y - tq[0]!.y);
    for (const mesh of turned.meshes)
      for (const v of mesh.tris) {
        const q = projectPoint(v.p, turned.eye, turned.center, turned.focal);
        expect(q.x).toBeGreaterThanOrEqual(-1);
        expect(q.x).toBeLessThanOrEqual(1921);
        expect(q.y).toBeGreaterThanOrEqual(-1);
        expect(q.y).toBeLessThanOrEqual(1081);
      }
    // Rotated normals stay unit length and the lit metal is brighter facing the light.
    const n = turned.meshes.find((m) => m.name === 'face-bottom')!.tris[0]!.n;
    expect(Math.hypot(...n)).toBeCloseTo(1, 6);
    expect(shade([0, 0, 1], [0.5, 0.5, 0.5], 0)[0]).toBeGreaterThan(
      shade([0, 0, -1], [0.5, 0.5, 0.5], 0)[0],
    );
    // Push brings the device closer (bigger) without changing its fit.
    const pushed = placeDevice(
      g,
      meshes,
      { yaw: 0, pitch: 0, roll: 0, push: 0.2 },
      region,
      rest,
      0.5,
    );
    const pc = pushed.face.map((p) => projectPoint(p, pushed.eye, pushed.center, pushed.focal));
    expect(pc[1]!.x - pc[0]!.x).toBeGreaterThan(corners[1]!.x - corners[0]!.x);
  });

  test('composition layouts share the frame and ease between arrangements', () => {
    const cam = { mediaRef: 'webcam-x.webm', width: 640, height: 480, offsetUs: 0 };
    const p = makeProject({ ...recording, camera: cam });
    expect(compositionLayout(p, 0, 1920, 1080, false)).toEqual({
      screen: { x: 0, y: 0, width: 1920, height: 1080 },
      webcam: null,
    });
    p.webcam = { ...p.webcam, layout: 'side-by-side', split: 0.4 };
    const side = compositionLayout(p, 0, 1920, 1080);
    expect(side.screen).toEqual({ x: 0, y: 0, width: 1920 * 0.6, height: 1080 });
    expect(side.webcam!.x).toBeGreaterThanOrEqual(1920 * 0.6);
    p.webcam = { ...p.webcam, layout: 'stacked', corner: 'tl' };
    const stacked = compositionLayout(p, 0, 1080, 1920);
    expect(stacked.screen.y).toBeCloseTo(1920 * 0.4, 6);
    expect(stacked.webcam!.y + stacked.webcam!.height).toBeLessThanOrEqual(1920 * 0.4 + 1e-6);
    p.webcam = { ...p.webcam, layout: 'pip' };
    p.segments = [
      { id: 's', kind: 'camera', layout: 'side-by-side', startUs: us(4), endUs: us(8), track: 1 },
    ];
    validateProject(p, { ...recording, camera: cam });
    const mid = compositionLayout(p, us(4.15), 1920, 1080);
    expect(mid.screen.width).toBeLessThan(1920);
    expect(mid.screen.width).toBeGreaterThan(1920 * 0.6);
    expect(compositionLayout(p, us(6), 1920, 1080).screen.width).toBeCloseTo(1920 * 0.6, 6);
    expect(webcamLayout(p, us(1), 1920, 1080)).toEqual(
      compositionLayout(p, us(1), 1920, 1080).webcam,
    );
  });

  test('schema 5 validation and planner default move', () => {
    const p = makeProject(recording);
    p.stage = { ...p.stage, tilt: { yaw: 40, pitch: 0 } };
    expect(() => validateProject(p, recording)).toThrow(/stage/);
    const bad = makeProject(recording, [
      zoom(1, 3, { move: { kind: 'orbit', direction: 'left', strength: 3 } }),
    ]);
    expect(() => validateProject(bad, recording)).toThrow(/move/);
    const motion = makeProject(recording);
    motion.composition.backgroundMotion = { kind: 'waves', speed: 1 };
    validateProject(motion, recording);
    expect(needsStage(motion)).toBe(true);
    const zooms = planZooms([...click(2), ...click(3)], us(15), {
      move: move('dolly', 'left', 0.5),
    });
    expect(zooms[0]!.move).toEqual({ kind: 'dolly', direction: 'left', strength: 0.5 });
    expect(
      planZooms([...click(2), ...click(3)], us(15), { move: move('none') })[0]!.move,
    ).toBeUndefined();
  });
});

describe('crop', () => {
  test('events map into the cropped frame and output size follows the crop', () => {
    const crop = { x: 0, y: 0.1, width: 1, height: 0.9 };
    const [e] = cropEvents([event(1, 'pointer-down', 0.5, 0.55)], crop);
    expect(e!.point.y).toBeCloseTo(0.5, 9);
    const p = makeProject(recording);
    p.composition.crop = crop;
    validateProject(p, recording);
    const size = outputSize(p, recording);
    expect(size.width / size.height).toBeCloseTo(1280 / (720 * 0.9), 2);
    const box = frameRect(p, 1280, 720, size.width, size.height);
    expect(box.width / box.height).toBeCloseTo(1280 / 648, 2);
    p.composition.crop = { x: 0.95, y: 0, width: 0.2, height: 1 };
    expect(() => validateProject(p, recording)).toThrow(/crop/);
  });
});

describe('pointer mapping', () => {
  const measured = (patch: Partial<MeasuredEvent>): MeasuredEvent => ({
    kind: 'pointer-down',
    epochMs: 0,
    x: 100,
    y: 50,
    width: 1000,
    height: 500,
    dpr: 1,
    screenX: 300,
    screenY: 250,
    win: { x: 200, y: 100, width: 1016, height: 700 },
    top: true,
    ...patch,
  });
  test('tab mode uses viewport pixels and ignores subframes', () => {
    expect(mapEvent({ kind: 'tab' }, measured({}), { width: 1000, height: 500 })?.point).toEqual({
      x: 0.1,
      y: 0.1,
    });
    expect(mapEvent({ kind: 'tab' }, measured({ top: false }), { width: 1, height: 1 })).toBeNull();
  });
  test('monitor mode maps screen DIPs into the captured display and drops other displays', () => {
    const surface = {
      kind: 'monitor' as const,
      bounds: { left: -1920, top: 0, width: 1920, height: 1080 },
    };
    expect(
      mapEvent(surface, measured({ screenX: -960, screenY: 540 }), { width: 1, height: 1 })?.point,
    ).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(mapEvent(surface, measured({ screenX: 10 }), { width: 1, height: 1 })).toBeNull();
    expect(mapEvent(surface, measured({ screenX: null }), { width: 1, height: 1 })).toBeNull();
  });
  test('window mode removes invisible borders and rejects windows of another size', () => {
    // Frame is 1000×700 at DPR 1; window bounds include 8 px borders on each side.
    const m = mapEvent({ kind: 'window' }, measured({ screenX: 208, screenY: 100 }), {
      width: 1000,
      height: 700,
    });
    expect(m?.point.x).toBeCloseTo(0, 6);
    expect(m?.point.y).toBeCloseTo(0, 6);
    expect(mapEvent({ kind: 'window' }, measured({}), { width: 600, height: 900 })).toBeNull();
  });
  test('viewport rect locates the page inside a window capture for auto crop', () => {
    // Window 1016×700 at (200,100) with 8 px borders; page viewport 1000×600 starts 92 px below the top.
    const v = viewportRect(
      { kind: 'window' },
      measured({ x: 100, y: 50, width: 1000, height: 600, screenX: 308, screenY: 242 }),
      { width: 1000, height: 700 },
    );
    expect(v).toEqual({ x: 0, y: 0.131, width: 1, height: 0.857 });
    expect(viewportRect({ kind: 'tab' }, measured({}), { width: 1, height: 1 })).toBeNull();
  });
  test('display choice prefers matching aspect, then the display containing the browser', () => {
    const displays = [
      { left: 0, top: 0, width: 1920, height: 1080 },
      { left: 1920, top: 0, width: 2560, height: 1440 },
      { left: 0, top: 1080, width: 1200, height: 1920 },
    ];
    expect(pickDisplay(displays, { width: 1200, height: 1920 })).toBe(displays[2]);
    expect(pickDisplay(displays, { width: 3840, height: 2160 }, { x: 2000, y: 100 })).toBe(
      displays[1],
    );
    expect(pickDisplay(displays, { width: 1000, height: 1000 })).toBeUndefined();
  });
});
