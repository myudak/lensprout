import {
  Input,
  BlobSource,
  ALL_FORMATS,
  Output,
  WebMOutputFormat,
  StreamTarget,
  Conversion,
} from 'mediabunny';
import { mediaFile, mediaWriter, removeMedia } from '../storage/store';

/**
 * MediaRecorder WebM has no cues, so long recordings seek slowly. Copying the packets into a new
 * WebM writes cues and duration. Timestamps are kept (trim starts at 0). Failure keeps the original.
 */
export async function makeSeekable(mediaRef: string): Promise<string | null> {
  const name = mediaRef.replace(/\.webm$/, '') + '-seekable.webm';
  let input: Input | undefined, check: Input | undefined;
  try {
    const source = await mediaFile(mediaRef);
    input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
    const writer = await mediaWriter(name);
    const output = new Output({
      format: new WebMOutputFormat(),
      target: new StreamTarget(writer, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
    });
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start: 0 },
      showWarnings: false,
    });
    if (!conversion.isValid || conversion.discardedTracks.length) {
      await conversion.cancel().catch(() => {});
      throw new Error('Not remuxable.');
    }
    await conversion.execute();
    check = new Input({ source: new BlobSource(await mediaFile(name)), formats: ALL_FORMATS });
    const [before, after] = [await input.computeDuration(), await check.computeDuration()];
    if (Math.abs(before - after) > 0.25) throw new Error('Remuxed duration differs.');
    return name;
  } catch {
    await removeMedia(name).catch(() => {});
    return null;
  } finally {
    input?.dispose();
    check?.dispose();
  }
}
