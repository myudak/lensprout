import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Recording } from '../domain/model';
import { logicalToRaw } from '../domain/time-map';
import { seconds } from '../domain/model';

/**
 * Decodes evenly spaced frames into one strip. `signal` aborts between frames so a resize or
 * unmount does not keep decoding a stale request.
 */
export async function filmstrip(
  file: Blob,
  recording: Recording,
  count: number,
  thumbHeight: number,
  signal: AbortSignal,
): Promise<HTMLCanvasElement | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || signal.aborted) return null;
    const thumbWidth = Math.round((thumbHeight * recording.width) / recording.height);
    const sink = new CanvasSink(track, {
      width: thumbWidth,
      height: thumbHeight,
      fit: 'cover',
      poolSize: 2,
    });
    const strip = document.createElement('canvas');
    strip.width = thumbWidth * count;
    strip.height = thumbHeight;
    const ctx = strip.getContext('2d')!;
    const times = Array.from({ length: count }, (_, i) =>
      seconds(logicalToRaw(recording, ((i + 0.5) / count) * recording.durationUs)),
    );
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (signal.aborted) return null;
      if (wrapped) ctx.drawImage(wrapped.canvas, i * thumbWidth, 0, thumbWidth, thumbHeight);
      i++;
    }
    return strip;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

export async function posterUrl(file: Blob, recording: Recording): Promise<string | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new CanvasSink(track, {
      width: 480,
      height: Math.round((480 * recording.height) / recording.width),
      fit: 'cover',
    });
    const at = seconds(logicalToRaw(recording, Math.min(recording.durationUs / 2, 1_500_000)));
    const frame = await sink.getCanvas(at);
    if (!frame) return null;
    const canvas = frame.canvas as HTMLCanvasElement | OffscreenCanvas;
    const blob =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
        : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
