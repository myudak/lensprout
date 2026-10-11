import type { Project } from './model';

/**
 * Output time ("edit time") from logical time. The trim range is split at every cut, speed and
 * audio boundary; cut ranges are dropped and each kept piece plays at its speed and volume.
 * All values are microseconds; output positions are fractional until the caller rounds them.
 */
export type Piece = {
  startUs: number;
  endUs: number;
  speed: number;
  volume: number;
  outStartUs: number;
};
export type EditMap = ReturnType<typeof createEditMap>;

export function createEditMap(project: Pick<Project, 'trim' | 'segments'>) {
  const { startUs: t0, endUs: t1 } = project.trim;
  const within = (n: number) => Math.min(t1, Math.max(t0, n));
  const segments = project.segments.filter((s) => s.endUs > t0 && s.startUs < t1);
  const bounds = [
    ...new Set([t0, t1, ...segments.flatMap((s) => [within(s.startUs), within(s.endUs)])]),
  ].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  let out = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i]!,
      b = bounds[i + 1]!,
      mid = (a + b) / 2;
    const active = segments.filter((s) => s.startUs <= mid && mid < s.endUs);
    if (active.some((s) => s.kind === 'cut')) continue;
    const speed = active.find((s) => s.kind === 'speed');
    const audio = active.find((s) => s.kind === 'audio');
    const piece: Piece = {
      startUs: a,
      endUs: b,
      speed: speed?.kind === 'speed' ? speed.speed : 1,
      volume: audio?.kind === 'audio' ? audio.volume : 1,
      outStartUs: out,
    };
    // Adjacent pieces with identical settings merge, keeping the list short for lookups.
    const last = pieces.at(-1);
    if (last && last.endUs === a && last.speed === piece.speed && last.volume === piece.volume)
      last.endUs = b;
    else pieces.push(piece);
    out += (b - a) / piece.speed;
  }
  const durationUs = out;
  /** Piece containing logical time, or undefined inside cuts/outside trim. */
  function pieceAt(logicalUs: number) {
    let low = 0,
      high = pieces.length - 1;
    while (low <= high) {
      const m = (low + high) >> 1,
        p = pieces[m]!;
      if (logicalUs < p.startUs) high = m - 1;
      else if (logicalUs >= p.endUs) low = m + 1;
      else return p;
    }
    return undefined;
  }
  return {
    pieces,
    durationUs,
    pieceAt,
    /** First kept logical time at or after `logicalUs` (skips cuts); trim end when none remain. */
    nextKept(logicalUs: number) {
      if (pieceAt(logicalUs)) return logicalUs;
      return pieces.find((p) => p.startUs >= logicalUs)?.startUs ?? t1;
    },
    toOutput(logicalUs: number) {
      const p = pieceAt(logicalUs);
      if (p) return p.outStartUs + (logicalUs - p.startUs) / p.speed;
      const next = pieces.find((q) => q.startUs >= logicalUs);
      return next ? next.outStartUs : durationUs;
    },
    toLogical(outputUs: number) {
      let low = 0,
        high = pieces.length - 1,
        found = pieces[0];
      while (low <= high) {
        const m = (low + high) >> 1;
        if (pieces[m]!.outStartUs <= outputUs) {
          found = pieces[m];
          low = m + 1;
        } else high = m - 1;
      }
      if (!found) return t0;
      return Math.min(found.endUs, found.startUs + (outputUs - found.outStartUs) * found.speed);
    },
  };
}
