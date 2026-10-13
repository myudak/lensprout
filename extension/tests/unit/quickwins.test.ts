import { describe, expect, test } from 'vitest';
import {
  makeProject,
  us,
  validateProject,
  type InputEvent,
  type Recording,
} from '../../src/domain/model';
import { createEditMap } from '../../src/domain/edit-map';
import { viewExtents } from '../../src/domain/crop';
import { applyStyle, extractStyle } from '../../src/domain/presets';
import { createCamera } from '../../src/engine/camera';
import { mixCues, soundCues, soundSamples } from '../../src/engine/sounds';
import {
  applySuggestions,
  inputGaps,
  intersect,
  silentRanges,
  staticRanges,
  subtract,
  suggest,
} from '../../src/engine/smart-trim';

const recording: Recording = {
  id: 'quick',
  schemaVersion: 6,
  name: 'Quick',
  createdAt: '2026-10-13T00:00:00Z',
  durationUs: us(20),
  rawDurationUs: us(20),
  pauses: [],
  width: 1600,
  height: 1000,
  mediaRef: 'quick.webm',
  mimeType: 'video/webm',
  hasAudio: true,
  status: 'ready',
  geometry: [{ id: 'g', atUs: 0, widthCss: 1600, heightCss: 1000, dpr: 1 }],
  source: 'monitor',
};
const ev = (t: number, kind: InputEvent['kind'], x = 0.5, y = 0.5): InputEvent => ({
  id: `${kind}:${t}`,
  atUs: us(t),
  kind,
  point: { x, y },
  geometryId: 'g',
});

describe('smart trim', () => {
  test('static and silent runs respect thresholds and minimum lengths', () => {
    const frames = Array.from({ length: 41 }, (_, i) => ({
      atUs: i * 250_000,
      diff: i >= 8 && i < 24 ? 0.001 : 0.05,
    }));
    expect(staticRanges(frames)).toEqual([{ startUs: 2_000_000, endUs: 6_000_000 }]);
    const windows = Array.from({ length: 200 }, (_, i) => ({
      atUs: i * 50_000,
      rms: i >= 40 && i < 80 ? 0.001 : 0.2,
    }));
    expect(silentRanges(windows)).toEqual([{ startUs: 2_000_000, endUs: 4_000_000 }]);
    // Too short to count.
    expect(silentRanges(windows.map((w, i) => ({ ...w, rms: i === 3 ? 0 : 0.2 })))).toEqual([]);
  });

  test('range algebra and input gaps', () => {
    expect(intersect([{ startUs: 0, endUs: 10 }], [{ startUs: 5, endUs: 20 }])).toEqual([
      { startUs: 5, endUs: 10 },
    ]);
    expect(subtract([{ startUs: 0, endUs: 10 }], [{ startUs: 3, endUs: 4 }])).toEqual([
      { startUs: 0, endUs: 3 },
      { startUs: 4, endUs: 10 },
    ]);
    expect(inputGaps([ev(1, 'pointer-move'), ev(6, 'pointer-move')], us(8))).toEqual([
      { startUs: us(1), endUs: us(6) },
      { startUs: us(6), endUs: us(8) },
    ]);
  });

  test('suggestions: silent idle is cut, idle with sound is sped up, typing is sped up', () => {
    const events = [
      ev(0.5, 'pointer-down'),
      ...Array.from({ length: 12 }, (_, i) => ev(12 + i * 0.25, 'caret')),
      ev(19, 'pointer-down'),
    ];
    const s = suggest({
      durationUs: us(20),
      trim: { startUs: 0, endUs: us(20) },
      staticLogical: [{ startUs: us(1), endUs: us(11) }],
      silentLogical: [{ startUs: us(1), endUs: us(4) }],
      events,
    });
    const cut = s.find((x) => x.kind === 'cut')!;
    expect(cut).toMatchObject({ reason: 'silence', startUs: us(1.25), endUs: us(3.75) });
    const idle = s.find((x) => x.reason === 'idle')!;
    expect(idle).toMatchObject({ kind: 'speed', speed: 4, startUs: us(4), endUs: us(10.75) });
    const typing = s.find((x) => x.reason === 'typing')!;
    expect(typing.kind).toBe('speed');
    expect(typing.startUs).toBeGreaterThanOrEqual(us(12));
    // Without audio nothing is cut.
    expect(
      suggest({
        durationUs: us(20),
        trim: { startUs: 0, endUs: us(20) },
        staticLogical: [{ startUs: us(1), endUs: us(11) }],
        silentLogical: null,
        events,
      }).some((x) => x.kind === 'cut'),
    ).toBe(false);
    const project = makeProject(recording);
    const applied = applySuggestions(project, s);
    expect(applied.applied).toBe(s.length);
    validateProject(applied.project, recording);
    expect(createEditMap(applied.project).durationUs).toBeLessThan(us(20) - us(2.5));
    // Speed is exclusive: applying the same suggestions again skips them.
    const again = applySuggestions(
      applied.project,
      s.filter((x) => x.kind === 'speed'),
    );
    expect(again.applied).toBe(0);
  });
});

describe('sounds', () => {
  test('synthesis is deterministic, bounded and short', () => {
    const a = soundSamples('click', 48000),
      b = soundSamples('click', 48000);
    expect(a).toBe(b);
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(a.length).toBe(2400);
    expect(soundSamples('key', 44100).length).toBe(Math.round(44100 * 0.032));
  });
  test('cues follow the edit map and mix only where they fall', () => {
    const p = makeProject(recording);
    p.effects.sounds = { clicks: true, keys: true, volume: 1 };
    p.segments = [{ id: 'c', kind: 'cut', startUs: us(2), endUs: us(4), track: 1 }];
    const cues = soundCues(
      p,
      [ev(1, 'pointer-down'), ev(3, 'pointer-down'), ev(5, 'caret'), ev(5.02, 'caret')],
      createEditMap(p),
    );
    expect(cues).toEqual([
      { atUs: us(1), kind: 'click' },
      { atUs: us(3), kind: 'key' },
    ]);
    const left = new Float32Array(48000),
      right = new Float32Array(48000);
    mixCues([left, right], 48000, us(0.5), cues, 0.5);
    const energy = (from: number, to: number) =>
      left.slice(from, to).reduce((sum, v) => sum + v * v, 0);
    expect(energy(24000, 26400)).toBeGreaterThan(0.1);
    expect(energy(0, 23900)).toBe(0);
    expect(left).toEqual(right);
    p.effects.sounds = { clicks: false, keys: false, volume: 1 };
    expect(soundCues(p, [ev(1, 'pointer-down')], createEditMap(p))).toEqual([]);
  });
});

describe('presets', () => {
  test('a style round-trips onto another project without its crop or timeline', () => {
    const a = makeProject(recording),
      b = makeProject({ ...recording, id: 'other' });
    a.composition.background = { type: 'color', color: '#123456' };
    a.stage = { ...a.stage, mode: '3d', device: 'laptop' };
    a.effects.sounds = { clicks: true, keys: false, volume: 0.4 };
    b.composition.crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    const styled = applyStyle(b, extractStyle(a), { ...recording, id: 'other' });
    expect(styled.composition.background).toEqual({ type: 'color', color: '#123456' });
    expect(styled.stage.device).toBe('laptop');
    expect(styled.composition.crop).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(styled.id).toBe('other');
    const broken = extractStyle(a);
    broken.effects.sounds.volume = 9;
    expect(() => applyStyle(b, broken, { ...recording, id: 'other' })).toThrow(/effects/);
  });
});

describe('vertical fill', () => {
  test('contain keeps full extents; fill pans a narrower column that follows the cursor', () => {
    const p = makeProject(recording);
    expect(viewExtents(p, 1600, 1000)).toEqual({ fx: 1, fy: 1 });
    p.composition.aspect = '9:16';
    expect(viewExtents(p, 1600, 1000)).toEqual({ fx: 1, fy: 1 });
    p.composition.fit = 'fill';
    const e = viewExtents(p, 1600, 1000);
    expect(e.fx).toBeCloseTo(9 / 16 / 1.6, 9);
    expect(e.fy).toBe(1);
    // No zoom: the column still follows the pointer horizontally and stays inside the frame.
    const c = createCamera(p, [ev(0.2, 'pointer-move', 0.9, 0.5)], undefined, e);
    const at = c.at(us(5));
    expect(at.x).toBeCloseTo(1 - e.fx / 2, 6);
    expect(at.zoom).toBe(1);
    expect(at.fx).toBeCloseTo(e.fx, 9);
    validateProject(p, recording);
  });
});
