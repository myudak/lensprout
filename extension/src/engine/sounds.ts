import { normalizeEvents, type InputEvent, type Project } from '../domain/model';
import type { EditMap } from '../domain/edit-map';

/**
 * Click and keyboard sounds synthesized in code (no audio assets), so preview and export produce
 * the same waveform. A click is a short high-passed noise burst plus a bright tick; a key is a
 * softer, shorter tick. Generation is seeded, so every call returns identical samples.
 */
export type SoundKind = 'click' | 'key';
export type SoundCue = { atUs: number; kind: SoundKind };

function random(seed: number) {
  // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, Float32Array>();
/** Mono samples for one sound at `sampleRate`, peak ≤ 0.9. */
export function soundSamples(kind: SoundKind, sampleRate: number): Float32Array {
  const key = `${kind}@${sampleRate}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const click = kind === 'click',
    length = Math.round(sampleRate * (click ? 0.05 : 0.032)),
    data = new Float32Array(length),
    next = random(click ? 7 : 11),
    noiseDecay = click ? 0.006 : 0.004,
    toneDecay = click ? 0.012 : 0.007,
    tone = click ? 3200 : 1850;
  let previous = 0,
    filtered = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const noise = next() * 2 - 1;
    // One-pole high-pass keeps the burst crisp rather than hissy.
    filtered = 0.82 * (filtered + noise - previous);
    previous = noise;
    const burst = filtered * Math.exp(-t / noiseDecay) * (click ? 0.55 : 0.3),
      tick = Math.sin(2 * Math.PI * tone * t) * Math.exp(-t / toneDecay) * (click ? 0.45 : 0.22);
    data[i] = burst + tick;
  }
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? Math.min(1, 0.9 / peak) * (click ? 1 : 0.6) : 1;
  for (let i = 0; i < length; i++) data[i]! *= gain;
  cache.set(key, data);
  return data;
}

/**
 * Sound cues in output time: pointer-downs (clicks), caret moves and shortcut chords (keys). Cues
 * in cut ranges or outside the trim are dropped; keys closer than 45 ms merge.
 */
export function soundCues(
  project: Pick<Project, 'effects'>,
  rawEvents: InputEvent[],
  edit: Pick<EditMap, 'pieceAt' | 'toOutput'>,
): SoundCue[] {
  const s = project.effects.sounds;
  if (!s.clicks && !s.keys) return [];
  const cues: SoundCue[] = [];
  let lastKey = -Infinity;
  for (const e of normalizeEvents(rawEvents, Number.MAX_SAFE_INTEGER)) {
    const kind: SoundKind | null =
      e.kind === 'pointer-down' && s.clicks
        ? 'click'
        : (e.kind === 'caret' || e.kind === 'chord') && s.keys
          ? 'key'
          : null;
    if (!kind || !edit.pieceAt(e.atUs)) continue;
    if (kind === 'key') {
      if (e.atUs - lastKey < 45_000) continue;
      lastKey = e.atUs;
    }
    cues.push({ atUs: Math.round(edit.toOutput(e.atUs)), kind });
  }
  return cues.sort((a, b) => a.atUs - b.atUs);
}

/**
 * Adds the cues overlapping [startUs, startUs + frames/sampleRate) into planar channels, scaled by
 * `volume`, clamped to ±1. `cues` must be sorted by time.
 */
export function mixCues(
  channels: Float32Array[],
  sampleRate: number,
  startUs: number,
  cues: SoundCue[],
  volume: number,
) {
  if (!cues.length || volume <= 0) return;
  const frames = channels[0]?.length ?? 0,
    endUs = startUs + (frames / sampleRate) * 1_000_000;
  // Binary search for the first cue that can still sound at startUs (cues last < 60 ms).
  let low = 0,
    high = cues.length;
  while (low < high) {
    const m = (low + high) >> 1;
    if (cues[m]!.atUs < startUs - 60_000) low = m + 1;
    else high = m;
  }
  for (let i = low; i < cues.length && cues[i]!.atUs < endUs; i++) {
    const cue = cues[i]!,
      sound = soundSamples(cue.kind, sampleRate),
      offset = Math.round(((cue.atUs - startUs) / 1_000_000) * sampleRate);
    const from = Math.max(0, offset),
      to = Math.min(frames, offset + sound.length);
    for (const channel of channels)
      for (let f = from; f < to; f++)
        channel[f] = Math.max(-1, Math.min(1, channel[f]! + sound[f - offset]! * volume));
  }
}
