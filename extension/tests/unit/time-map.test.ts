import { expect, test } from 'vitest';
import { rawToLogical, logicalToRaw, keptRanges, pausedRange } from '../../src/domain/time-map';
const r = {
  rawDurationUs: 10_000_000,
  pauses: [
    { startUs: 2_000_000, endUs: 4_000_000 },
    { startUs: 6_000_000, endUs: 7_000_000 },
  ],
};
test('maps repeated pauses and exact boundaries without reintroducing a gap', () => {
  expect(rawToLogical(r, 10_000_000)).toBe(7_000_000);
  expect(logicalToRaw(r, 2_000_000)).toBe(4_000_000);
  expect(logicalToRaw(r, 4_000_000)).toBe(7_000_000);
  for (const logical of [0, 1_000_000, 2_000_000, 3_123_456, 4_000_000, 7_000_000])
    expect(rawToLogical(r, logicalToRaw(r, logical))).toBe(logical);
  expect(pausedRange(r, 3_000_000)).toBeDefined();
  expect(pausedRange(r, 4_000_000)).toBeUndefined();
});
test('clips media keep ranges for trim on either side of pause', () => {
  expect(keptRanges(r, 1_000_000, 8_000_000)).toEqual([
    { startUs: 1_000_000, endUs: 2_000_000 },
    { startUs: 4_000_000, endUs: 6_000_000 },
    { startUs: 7_000_000, endUs: 8_000_000 },
  ]);
});
