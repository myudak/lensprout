/** MediaRecorder onstart establishes the epoch. Events carry timeOrigin+now. */
export class SessionClock {
  readonly startedEpochMs: number;
  private pausedAt: number | null = null;
  private pauses: { start: number; end: number }[] = [];
  constructor(epochMs: number) {
    this.startedEpochMs = epochMs;
  }
  pause(epochMs: number) {
    if (this.pausedAt === null) this.pausedAt = epochMs;
  }
  resume(epochMs: number) {
    if (this.pausedAt !== null) {
      this.pauses.push({ start: this.pausedAt, end: Math.max(this.pausedAt, epochMs) });
      this.pausedAt = null;
    }
  }
  at(epochMs: number): number | null {
    if (
      !Number.isFinite(epochMs) ||
      epochMs < this.startedEpochMs ||
      (this.pausedAt !== null && epochMs >= this.pausedAt) ||
      this.pauses.some((p) => epochMs >= p.start && epochMs < p.end)
    )
      return null;
    const pausedMs = this.pauses.reduce(
      (sum, p) => sum + (epochMs >= p.end ? p.end - p.start : 0),
      0,
    );
    return Math.round((epochMs - this.startedEpochMs - pausedMs) * 1000);
  }
  elapsed(epochMs: number) {
    return Math.max(
      0,
      this.at(this.pausedAt ?? epochMs) ??
        Math.round(
          ((this.pausedAt ?? epochMs) -
            this.startedEpochMs -
            this.pauses.reduce((sum, p) => sum + p.end - p.start, 0)) *
            1000,
        ),
    );
  }
  rawElapsed(epochMs: number) {
    return Math.max(0, Math.round((epochMs - this.startedEpochMs) * 1000));
  }
  pauseIntervals(epochMs: number) {
    return [
      ...this.pauses,
      ...(this.pausedAt !== null ? [{ start: this.pausedAt, end: epochMs }] : []),
    ].map((p) => ({ startUs: this.rawElapsed(p.start), endUs: this.rawElapsed(p.end) }));
  }
}
export const epochNow = () => performance.timeOrigin + performance.now();
