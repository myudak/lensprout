import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import type { Recording } from '../domain/model';
import { mediaFile } from '../storage/store';

/**
 * Measurements for smart trim, in raw time: the mean absolute luminance difference between
 * frames sampled 4× per second at 160 px wide, and the audio RMS per 50 ms window (channel mix).
 */
export type AnalyzeRequest = { type: 'start'; recording: Recording } | { type: 'cancel' };
export type AnalyzeReply =
  | { type: 'progress'; progress: number }
  | {
      type: 'done';
      frames: { atUs: number; diff: number }[];
      windows: { atUs: number; rms: number }[] | null;
    }
  | { type: 'error'; error: string };

const FRAME_STEP_S = 0.25,
  WINDOW_S = 0.05,
  WIDTH = 160;
let cancelled = false;
const reply = (m: AnalyzeReply) => self.postMessage(m);

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }
  void analyze(e.data.recording).catch((error) =>
    reply({ type: 'error', error: error instanceof Error ? error.message : String(error) }),
  );
};

async function analyze(recording: Recording) {
  const input = new Input({
    source: new BlobSource(await mediaFile(recording.mediaRef)),
    formats: ALL_FORMATS,
  });
  try {
    const durationS = recording.rawDurationUs / 1_000_000;
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('This recording has no video track.');
    const height = Math.max(2, Math.round((WIDTH * recording.height) / recording.width));
    const canvas = new OffscreenCanvas(WIDTH, height),
      ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const times: number[] = [];
    for (let t = 0; t < durationS; t += FRAME_STEP_S) times.push(t);
    const frames: { atUs: number; diff: number }[] = [];
    let previous: Float32Array | null = null,
      index = 0;
    for await (const sample of new VideoSampleSink(video).samplesAtTimestamps(times)) {
      if (cancelled) throw new Error('Cancelled');
      const at = times[index++]!;
      if (!sample) continue;
      sample.draw(ctx, 0, 0, WIDTH, height);
      sample.close();
      const px = ctx.getImageData(0, 0, WIDTH, height).data,
        luma = new Float32Array(WIDTH * height);
      for (let i = 0; i < luma.length; i++)
        luma[i] = (0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!) / 255;
      let diff = 1;
      if (previous) {
        let sum = 0;
        for (let i = 0; i < luma.length; i++) sum += Math.abs(luma[i]! - previous[i]!);
        diff = sum / luma.length;
      }
      previous = luma;
      frames.push({ atUs: Math.round(at * 1_000_000), diff });
      if (index % 8 === 0) reply({ type: 'progress', progress: (0.7 * index) / times.length });
    }
    let windows: { atUs: number; rms: number }[] | null = null;
    const audio = recording.hasAudio ? await input.getPrimaryAudioTrack() : null;
    if (audio) {
      const count = Math.ceil(durationS / WINDOW_S),
        sums = new Float64Array(count),
        counts = new Uint32Array(count);
      for await (const sample of new AudioSampleSink(audio).samples()) {
        if (cancelled) throw new Error('Cancelled');
        const frames = sample.numberOfFrames,
          mixed = new Float32Array(frames),
          plane = new Float32Array(frames);
        for (let c = 0; c < sample.numberOfChannels; c++) {
          sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
          for (let i = 0; i < frames; i++) mixed[i]! += plane[i]! / sample.numberOfChannels;
        }
        for (let i = 0; i < frames; i++) {
          const w = Math.floor((sample.timestamp + i / sample.sampleRate) / WINDOW_S);
          if (w < 0 || w >= count) continue;
          sums[w]! += mixed[i]! * mixed[i]!;
          counts[w]!++;
        }
        reply({ type: 'progress', progress: 0.7 + (0.3 * sample.timestamp) / durationS });
        sample.close();
      }
      windows = Array.from(sums, (sum, i) => ({
        atUs: Math.round(i * WINDOW_S * 1_000_000),
        rms: counts[i] ? Math.sqrt(sum / counts[i]!) : 0,
      }));
    }
    reply({ type: 'done', frames, windows });
  } finally {
    input.dispose();
  }
}
