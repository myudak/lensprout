import { normalizeEvents, type InputEvent, type Project, type Recording } from '../domain/model';
import { rawToLogical } from '../domain/time-map';
import { conflicts, items, overlaps, type Item } from '../domain/segments';
import { typingPeriods } from './planner';

/**
 * Smart trim: suggestions to speed up idle stretches and typing, and to cut silences, computed
 * from frame differences, input events and audio level. Pure functions; the analysis worker
 * supplies the measurements.
 */
export type Range = { startUs: number; endUs: number };
export type Suggestion = Range & {
  id: string;
  kind: 'speed' | 'cut';
  speed?: number;
  reason: 'idle' | 'typing' | 'silence';
};
export const SMART = {
  /** Mean absolute frame difference (0–1) below which a frame counts as unchanged. */
  staticDiff: 0.004,
  minIdleUs: 2_000_000,
  minSilenceUs: 1_200_000,
  silenceDb: -45,
  minTypingUs: 2_000_000,
  /** Kept at both ends so speed-ups and cuts never clip the moment around an action. */
  marginUs: 250_000,
  idleSpeed: 4,
  typingSpeed: 2,
};

/** Runs of consecutive samples where `quiet` holds, as ranges [first sample, next sample). */
function runs<T extends { atUs: number }>(samples: T[], quiet: (s: T) => boolean, minUs: number) {
  const out: Range[] = [];
  let start: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    if (quiet(s)) start ??= s.atUs;
    else if (start !== null) {
      if (s.atUs - start >= minUs) out.push({ startUs: start, endUs: s.atUs });
      start = null;
    }
  }
  const last = samples.at(-1);
  if (start !== null && last && last.atUs - start >= minUs)
    out.push({ startUs: start, endUs: last.atUs });
  return out;
}

/** Stretches where the picture does not change (raw time). `diff` is relative to the previous frame. */
export const staticRanges = (
  frames: { atUs: number; diff: number }[],
  threshold = SMART.staticDiff,
  minUs = SMART.minIdleUs,
) => runs(frames, (f) => f.diff < threshold, minUs);

/** Stretches below the silence level (raw time). `rms` is linear (0–1) per window. */
export const silentRanges = (
  windows: { atUs: number; rms: number }[],
  db = SMART.silenceDb,
  minUs = SMART.minSilenceUs,
) => {
  const limit = Math.pow(10, db / 20);
  return runs(windows, (w) => w.rms < limit, minUs);
};

/** Logical stretches with no input events at all. */
export function inputGaps(events: InputEvent[], durationUs: number, minUs = SMART.minIdleUs) {
  const times = normalizeEvents(events, durationUs).map((e) => e.atUs);
  const out: Range[] = [];
  let previous = 0;
  for (const t of [...times, durationUs]) {
    if (t - previous >= minUs) out.push({ startUs: previous, endUs: t });
    previous = t;
  }
  return out;
}

/** Pairwise intersection of two sorted range lists. */
export function intersect(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i]!.startUs, b[j]!.startUs),
      end = Math.min(a[i]!.endUs, b[j]!.endUs);
    if (start < end) out.push({ startUs: start, endUs: end });
    if (a[i]!.endUs < b[j]!.endUs) i++;
    else j++;
  }
  return out;
}

/** a minus b. */
export function subtract(a: Range[], b: Range[]): Range[] {
  let out = a;
  for (const cut of b)
    out = out.flatMap((r) => {
      if (!overlaps(r, cut)) return [r];
      const parts: Range[] = [];
      if (r.startUs < cut.startUs) parts.push({ startUs: r.startUs, endUs: cut.startUs });
      if (cut.endUs < r.endUs) parts.push({ startUs: cut.endUs, endUs: r.endUs });
      return parts;
    });
  return out;
}

const shrink = (ranges: Range[], margin: number, minUs: number) =>
  ranges
    .map((r) => ({ startUs: r.startUs + margin, endUs: r.endUs - margin }))
    .filter((r) => r.endUs - r.startUs >= minUs);

/** Raw ranges → logical ranges (pauses are removed from the timeline). */
export const toLogical = (recording: Recording, ranges: Range[]) =>
  ranges
    .map((r) => ({
      startUs: rawToLogical(recording, r.startUs),
      endUs: rawToLogical(recording, r.endUs),
    }))
    .filter((r) => r.endUs > r.startUs);

/**
 * Combines measurements (logical time) into suggestions. Silent + static + no input → cut (only
 * with audio, so speech over a still screen is never cut); static + no input → idle speed-up;
 * typing periods → typing speed-up. Each kind is kept apart from the others.
 */
export function suggest(input: {
  durationUs: number;
  trim: Range;
  staticLogical: Range[];
  silentLogical: Range[] | null;
  events: InputEvent[];
}): Suggestion[] {
  const within = (rs: Range[]) => intersect(rs, [input.trim]);
  const idle = within(intersect(input.staticLogical, inputGaps(input.events, input.durationUs)));
  const cuts = input.silentLogical
    ? shrink(
        intersect(idle, input.silentLogical),
        SMART.marginUs,
        SMART.minSilenceUs - 2 * SMART.marginUs,
      )
    : [];
  const idleSpeed = shrink(
    subtract(idle, cuts),
    SMART.marginUs,
    SMART.minIdleUs - 2 * SMART.marginUs,
  );
  const typing = shrink(
    within(subtract(typingPeriods(input.events, input.durationUs), [...cuts, ...idleSpeed])),
    SMART.marginUs,
    SMART.minTypingUs - 2 * SMART.marginUs,
  );
  const round = (r: Range) => ({ startUs: Math.round(r.startUs), endUs: Math.round(r.endUs) });
  return [
    ...cuts.map((r) => ({ ...round(r), kind: 'cut' as const, reason: 'silence' as const })),
    ...idleSpeed.map((r) => ({
      ...round(r),
      kind: 'speed' as const,
      speed: SMART.idleSpeed,
      reason: 'idle' as const,
    })),
    ...typing.map((r) => ({
      ...round(r),
      kind: 'speed' as const,
      speed: SMART.typingSpeed,
      reason: 'typing' as const,
    })),
  ]
    .sort((a, b) => a.startUs - b.startUs)
    .map((s, i) => ({ ...s, id: `smart:${s.reason}:${i}:${s.startUs}` }));
}

/**
 * Adds suggestions as segments on the lowest free track. Speed segments are exclusive, so one that
 * would overlap an existing speed segment is skipped (reported), never forced.
 */
export function applySuggestions(project: Project, suggestions: Suggestion[]) {
  let next: Project = { ...project, segments: [...project.segments] };
  const skipped: Suggestion[] = [];
  for (const s of suggestions) {
    const all = items(next),
      // A fresh id per applied segment: suggestion ids repeat across analyses.
      id = `smart-${crypto.randomUUID()}`;
    let placed = false;
    for (let track = 0; track < 32 && !placed; track++) {
      const candidate: Item = { id, kind: s.kind, startUs: s.startUs, endUs: s.endUs, track };
      if (all.some((other) => conflicts(candidate, other) && overlaps(candidate, other))) {
        // Exclusive overlap fails on every track; stop early.
        if (all.some((o) => o.kind === s.kind && s.kind === 'speed' && overlaps(candidate, o)))
          break;
        continue;
      }
      next = {
        ...next,
        segments: [
          ...next.segments,
          s.kind === 'speed'
            ? { id, kind: 'speed', speed: s.speed!, startUs: s.startUs, endUs: s.endUs, track }
            : { id, kind: 'cut', startUs: s.startUs, endUs: s.endUs, track },
        ],
      };
      placed = true;
    }
    if (!placed) skipped.push(s);
  }
  return { project: next, applied: suggestions.length - skipped.length, skipped };
}
