import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { makeProject, SCHEMA, type Recording } from '../domain/model';
import { applyStyle, defaultPreset, loadPresets } from '../domain/presets';
import { mediaFile, mediaWriter, removeMedia, saveCompleted } from '../storage/store';
import { makeSeekable } from './seekable';

/** File types the import picker offers; decoding support is checked after reading the file. */
export const IMPORT_ACCEPT = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v,.mkv';

/**
 * Brings an existing video file into the library as a ready recording with a new project. There
 * is no input timeline, so the project starts without automatic zooms: zooms are added by hand,
 * and smart trim still works from the frames and audio. The file is copied into this origin's
 * private storage (OPFS); nothing is uploaded. Returns the new project's id.
 */
export async function importVideo(file: File): Promise<string> {
  const estimate = await navigator.storage.estimate().catch(() => undefined);
  if (estimate?.quota !== undefined && estimate.usage !== undefined)
    if (file.size > (estimate.quota - estimate.usage) * 0.9)
      throw new Error('Not enough browser storage for this video. Free some space and try again.');
  const id = crypto.randomUUID();
  const ext = /\.(\w{1,5})$/.exec(file.name)?.[1]?.toLowerCase() ?? 'mp4';
  let mediaRef = `${id}.${ext}`;
  const writer = await mediaWriter(mediaRef);
  try {
    await file.stream().pipeTo(writer);
  } catch (e) {
    await removeMedia(mediaRef).catch(() => {});
    throw e;
  }
  try {
    const input = new Input({
      source: new BlobSource(await mediaFile(mediaRef)),
      formats: ALL_FORMATS,
    });
    let width = 0,
      height = 0,
      durationUs = 0,
      hasAudio = false;
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new Error('This file has no video track.');
      if (!(await video.canDecode()))
        throw new Error('This browser cannot decode the video in this file. Try an H.264 MP4.');
      width = video.displayWidth;
      height = video.displayHeight;
      durationUs = Math.round((await input.computeDuration()) * 1_000_000);
      const audio = await input.getPrimaryAudioTrack();
      hasAudio = !!audio && (await audio.canDecode());
    } finally {
      input.dispose();
    }
    if (durationUs <= 0) throw new Error('This video has no frames.');
    // MediaRecorder-style WebM without cues seeks slowly; remux it like a fresh recording.
    if (ext === 'webm') {
      const seekable = await makeSeekable(mediaRef);
      if (seekable) {
        await removeMedia(mediaRef).catch(() => {});
        mediaRef = seekable;
      }
    }
    const recording: Recording = {
      id,
      schemaVersion: SCHEMA,
      name: file.name.replace(/\.\w{1,5}$/, '') || 'Imported video',
      createdAt: new Date().toISOString(),
      durationUs,
      rawDurationUs: durationUs,
      pauses: [],
      width,
      height,
      mediaRef,
      mimeType: file.type || `video/${ext}`,
      hasAudio,
      status: 'ready',
      geometry: [],
      source: 'file',
      pointerTracked: false,
    };
    let project = makeProject(recording);
    const preset = defaultPreset(
      await loadPresets().catch(() => ({ presets: [], defaultId: null })),
    );
    if (preset)
      try {
        project = applyStyle(project, preset.style, recording);
      } catch {
        /* An outdated or invalid preset never blocks the import. */
      }
    await saveCompleted(recording, project);
    return id;
  } catch (e) {
    await removeMedia(mediaRef).catch(() => {});
    throw e;
  }
}
