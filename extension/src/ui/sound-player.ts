import { soundSamples, type SoundCue, type SoundKind } from '../engine/sounds';

/**
 * Plays click/key cues during preview playback. Each tick schedules the cues in a short window
 * ahead of the playhead on a WebAudio clock; seeking or pausing resets the window.
 */
export function createSoundPlayer() {
  let context: AudioContext | undefined;
  const buffers = new Map<SoundKind, AudioBuffer>();
  let scheduledUntil = -Infinity;
  const buffer = (ctx: AudioContext, kind: SoundKind) => {
    let b = buffers.get(kind);
    if (!b) {
      const data = soundSamples(kind, ctx.sampleRate);
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.copyToChannel(new Float32Array(data), 0);
      buffers.set(kind, b);
    }
    return b;
  };
  return {
    /** Forget what was scheduled (after a seek, pause or edit). */
    reset() {
      scheduledUntil = -Infinity;
    },
    /** Schedule cues in [nowUs, nowUs + 150 ms] of output time at the given playback rate. */
    tick(cues: SoundCue[], nowUs: number, rate: number, volume: number) {
      if (!cues.length || volume <= 0) return;
      context ??= new AudioContext();
      if (context.state === 'suspended') void context.resume().catch(() => {});
      const ctx = context,
        horizon = nowUs + 150_000;
      // A jump backwards (loop or seek) restarts the window.
      if (nowUs < scheduledUntil - 200_000) scheduledUntil = -Infinity;
      const from = Math.max(nowUs, scheduledUntil);
      for (const cue of cues) {
        if (cue.atUs < from || cue.atUs >= horizon) continue;
        const source = ctx.createBufferSource(),
          gain = ctx.createGain();
        source.buffer = buffer(ctx, cue.kind);
        gain.gain.value = volume;
        source.connect(gain).connect(ctx.destination);
        source.start(ctx.currentTime + Math.max(0, (cue.atUs - nowUs) / 1_000_000 / rate));
      }
      scheduledUntil = horizon;
    },
    dispose() {
      void context?.close().catch(() => {});
      context = undefined;
      buffers.clear();
    },
  };
}
