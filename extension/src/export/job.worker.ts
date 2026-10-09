import {
  ALL_FORMATS,
  BlobSource,
  Input,
  Output,
  Mp4OutputFormat,
  StreamTarget,
  Conversion,
  Quality,
  canEncodeVideo,
  canEncodeAudio,
  VideoSample,
  VideoSampleSink,
  AudioSample,
  AudioSampleSource,
  type InputVideoTrack,
} from 'mediabunny';
import { mixCues, soundCues, type SoundCue } from '../engine/sounds';
import { createEditMap, type EditMap } from '../domain/edit-map';
import { validateProject, seconds, us, type Recording } from '../domain/model';
import { createCamera } from '../engine/camera';
import { motionSamples, outputSize, renderFrame } from '../engine/render';
import { paintBackground } from '../engine/backgrounds';
import { createOverlays } from '../engine/effects';
import { needsStage } from '../engine/stage';
import { viewExtents } from '../domain/crop';
import { createStage, type Stage } from '../engine/stage-render';
import { keptRanges, logicalToRaw, rawToLogical } from '../domain/time-map';
import { loadBackgroundSource, mediaFile, mediaWriter, removeMedia } from '../storage/store';
import type { ExportRequest, ExportReply, GifOptions } from './protocol';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
let cancelled = false,
  running = false,
  conversion: Conversion | undefined;
const reply = (m: ExportReply) => self.postMessage(m);
self.onmessage = (e: MessageEvent<ExportRequest>) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    void conversion?.cancel();
    return;
  }
  if (running) return;
  running = true;
  void run(e.data).catch((error) =>
    reply(
      cancelled
        ? { type: 'cancelled' }
        : { type: 'error', error: error instanceof Error ? error.message : String(error) },
    ),
  );
};
/**
 * Forward-only webcam frames: output frames ask for non-decreasing raw times, so one decode pass
 * suffices. Returns the latest webcam frame at or before (raw − offsetUs). A decode failure drops
 * the webcam for the rest of the export rather than failing it.
 */
/**
 * Forward-only frames of a video track: callers ask for non-decreasing times, so one decode pass
 * suffices. `at(rawUs)` returns the latest frame at or before rawUs − offsetUs, drawn into a
 * canvas. A decode failure returns null from then on rather than failing the caller.
 */
function forwardReader(
  track: InputVideoTrack,
  width: number,
  height: number,
  rawStartUs: number,
  offsetUs = 0,
) {
  const iterator = new VideoSampleSink(track).samples(Math.max(0, seconds(rawStartUs - offsetUs)));
  const canvas = new OffscreenCanvas(width, height),
    ctx = canvas.getContext('2d')!;
  let current: VideoSample | null = null,
    next: VideoSample | null | undefined,
    drawn: VideoSample | null = null,
    broken = false;
  const pull = async () => {
    const r = await iterator.next();
    return r.done ? null : r.value;
  };
  return {
    async at(rawUs: number) {
      if (broken) return null;
      try {
        const t = seconds(rawUs - offsetUs);
        if (next === undefined) {
          current = await pull();
          next = current ? await pull() : null;
        }
        while (next && next.timestamp <= t) {
          current?.close();
          current = next;
          next = await pull();
        }
        if (!current) return null;
        if (drawn !== current) {
          if (canvas.width !== current.displayWidth || canvas.height !== current.displayHeight) {
            canvas.width = current.displayWidth;
            canvas.height = current.displayHeight;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          current.draw(ctx, 0, 0, canvas.width, canvas.height);
          drawn = current;
        }
        return { source: canvas, width: canvas.width, height: canvas.height };
      } catch {
        broken = true;
        return null;
      }
    },
    async dispose() {
      current?.close();
      next?.close();
      await iterator.return(undefined).catch(() => {});
    },
  };
}

/** The webcam file's frames at (raw − offsetUs); null when the recording has no usable webcam. */
async function webcamReader(recording: Recording, rawStartUs: number) {
  const info = recording.camera;
  if (!info) return null;
  const file = await mediaFile(info.mediaRef).catch(() => null);
  if (!file) return null;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack().catch(() => null);
  if (!track || !(await track.canDecode().catch(() => false))) {
    input.dispose();
    return null;
  }
  const reader = forwardReader(track, info.width, info.height, rawStartUs, info.offsetUs);
  return {
    at: reader.at,
    async dispose() {
      await reader.dispose();
      input.dispose();
    },
  };
}

/**
 * Animated GIF: every output frame on the GIF fps grid goes through the same edit map and
 * renderer as MP4, then a per-frame 256-color palette (gifenc). No audio.
 */
async function runGif(job: Extract<ExportRequest, { type: 'start' }>, gif: GifOptions) {
  const { project, recording, events, outputName } = job;
  validateProject(project, recording);
  let input: Input | undefined,
    webcam: Awaited<ReturnType<typeof webcamReader>> = null,
    frames: ReturnType<typeof forwardReader> | null = null,
    stage: Stage | null = null,
    completed = false;
  try {
    const out = outputSize(project, recording),
      width = Math.max(2, Math.round(Math.min(gif.width, out.width) / 2) * 2),
      height = Math.max(2, Math.round((width * out.height) / out.width / 2) * 2);
    input = new Input({
      source: new BlobSource(await mediaFile(recording.mediaRef)),
      formats: ALL_FORMATS,
    });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode()))
      throw new Error('This recording cannot be decoded for GIF export.');
    const camera = createCamera(
        project,
        events,
        undefined,
        viewExtents(project, recording.width, recording.height),
      ),
      overlays = createOverlays(events, project.composition.crop, recording.geometry),
      edit = createEditMap(project),
      frameUs = 1_000_000 / gif.fps,
      canvas = new OffscreenCanvas(width, height),
      ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const bg = project.composition.background,
      image = await loadBackgroundSource(bg).catch(() => null),
      background = paintBackground(bg, width, height, image);
    image?.close();
    const rawStart = logicalToRaw(recording, project.trim.startUs);
    frames = forwardReader(track, recording.width, recording.height, rawStart);
    webcam = await webcamReader(recording, rawStart);
    stage = needsStage(project) ? createStage() : null;
    const encoder = GIFEncoder(),
      total = Math.max(1, Math.ceil(edit.durationUs / frameUs)),
      delay = Math.round(1000 / gif.fps);
    for (let k = 0; k < total; k++) {
      if (cancelled) throw new Error('Cancelled');
      const logicalAt = Math.round(edit.toLogical(k * frameUs)),
        rawAt = logicalToRaw(recording, logicalAt);
      const frame = await frames.at(rawAt);
      if (!frame) throw new Error('A video frame could not be decoded for GIF export.');
      renderFrame(ctx, {
        source: frame.source,
        sourceWidth: frame.width,
        sourceHeight: frame.height,
        cameras: motionSamples(camera, logicalAt, gif.fps, project.effects.motionBlur),
        project,
        width,
        height,
        background,
        overlays,
        atUs: logicalAt,
        webcam: webcam ? await webcam.at(rawAt) : null,
        hasWebcam: !!recording.camera,
        stage,
      });
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const palette = quantize(rgba, 256),
        index = applyPalette(rgba, palette);
      // repeat: 0 loops forever, −1 plays once (only the first frame's value is used).
      encoder.writeFrame(index, width, height, { palette, delay, repeat: gif.loop ? 0 : -1 });
      if (k % 4 === 0) reply({ type: 'progress', progress: k / total });
    }
    encoder.finish();
    const writer = await mediaWriter(outputName);
    try {
      await writer.write(new Uint8Array(encoder.bytes()));
      await writer.close();
    } catch (e) {
      await writer.abort().catch(() => {});
      throw e;
    }
    completed = true;
    reply({ type: 'done', name: outputName });
  } finally {
    if (!completed) await removeMedia(outputName).catch(() => {});
    await frames?.dispose();
    await webcam?.dispose();
    stage?.gl.dispose();
    input?.dispose();
    running = false;
  }
}

async function run(job: Extract<ExportRequest, { type: 'start' }>) {
  if (job.gif) return runGif(job, job.gif);
  const { project, recording, events, outputName } = job;
  validateProject(project, recording);
  let input: Input | undefined,
    webcam: Awaited<ReturnType<typeof webcamReader>> = null,
    stage: Stage | null = null,
    writer: FileSystemWritableFileStream | undefined,
    output: Output | undefined,
    completed = false;
  try {
    const { width, height } = outputSize(project, recording),
      fps = project.output.fps;
    if (!(await canEncodeVideo('avc', { width, height, frameRate: fps })))
      throw new Error(
        `H.264 encoding is unavailable at ${width}×${height}, ${fps} fps. Try a lower resolution or 30 fps.`,
      );
    input = new Input({
      source: new BlobSource(await mediaFile(recording.mediaRef)),
      formats: ALL_FORMATS,
    });
    const audio = await input.getPrimaryAudioTrack();
    const cues = soundCues(project, events, createEditMap(project)),
      volume = project.effects.sounds.volume;
    if (
      (audio || cues.length) &&
      !(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 }))
    )
      throw new Error(
        audio
          ? 'AAC audio encoding is unavailable in this browser. This recording contains audio; export cannot preserve it here.'
          : 'AAC audio encoding is unavailable in this browser, so click and key sounds cannot be exported.',
      );
    // Without a source audio track, sounds need their own track: the conversion then only drives
    // the video track (composable), and this worker drives the audio and the output lifecycle.
    const ownAudio = !audio && cues.length > 0;
    if (cancelled) throw new Error('Cancelled');
    writer = await mediaWriter(outputName);
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(writer, { chunked: true, chunkSize: 2 * 1024 * 1024 }),
    });
    const camera = createCamera(
        project,
        events,
        undefined,
        viewExtents(project, recording.width, recording.height),
      ),
      overlays = createOverlays(events, project.composition.crop, recording.geometry),
      edit = createEditMap(project),
      frameUs = 1_000_000 / fps,
      canvas = new OffscreenCanvas(width, height),
      ctx = canvas.getContext('2d')!;
    const bg = project.composition.background,
      image = await loadBackgroundSource(bg).catch(() => null),
      background = paintBackground(bg, width, height, image);
    image?.close();
    const source = new OffscreenCanvas(recording.width, recording.height),
      sourceCtx = source.getContext('2d')!;
    const rawStart = logicalToRaw(recording, project.trim.startUs),
      rawEnd = logicalToRaw(recording, project.trim.endUs),
      ranges = keptRanges(recording, rawStart, rawEnd);
    webcam = await webcamReader(recording, rawStart);
    // Without WebGL2 the preview renders flat as well, so the export still matches it.
    stage = needsStage(project) ? createStage() : null;
    conversion = await Conversion.init({
      input,
      output,
      composable: ownAudio,
      trim: { start: seconds(rawStart), end: seconds(rawEnd) },
      video: {
        codec: 'avc',
        quality: new Quality('high'),
        frameRate: fps,
        forceTranscode: true,
        processedWidth: width,
        processedHeight: height,
        async process(sample) {
          if (cancelled) throw new Error('Cancelled');
          // Conversion has shifted sample timestamps into output time before this callback.
          const rawAt = rawStart + us(sample.timestamp),
            range = ranges.find((r) => r.startUs <= rawAt && rawAt < r.endUs);
          if (!range) return null;
          const l0 = rawToLogical(recording, rawAt),
            l1 = l0 + Math.min(us(sample.duration), range.endUs - rawAt);
          // Output frames lie on the fps grid of edit time. A source frame covering [l0, l1) yields
          // every grid frame whose logical time falls inside it: none in cuts, several when slowed.
          const grid: number[] = [];
          for (const piece of edit.pieces) {
            if (piece.endUs <= l0) continue;
            if (piece.startUs >= l1) break;
            const a = Math.max(l0, piece.startUs),
              b = Math.min(l1, piece.endUs),
              oa = piece.outStartUs + (a - piece.startUs) / piece.speed,
              ob = piece.outStartUs + (b - piece.startUs) / piece.speed;
            for (let k = Math.ceil(oa / frameUs - 1e-6); k * frameUs < ob - 1e-3; k++) grid.push(k);
          }
          if (!grid.length) return null;
          if (source.width !== sample.displayWidth || source.height !== sample.displayHeight) {
            source.width = sample.displayWidth;
            source.height = sample.displayHeight;
          }
          sourceCtx.clearRect(0, 0, source.width, source.height);
          sample.draw(sourceCtx, 0, 0, source.width, source.height);
          const frames: VideoSample[] = [];
          for (const k of grid) {
            const logicalAt = Math.max(l0, Math.min(l1 - 1, edit.toLogical(k * frameUs)));
            const face = webcam ? await webcam.at(logicalToRaw(recording, logicalAt)) : null;
            renderFrame(ctx, {
              source,
              sourceWidth: source.width,
              sourceHeight: source.height,
              cameras: motionSamples(camera, logicalAt, fps, project.effects.motionBlur),
              project,
              width,
              height,
              background,
              overlays,
              atUs: logicalAt,
              webcam: face,
              hasWebcam: !!recording.camera,
              stage,
            });
            frames.push(
              new VideoSample(canvas, {
                timestamp: (k * frameUs) / 1_000_000,
                duration: 1 / fps,
              }),
            );
          }
          return frames;
        },
      },
      audio: {
        codec: 'aac',
        quality: new Quality('high'),
        numberOfChannels: 2,
        sampleRate: 48000,
        forceTranscode: true,
        process(sample) {
          const start = rawStart + us(sample.timestamp),
            end = start + us(sample.duration),
            out: AudioSample[] = [];
          for (const r of ranges) {
            if (r.startUs >= end || r.endUs <= start) continue;
            // Inside one kept raw range, raw = logical + offset.
            const offset = r.startUs - rawToLogical(recording, r.startUs),
              la = Math.max(start, r.startUs) - offset,
              lb = Math.min(end, r.endUs) - offset;
            for (const piece of edit.pieces) {
              if (piece.endUs <= la) continue;
              if (piece.startUs >= lb) break;
              const a = Math.max(la, piece.startUs),
                b = Math.min(lb, piece.endUs),
                first = Math.max(0, Math.ceil(seconds(a + offset - start) * sample.sampleRate)),
                last = Math.min(
                  sample.numberOfFrames,
                  Math.floor(seconds(b + offset - start) * sample.sampleRate),
                );
              if (first >= last) continue;
              const at = seconds(piece.outStartUs + (a - piece.startUs) / piece.speed);
              if (piece.speed === 1 && piece.volume === 1) {
                const part = sample.trim(first, last);
                part.setTimestamp(at);
                out.push(part);
              } else out.push(retime(sample, first, last, piece, at));
            }
          }
          return cues.length ? out.map((s) => withSounds(s, cues, volume)) : out;
        },
      },
      showWarnings: false,
    });
    const soundTrack = ownAudio
      ? new AudioSampleSource({ codec: 'aac', bitrate: new Quality('high') })
      : null;
    if (soundTrack) output.addAudioTrack(soundTrack);
    if (
      !conversion.isValid ||
      conversion.discardedTracks.some((t) => t.track.type === 'video' || t.track.type === 'audio')
    )
      throw new Error(
        `This recording cannot be decoded and exported: ${conversion.discardedTracks.map((t) => t.reason).join(', ')}`,
      );
    conversion.onProgress = (progress) => reply({ type: 'progress', progress });
    if (cancelled) {
      await conversion.cancel();
      throw new Error('Cancelled');
    }
    // StreamTarget finalization closes its writable (including the OPFS writer).
    if (soundTrack) {
      await output.start();
      await Promise.all([
        conversion.execute(),
        feedSounds(soundTrack, cues, volume, edit.durationUs).then(() => soundTrack.close()),
      ]);
      await output.finalize();
    } else await conversion.execute();
    writer = undefined;
    if (cancelled) throw new Error('Cancelled');
    completed = true;
    reply({ type: 'done', name: outputName });
  } finally {
    if (!completed) {
      await conversion?.cancel().catch(() => {});
      await output?.cancel().catch(() => {});
      await writer?.abort().catch(() => {});
      await removeMedia(outputName).catch(() => {});
    }
    input?.dispose();
    await webcam?.dispose();
    stage?.gl.dispose();
    conversion = undefined;
    running = false;
  }
}

/** Mixes sound cues into one output audio sample (timestamps are output time). */
function withSounds(sample: AudioSample, cues: SoundCue[], volume: number) {
  const channels = Array.from({ length: sample.numberOfChannels }, (_, c) => {
    const data = new Float32Array(sample.numberOfFrames);
    sample.copyTo(data, { planeIndex: c, format: 'f32-planar' });
    return data;
  });
  mixCues(channels, sample.sampleRate, us(sample.timestamp), cues, volume);
  const data = new Float32Array(sample.numberOfFrames * channels.length);
  channels.forEach((c, i) => data.set(c, i * sample.numberOfFrames));
  const mixed = new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: sample.numberOfChannels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  });
  sample.close();
  return mixed;
}

/** A silent stereo track carrying only the sound cues, in half-second blocks. */
async function feedSounds(
  source: AudioSampleSource,
  cues: SoundCue[],
  volume: number,
  durationUs: number,
) {
  const rate = 48000,
    block = rate / 2;
  for (let frame = 0; (frame / rate) * 1_000_000 < durationUs; frame += block) {
    if (cancelled) throw new Error('Cancelled');
    const frames = Math.min(block, Math.ceil((durationUs / 1_000_000) * rate - frame));
    if (frames <= 0) break;
    const left = new Float32Array(frames),
      right = new Float32Array(frames);
    mixCues([left, right], rate, (frame / rate) * 1_000_000, cues, volume);
    const data = new Float32Array(frames * 2);
    data.set(left, 0);
    data.set(right, frames);
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate: rate,
      timestamp: frame / rate,
    });
    await source.add(sample);
    sample.close();
  }
}

/**
 * Speed changes resample linearly (pitch follows speed, like tape) and volume scales samples.
 * Data is copied as f32-planar so any decoder format works.
 */
function retime(
  sample: AudioSample,
  first: number,
  last: number,
  piece: EditMap['pieces'][number],
  timestamp: number,
) {
  const channels = sample.numberOfChannels,
    frames = last - first,
    outFrames = Math.max(1, Math.round(frames / piece.speed)),
    data = new Float32Array(outFrames * channels),
    source = new Float32Array(frames);
  for (let c = 0; c < channels; c++) {
    sample.copyTo(source, {
      planeIndex: c,
      format: 'f32-planar',
      frameOffset: first,
      frameCount: frames,
    });
    for (let i = 0; i < outFrames; i++) {
      const position = i * piece.speed,
        j = Math.min(frames - 1, Math.floor(position)),
        f = position - j;
      data[c * outFrames + i] =
        (source[j]! * (1 - f) + source[Math.min(frames - 1, j + 1)]! * f) * piece.volume;
    }
  }
  return new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: channels,
    sampleRate: sample.sampleRate,
    timestamp,
  });
}
