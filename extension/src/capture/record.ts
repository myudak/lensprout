import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import {
  clamp,
  makeProject,
  SCHEMA,
  CURSOR_STYLES,
  type CursorStyle,
  type CaptureMode,
  type InputEvent,
  type Recording,
  type Session,
  type Message,
} from '../domain/model';
import { SessionClock, epochNow } from './clock';
import { mapEvent, pickDisplay, viewportRect, type Surface } from './mapping';
import {
  saveRecording,
  saveCompleted,
  saveEvents,
  mediaWriter,
  mediaFile,
  removeMedia,
} from '../storage/store';
import { planZooms } from '../engine/planner';
import { applyStyle, defaultPreset, loadPresets } from '../domain/presets';
import { rawToLogical } from '../domain/time-map';
import { makeSeekable } from './seekable';

export async function request(message: Message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? 'Extension controller did not respond.');
  return response.value;
}

// Max-only limits make Chrome letterbox into the max aspect ratio. A min/max pair with different
// aspect ratios selects its "any size within limits" policy, so frames follow the source size.
const LIMITS = { minWidth: 16, minHeight: 16, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60 };

/** The user closed Chrome's screen picker; the session stays usable. */
export class CancelledError extends Error {}

function chooseDesktop(): Promise<{ streamId: string; audio: boolean }> {
  if (!chrome.desktopCapture)
    return Promise.reject(
      new Error(
        'Screen capture permission is missing. Reload Lensprout in chrome://extensions (or use the Reload extension button above).',
      ),
    );
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'audio'], (streamId, options) => {
      if (!streamId) reject(new CancelledError('Screen selection was cancelled.'));
      else resolve({ streamId, audio: !!options?.canRequestAudioTrack });
    });
  });
}

async function acquire(s: Session, mode: CaptureMode, audio: boolean) {
  // The picker runs before the controller marks the session, so cancelling can simply be retried.
  const picked = mode === 'screen' ? await chooseDesktop() : undefined;
  const granted = await request({ type: 'capture', sessionId: s.id, audio, mode });
  if (mode === 'tab') {
    const mandatory = { chromeMediaSource: 'tab', chromeMediaSourceId: granted.streamId };
    // Chrome scales tab capture up to the max size; cap it at the page's device pixels so frames
    // are not upscaled (a 1280×800 tab was captured at 2560×1600 with only the generic limits).
    const viewport = granted.viewport as { width: number; height: number } | undefined;
    const limits =
      viewport?.width && viewport.height
        ? {
            ...LIMITS,
            maxWidth: Math.min(LIMITS.maxWidth, viewport.width),
            maxHeight: Math.min(LIMITS.maxHeight, viewport.height),
          }
        : LIMITS;
    return navigator.mediaDevices.getUserMedia({
      video: { mandatory: { ...mandatory, ...limits } } as MediaTrackConstraints,
      audio: audio ? ({ mandatory } as MediaTrackConstraints) : false,
    });
  }
  const mandatory = { chromeMediaSource: 'desktop', chromeMediaSourceId: picked!.streamId };
  return navigator.mediaDevices.getUserMedia({
    video: { mandatory: { ...mandatory, ...LIMITS } } as MediaTrackConstraints,
    audio: audio && picked!.audio ? ({ mandatory } as MediaTrackConstraints) : false,
  });
}

async function surfaceFor(mode: CaptureMode, track: MediaStreamTrack): Promise<Surface | null> {
  if (mode === 'tab') return { kind: 'tab' };
  const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
  const frame = { width: settings.width ?? 0, height: settings.height ?? 0 };
  if (settings.displaySurface === 'window') return { kind: 'window' };
  const displays = (await chrome.system.display.getInfo()).map((d) => d.bounds);
  const current = await chrome.windows.getCurrent();
  const display = pickDisplay(displays, frame, {
    x: (current.left ?? 0) + (current.width ?? 0) / 2,
    y: (current.top ?? 0) + (current.height ?? 0) / 2,
  });
  if (display) return { kind: 'monitor', bounds: display };
  // Unknown surface with no matching display: a window is the remaining possibility.
  return settings.displaySurface === 'monitor' ? null : { kind: 'window' };
}

export type RecorderStatus = 'finalizing';

export type RecordOptions = {
  audio: boolean;
  mode: CaptureMode;
  /** Mixed into the recorded audio track; never played back. */
  mic?: { deviceId: string; gain: number; noiseSuppression: boolean };
  /** Recorded to a second file and composited by the editor. */
  camera?: { deviceId: string };
  /** Seconds shown on the page before recording starts; 0 = off. */
  countdown?: number;
};

const device = (id: string) => (id && id !== 'default' ? { deviceId: { exact: id } } : {});

/** Opens the microphone and webcam before the screen so a refused device fails fast. */
async function openDevices(options: RecordOptions) {
  let mic: MediaStream | undefined, camera: MediaStream | undefined;
  try {
    if (options.mic) {
      const clean = options.mic.noiseSuppression;
      mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...device(options.mic.deviceId),
          noiseSuppression: clean,
          echoCancellation: clean,
          autoGainControl: clean,
        },
      });
    }
    if (options.camera)
      camera = await navigator.mediaDevices.getUserMedia({
        video: {
          ...device(options.camera.deviceId),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
  } catch (e) {
    [mic, camera].forEach((m) => m?.getTracks().forEach((t) => t.stop()));
    const what =
      options.camera && options.mic
        ? 'microphone or camera'
        : options.mic
          ? 'microphone'
          : 'camera';
    throw new Error(
      `Could not open the ${what} (${e instanceof Error ? e.name || e.message : String(e)}). Allow it in Chrome's site settings for Lensprout or choose None.`,
    );
  }
  return { mic, camera };
}

/** The webcam's own MediaRecorder; its file is aligned to the main one by start epochs. */
async function webcamRecorder(stream: MediaStream, mediaRef: string) {
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
  if (!mimeType) throw new Error('This browser cannot record the webcam as WebM.');
  const writer = await mediaWriter(mediaRef);
  let writes = Promise.resolve(),
    error: unknown,
    started = false;
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  } catch (e) {
    await writer.abort().catch(() => {});
    await removeMedia(mediaRef).catch(() => {});
    throw e;
  }
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size)
      writes = writes
        .then(() => writer.write(e.data))
        .catch((err) => {
          error ??= err;
        });
  });
  recorder.addEventListener('error', () => {
    error ??= new Error('The webcam recorder failed.');
  });
  const stopped = new Promise<void>((resolve) =>
    recorder.addEventListener('stop', () => resolve(), { once: true }),
  );
  return {
    /** Returns the epoch taken just before start(), like the main recorder (D19). */
    start() {
      const epochMs = epochNow();
      recorder.start(1000);
      started = true;
      return epochMs;
    },
    /** Stops and closes the file; false means the webcam file is unusable. */
    async finish() {
      if (recorder.state !== 'inactive') recorder.stop();
      if (started) await stopped;
      await writes;
      if (error || !started) {
        await writer.abort().catch(() => {});
        await removeMedia(mediaRef).catch(() => {});
        return false;
      }
      await writer.close();
      return true;
    },
    async abort() {
      if (recorder.state !== 'inactive') recorder.stop();
      await writer.abort().catch(() => {});
      await removeMedia(mediaRef).catch(() => {});
    },
  };
}

/** Reads the finished webcam file, makes it seekable and describes it; undefined drops the webcam. */
async function finalizeWebcam(mediaRef: string, offsetUs: number): Promise<Recording['camera']> {
  let width = 0,
    height = 0;
  const media = new Input({
    source: new BlobSource(await mediaFile(mediaRef)),
    formats: ALL_FORMATS,
  });
  try {
    const video = await media.getPrimaryVideoTrack();
    width = video?.displayWidth ?? 0;
    height = video?.displayHeight ?? 0;
    if (!width || !height || (await media.computeDuration()) <= 0) return undefined;
  } catch {
    return undefined;
  } finally {
    media.dispose();
  }
  const seekable = await makeSeekable(mediaRef);
  if (seekable) await removeMedia(mediaRef).catch(() => {});
  return { mediaRef: seekable ?? mediaRef, width, height, offsetUs };
}

export async function startRecording(
  s: Session,
  options: RecordOptions,
  onStopped: (id: string) => void,
  onFailure: (error: string) => void,
  onStatus: (status: RecorderStatus) => void = () => {},
) {
  const { mode } = options;
  const devices = await openDevices(options);
  const deviceTracks = () => [
    ...(devices.mic?.getTracks() ?? []),
    ...(devices.camera?.getTracks() ?? []),
  ];
  let stream: MediaStream;
  try {
    stream = await acquire(s, mode, options.audio);
  } catch (e) {
    deviceTracks().forEach((t) => t.stop());
    throw e;
  }
  const track = stream.getVideoTracks()[0]!;
  let audioContext: AudioContext | undefined;
  let surface: Surface | null;
  // What the main recorder encodes: the captured stream, or its video plus a mixed audio track.
  let recorded = stream;
  const abandon = async () => {
    [...stream.getTracks(), ...recorded.getTracks(), ...deviceTracks()].forEach((t) => t.stop());
    await audioContext?.close().catch(() => {});
  };
  try {
    surface = await surfaceFor(mode, track);
    const captured = stream.getAudioTracks();
    const playback = mode === 'tab' && options.audio && captured.length > 0;
    if (playback || devices.mic) {
      audioContext = new AudioContext();
      const mix = devices.mic ? audioContext.createMediaStreamDestination() : undefined;
      if (captured.length) {
        const source = audioContext.createMediaStreamSource(new MediaStream(captured));
        // Tab capture redirects the tab's sound into the stream; play it back so the user still hears it.
        if (playback) source.connect(audioContext.destination);
        if (mix) source.connect(mix);
      }
      if (mix && devices.mic) {
        // The microphone only feeds the mix, never the speakers.
        const gain = audioContext.createGain();
        gain.gain.value = clamp(options.mic?.gain ?? 1, 0, 4);
        audioContext.createMediaStreamSource(devices.mic).connect(gain).connect(mix);
        recorded = new MediaStream([track, ...mix.stream.getAudioTracks()]);
      }
      await audioContext.resume();
    }
  } catch (e) {
    await abandon();
    throw e;
  }
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
    (m) => MediaRecorder.isTypeSupported(m),
  );
  if (!mimeType) {
    await abandon();
    throw new Error('This browser cannot record WebM.');
  }
  if (options.countdown && options.countdown > 0) {
    let result: { cancelled?: boolean } | undefined;
    try {
      // The countdown is drawn on the page being recorded, so show that page first.
      const back = s.sourceTabId ?? s.returnTabId;
      if (back !== undefined) await chrome.tabs.update(back, { active: true }).catch(() => {});
      result = await request({ type: 'countdown', sessionId: s.id, seconds: options.countdown });
    } catch (e) {
      await abandon();
      throw e;
    }
    if (result?.cancelled) {
      await abandon();
      throw new CancelledError('The countdown was cancelled.');
    }
  }
  const settings = track.getSettings();
  // Frame size can change (tab resize, window resize); a detached element tracks the current one.
  const probe = document.createElement('video');
  probe.muted = true;
  probe.srcObject = new MediaStream([track]);
  void probe.play().catch(() => {});
  const frame = () => ({
    width: probe.videoWidth || settings.width || 1280,
    height: probe.videoHeight || settings.height || 720,
  });
  const recording: Recording = {
    id: s.id,
    schemaVersion: SCHEMA,
    name: (mode === 'tab'
      ? s.sourceTitle
      : `Screen recording · ${new Date().toLocaleString()}`
    ).slice(0, 200),
    createdAt: new Date().toISOString(),
    durationUs: 0,
    rawDurationUs: 0,
    pauses: [],
    width: settings.width ?? 1280,
    height: settings.height ?? 720,
    mediaRef: `recording-${s.id}.webm`,
    mimeType,
    hasAudio: !!recorded.getAudioTracks().length,
    status: 'capturing',
    geometry: [],
    source: mode === 'tab' ? 'tab' : surface?.kind === 'window' ? 'window' : 'monitor',
    pointerTracked: !!surface,
  };
  const releaseStream = () => {
    [...stream.getTracks(), ...recorded.getTracks(), ...deviceTracks()].forEach((t) => t.stop());
    probe.srcObject = null;
  };
  let writer: FileSystemWritableFileStream;
  try {
    writer = await mediaWriter(recording.mediaRef);
    await saveRecording(recording);
  } catch (e) {
    releaseStream();
    void audioContext?.close();
    await removeMedia(recording.mediaRef).catch(() => {});
    throw e;
  }
  let recorder: MediaRecorder;
  let webcam: Awaited<ReturnType<typeof webcamRecorder>> | undefined,
    webcamEpoch: number | undefined;
  const webcamRef = `webcam-${s.id}.webm`;
  try {
    const fps = settings.frameRate ?? 30,
      bits = Math.round(clamp(recording.width * recording.height * fps * 0.1, 6e6, 30e6));
    recorder = new MediaRecorder(recorded, { mimeType, videoBitsPerSecond: bits });
    if (devices.camera) webcam = await webcamRecorder(devices.camera, webcamRef);
  } catch (e) {
    await writer.abort().catch(() => {});
    releaseStream();
    await audioContext?.close();
    recording.status = 'incomplete';
    await saveRecording(recording);
    throw e;
  }
  let clock: SessionClock,
    writes = Promise.resolve(),
    failed: Error | undefined,
    sequence = 0,
    batch = 0,
    paused = false;
  const events: InputEvent[] = [],
    pending: InputEvent[] = [],
    viewports = new Map<string, number>();
  const flush = async () => {
    if (pending.length) await saveEvents(s.id, batch++, pending.splice(0));
  };
  let flushing = Promise.resolve();
  const interval = setInterval(() => {
    flushing = flushing.then(flush).catch(fail);
  }, 1000);
  const limit = setTimeout(() => stop(), 30 * 60_000);
  function fail(error: unknown) {
    failed ??= error instanceof Error ? error : new Error(String(error));
    onFailure(failed.message);
    stop();
  }
  function input(message: Message) {
    if (
      message.type !== 'input' ||
      message.sessionId !== s.id ||
      !clock ||
      !surface ||
      recorder.state !== 'recording'
    )
      return;
    const e = message.event,
      atUs = clock.at(e.epochMs);
    if (atUs === null) return;
    const mapped = mapEvent(surface, e, frame());
    if (!mapped) return;
    const viewport = viewportRect(surface, e, frame());
    if (viewport) {
      const key = JSON.stringify(viewport);
      viewports.set(key, (viewports.get(key) ?? 0) + 1);
    }
    if (!recording.geometry.some((g) => g.id === mapped.geometry.id))
      recording.geometry.push({ ...mapped.geometry, atUs });
    const normalized: InputEvent = {
      id: `${s.id}:${sequence++}`,
      atUs,
      kind: e.kind,
      point: mapped.point,
      geometryId: mapped.geometry.id,
      ...(e.kind === 'chord' && typeof e.keys === 'string' ? { keys: e.keys.slice(0, 60) } : {}),
      ...(e.kind.startsWith('pointer') && CURSOR_STYLES.includes(e.cursor as CursorStyle)
        ? { cursor: e.cursor }
        : {}),
    };
    events.push(normalized);
    pending.push(normalized);
  }
  chrome.runtime.onMessage.addListener(input);
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size) writes = writes.then(() => writer.write(e.data)).catch(fail);
  });
  recorder.addEventListener('error', () => fail(new Error('The media recorder failed.')));
  function stop() {
    if (recorder.state !== 'inactive') recorder.stop();
  }
  stream.getVideoTracks().forEach((t) => t.addEventListener('ended', stop, { once: true }));
  recorder.addEventListener('stop', () => {
    void (async () => {
      clearInterval(interval);
      clearTimeout(limit);
      chrome.runtime.onMessage.removeListener(input);
      onStatus('finalizing');
      const stopped = epochNow(),
        elapsed = clock?.rawElapsed(stopped) ?? 0;
      recording.pauses = clock?.pauseIntervals(stopped) ?? [];
      // A broken webcam file never costs the screen recording.
      const webcamOk = (await webcam?.finish().catch(() => false)) ?? false;
      releaseStream();
      await audioContext?.close();
      await writes;
      await flushing;
      await flush();
      await writer.close();
      if (failed) throw failed;
      const file = await mediaFile(recording.mediaRef);
      const media = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      try {
        recording.rawDurationUs = Math.min(
          elapsed,
          Math.round((await media.computeDuration()) * 1_000_000),
        );
        // Track settings can report the constraint maximum before frames flow; the file is truth.
        const video = await media.getPrimaryVideoTrack();
        if (video?.displayWidth && video.displayHeight) {
          recording.width = video.displayWidth;
          recording.height = video.displayHeight;
        }
      } finally {
        media.dispose();
      }
      recording.pauses = recording.pauses
        .map((p) => ({
          startUs: Math.min(p.startUs, recording.rawDurationUs),
          endUs: Math.min(p.endUs, recording.rawDurationUs),
        }))
        .filter((p) => p.startUs < p.endUs);
      recording.durationUs = rawToLogical(recording, recording.rawDurationUs);
      if (recording.durationUs <= 0) throw new Error('No video frames were recorded.');
      const original = recording.mediaRef,
        seekable = await makeSeekable(recording.mediaRef);
      if (seekable) recording.mediaRef = seekable;
      if (webcamOk && webcamEpoch !== undefined && clock) {
        const camera = await finalizeWebcam(
          webcamRef,
          Math.round((webcamEpoch - clock.startedEpochMs) * 1000),
        ).catch(() => undefined);
        if (camera) recording.camera = camera;
        else await removeMedia(webcamRef).catch(() => {});
      }
      if (viewports.size)
        recording.viewports = [...viewports]
          .map(([key, count]) => ({ rect: JSON.parse(key), count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);
      recording.status = 'ready';
      let project = makeProject(recording);
      // The default style preset, when set, shapes new projects (and their automatic zooms).
      const preset = defaultPreset(
        await loadPresets().catch(() => ({ presets: [], defaultId: null })),
      );
      if (preset)
        try {
          project = applyStyle(project, preset.style, recording);
        } catch {
          /* An outdated or invalid preset never blocks saving the recording. */
        }
      project.zooms = planZooms(events, recording.durationUs, {
        offset: project.autoZoom.offset,
        move: project.stage.defaultMove,
        depth: project.autoZoom.depth,
        typing: project.autoZoom.typing,
        geometry: recording.geometry,
      });
      await saveCompleted(recording, project);
      if (seekable) await removeMedia(original).catch(() => {});
      await request({ type: 'end-session', sessionId: s.id });
      onStopped(s.id);
    })().catch(async (e) => {
      recording.status = 'incomplete';
      await saveRecording(recording).catch(() => {});
      await writer.close().catch(() => {});
      await webcam?.abort();
      await request({ type: 'end-session', sessionId: s.id }).catch(() => {});
      onFailure(String(e instanceof Error ? e.message : e));
    });
  });
  try {
    // Wake the source compositor before waiting for the recorder's first encoded data.
    if (mode === 'tab' && s.sourceTabId !== undefined)
      await chrome.tabs.update(s.sourceTabId, { active: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The video encoder did not start within 15 seconds.')),
        15000,
      );
      recorder.addEventListener(
        'start',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      recorder.addEventListener(
        'error',
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
        { once: true },
      );
      // The epoch precedes start(); the start event can arrive late (see DECISIONS D19).
      clock = new SessionClock(epochNow());
      recorder.start(1000);
      // Started back to back, so the two files differ by the gap between their epochs.
      webcamEpoch = webcam?.start();
    });
  } catch (e) {
    failed ??= e instanceof Error ? e : new Error(String(e));
    stop();
    clearInterval(interval);
    clearTimeout(limit);
    chrome.runtime.onMessage.removeListener(input);
    releaseStream();
    await audioContext?.close().catch(() => {});
    await writer.abort().catch(() => {});
    await webcam?.abort();
    recording.status = 'incomplete';
    await saveRecording(recording).catch(() => {});
    throw e;
  }
  try {
    await request({ type: 'session-state', sessionId: s.id, status: 'recording' });
    const back = s.sourceTabId ?? s.returnTabId;
    if (back !== undefined) await chrome.tabs.update(back, { active: true }).catch(() => {});
  } catch (e) {
    fail(e);
    throw e;
  }
  const switchable = () => [...stream.getTracks(), ...recorded.getTracks(), ...deviceTracks()];
  return {
    stream,
    camera: devices.camera,
    surface,
    stop,
    elapsed: () => clock.elapsed(epochNow()),
    // Disabled tracks emit black/silence. Encoding stays continuous, avoiding native pause timestamp differences across audio/video encoders.
    async pause() {
      if (recorder.state !== 'recording' || paused) return;
      clock.pause(epochNow());
      paused = true;
      switchable().forEach((t) => {
        t.enabled = false;
      });
      await request({ type: 'session-state', sessionId: s.id, status: 'paused' });
    },
    async resume() {
      if (recorder.state !== 'recording' || !paused) return;
      switchable().forEach((t) => {
        t.enabled = true;
      });
      clock.resume(epochNow());
      paused = false;
      await request({ type: 'session-state', sessionId: s.id, status: 'recording' });
    },
  };
}
