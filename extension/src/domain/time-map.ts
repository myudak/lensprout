import { clamp, type Recording } from './model';
export type PauseRange = { startUs: number; endUs: number };
export function rawToLogical(recording: Pick<Recording, 'pauses'>, rawUs: number) {
  return Math.round(
    rawUs -
      recording.pauses.reduce(
        (sum, p) => sum + clamp(rawUs - p.startUs, 0, p.endUs - p.startUs),
        0,
      ),
  );
}
export function logicalToRaw(
  recording: Pick<Recording, 'pauses' | 'rawDurationUs'>,
  logicalUs: number,
) {
  let raw = logicalUs;
  for (const p of recording.pauses) if (raw >= p.startUs) raw += p.endUs - p.startUs;
  return Math.round(clamp(raw, 0, recording.rawDurationUs));
}
export function pausedRange(recording: Pick<Recording, 'pauses'>, rawUs: number) {
  return recording.pauses.find((p) => rawUs >= p.startUs && rawUs < p.endUs);
}
export function keptRanges(recording: Pick<Recording, 'pauses'>, startUs: number, endUs: number) {
  const result: PauseRange[] = [];
  let cursor = startUs;
  for (const p of recording.pauses) {
    if (p.endUs <= cursor || p.startUs >= endUs) continue;
    if (p.startUs > cursor) result.push({ startUs: cursor, endUs: p.startUs });
    cursor = Math.max(cursor, p.endUs);
  }
  if (cursor < endUs) result.push({ startUs: cursor, endUs });
  return result;
}
