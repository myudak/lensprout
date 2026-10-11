import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Command as CommandIcon,
  Crop,
  Download,
  HelpCircle,
  Maximize,
  Pause,
  Play,
  Redo2,
  RefreshCw,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  SquareSplitHorizontal,
  StepBack,
  StepForward,
  Trash2,
  TriangleAlert,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  CloudCheck,
  CloudUpload,
  CloudAlert,
  PanelRightClose,
  PanelRightOpen,
  Layers,
  Video,
  Sparkles,
} from '@/src/components/app/icons';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import type {
  InputEvent,
  OutputSettings,
  Project,
  Recording,
  Segment,
  Zoom,
} from '../domain/model';
import { clamp, seconds, us, validateProject } from '../domain/model';
import {
  addSegment,
  addZoom,
  duplicateItem,
  moveItems,
  removeItems,
  settleTracks,
  splitItem,
} from '../domain/commands';
import { items, type ItemKind } from '../domain/segments';
import { soundCues } from '../engine/sounds';
import { createSoundPlayer } from './sound-player';
import { createEditMap } from '../domain/edit-map';
import { logicalToRaw, rawToLogical, pausedRange } from '../domain/time-map';
import {
  loadBackgroundSource,
  loadProject,
  mediaFile,
  removeMedia,
  saveBackgroundImage,
  saveProject,
} from '../storage/store';
import { createCamera, type CameraEvaluator } from '../engine/camera';
import { motionSamples, outputSize, renderFrame } from '../engine/render';
import { paintBackground } from '../engine/backgrounds';
import { needsStage } from '../engine/stage';
import { viewExtents } from '../domain/crop';
import { createStage, type Stage } from '../engine/stage-render';
import { createOverlays } from '../engine/effects';
import { regenerateZooms } from '../engine/planner';
import type { ExportReply, ExportRequest } from '../export/protocol';
import { errorText, formatTime } from '@/src/lib/format';
import { cn } from '@/src/lib/utils';
import { AppHeader, IconAction, Choice, RailButton } from '@/src/components/app/app';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Input } from '@/src/components/ui/input';
import { Slider } from '@/src/components/ui/slider';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Spinner } from '@/src/components/ui/spinner';
import { Kbd } from '@/src/components/ui/kbd';
import { ScrollArea } from '@/src/components/ui/scroll-area';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/src/components/ui/resizable';
import { useTheme } from './theme';
import { ClipPanel, HelpPanel, StylePanel, ZoomPanel } from './panels';
import { AddMenu, Timeline } from './Timeline';
import { CropPanel, SegmentPanel } from './segment-panels';
import { CameraPanel } from './camera-panel';
import { SmartTrimDialog } from './SmartTrimDialog';
import { EditorMenubar } from './EditorMenubar';
import { ExportDialog, type ExportFormat, type ExportState } from './ExportDialog';
import { GIF_DEFAULTS, type GifOptions } from '../export/protocol';
import { CommandPalette } from './CommandPalette';

type Data = {
  recording: Recording;
  events: InputEvent[];
  url: string;
  file: Blob;
  webcamUrl?: string;
};
type Panel = 'style' | 'zoom' | 'segment' | 'crop' | 'clip' | 'camera' | 'help';
const FRAME_US = us(1 / 30);

export function Editor({ id }: { id: string }) {
  const [data, setData] = useState<Data>(),
    [project, setProject] = useState<Project>(),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('Saved'),
    [stageMissing, setStageMissing] = useState(false),
    [exportFormat, setExportFormat] = useState<ExportFormat>('mp4'),
    [gifOptions, setGifOptions] = useState<GifOptions>(GIF_DEFAULTS),
    [smartOpen, setSmartOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [panel, setPanel] = useState<Panel>('style'),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false),
    [volume, setVolume] = useState(1),
    [rate, setRate] = useState(1),
    [loop, setLoop] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [exportState, setExportState] = useState<ExportState>({ status: 'idle', progress: 0 }),
    [customImage, setCustomImage] = useState<ImageBitmap | null>(null),
    [canvasSize, setCanvasSize] = useState({ cssWidth: 0, cssHeight: 0, width: 2, height: 2 }),
    [saveError, setSaveError] = useState(''),
    [paletteOpen, setPaletteOpen] = useState(false),
    [fitSignal, setFitSignal] = useState(0),
    [inspectorOpen, setInspectorOpen] = useState(true);
  const { setTheme } = useTheme();
  const inspector = usePanelRef();
  const mainLayout = useDefaultLayout({ id: 'editor-main', storage: localStorage });
  const workLayout = useDefaultLayout({ id: 'editor-workspace', storage: localStorage });
  const video = useRef<HTMLVideoElement>(null),
    webcamVideo = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    stageFrame = useRef<HTMLDivElement>(null),
    minimap = useRef<HTMLCanvasElement | null>(null),
    fullmap = useRef<HTMLCanvasElement | null>(null),
    textDrag = useRef<string | null>(null),
    committed = useRef<Project | undefined>(undefined),
    shown = useRef<Project | undefined>(undefined),
    cameraRef = useRef<CameraEvaluator | undefined>(undefined),
    background = useRef<OffscreenCanvas | null>(null),
    // undefined: not created yet; null: WebGL2 unavailable (3D renders flat).
    stageRef = useRef<Stage | null | undefined>(undefined),
    timeRef = useRef(0);
  const history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    lastEdit = useRef<{ key?: string; at: number }>({ at: 0 }),
    revision = useRef(0),
    savedRevision = useRef(0),
    saveQueue = useRef(Promise.resolve()),
    dirty = useRef(false),
    worker = useRef<Worker | null>(null),
    exportFile = useRef<string | undefined>(undefined),
    exportUrl = useRef<string | undefined>(undefined);

  useEffect(() => {
    let disposed = false,
      url: string | undefined,
      webcamUrl: string | undefined;
    void (async () => {
      const loaded = await loadProject(id);
      const file = await mediaFile(loaded.recording.mediaRef);
      url = URL.createObjectURL(file);
      // A missing webcam file only loses the webcam, never the project.
      const webcamFile = loaded.recording.camera
        ? await mediaFile(loaded.recording.camera.mediaRef).catch(() => undefined)
        : undefined;
      if (webcamFile) webcamUrl = URL.createObjectURL(webcamFile);
      if (disposed) {
        URL.revokeObjectURL(url);
        if (webcamUrl) URL.revokeObjectURL(webcamUrl);
        return;
      }
      if (loaded.recording.camera && !webcamFile)
        toast.error('The webcam video of this recording is missing.');
      setData({ recording: loaded.recording, events: loaded.events, url, file, webcamUrl });
      committed.current = loaded.project;
      revision.current = loaded.project.revision;
      savedRevision.current = loaded.project.revision;
      setProject(loaded.project);
      timeRef.current = loaded.project.trim.startUs;
      setTime(loaded.project.trim.startUs);
      setPanel(loaded.project.zooms.length ? 'zoom' : 'style');
    })().catch((e) => setError(errorText(e)));
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
      if (webcamUrl) URL.revokeObjectURL(webcamUrl);
      worker.current?.terminate();
      stageRef.current?.gl.dispose();
      stageRef.current = undefined;
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
      if (exportFile.current) void removeMedia(exportFile.current).catch(() => {});
    };
  }, [id]);

  shown.current = project;
  const cropKey = project ? JSON.stringify(project.composition.crop) : '';
  const overlays = useMemo(
    () =>
      data && project
        ? createOverlays(data.events, project.composition.crop, data.recording.geometry)
        : undefined,
    // Rebuilt only when the crop changes, not on every edit.
    [data, cropKey],
  );
  const editMap = useMemo(() => (project ? createEditMap(project) : undefined), [project]);
  const cues = useMemo(
    () => (data && project && editMap ? soundCues(project, data.events, editMap) : []),
    [data, project, editMap],
  );
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  const sounds = useRef(createSoundPlayer());
  useEffect(() => () => sounds.current.dispose(), []);
  const editRef = useRef(editMap);
  editRef.current = editMap;
  const camera = useMemo(() => {
    if (!project || !data) return undefined;
    // Reuses cached spring states before the first changed zoom; edits stay cheap on long recordings.
    return (cameraRef.current = createCamera(
      project,
      data.events,
      cameraRef.current,
      viewExtents(project, data.recording.width, data.recording.height),
    ));
  }, [project, data]);

  const commit = useCallback(
    (next: Project, options: { remember?: boolean; coalesce?: string } = {}) => {
      if (!data || !committed.current) return;
      try {
        validateProject(next, data.recording);
        if (options.remember !== false) {
          const now = performance.now(),
            same =
              options.coalesce &&
              lastEdit.current.key === options.coalesce &&
              now - lastEdit.current.at < 1500;
          if (!same) {
            history.current.push(committed.current);
            if (history.current.length > 100) history.current.shift();
          }
          future.current = [];
          lastEdit.current = { key: options.coalesce, at: now };
        }
        const updated = { ...structuredClone(next), revision: ++revision.current };
        committed.current = updated;
        setProject(updated);
        dirty.current = true;
        setSaved('Unsaved');
      } catch (e) {
        setProject(committed.current);
        toast.error(errorText(e));
      }
    },
    [data],
  );
  const update = useCallback(
    (change: (p: Project) => Project, coalesce?: string) => {
      if (committed.current) commit(change(committed.current), { coalesce });
    },
    [commit],
  );
  const preview = useCallback((change: (p: Project) => Project) => {
    if (committed.current) setProject(change(committed.current));
  }, []);
  const cancelPreview = useCallback(() => setProject(committed.current), []);

  // Serialized writes prevent an earlier autosave from overwriting a newer edit.
  const enqueueSave = useCallback((snapshot: Project) => {
    setSaved('Saving…');
    saveQueue.current = saveQueue.current
      .then(() => saveProject(snapshot, savedRevision.current))
      .then(() => {
        savedRevision.current = snapshot.revision;
        if (committed.current?.revision === snapshot.revision) {
          dirty.current = false;
          setSaved('Saved');
          setSaveError('');
        }
      })
      .catch((e) => {
        setSaved('Save failed');
        setSaveError(`Edits could not be saved: ${errorText(e)}`);
      });
  }, []);
  useEffect(() => {
    // Previews (drags) are never saved; only the committed project is.
    if (!project || !dirty.current || project !== committed.current) return;
    const snapshot = project;
    const timeout = setTimeout(() => enqueueSave(snapshot), 400);
    return () => clearTimeout(timeout);
  }, [project, enqueueSave]);

  function undo() {
    const previous = history.current.pop();
    if (previous && committed.current) {
      future.current.push(committed.current);
      lastEdit.current = { at: 0 };
      commit(previous, { remember: false });
    }
  }
  function redo() {
    const next = future.current.pop();
    if (next && committed.current) {
      history.current.push(committed.current);
      lastEdit.current = { at: 0 };
      commit(next, { remember: false });
    }
  }

  // --- Preview rendering -------------------------------------------------------------------
  const logicalNow = () => {
    const v = video.current;
    return v && data ? rawToLogical(data.recording, us(v.currentTime)) : timeRef.current;
  };
  const draw = useCallback(() => {
    const v = video.current,
      c = canvas.current,
      p = shown.current,
      cam = cameraRef.current;
    if (!v || !c || !p || !cam || !data || v.readyState < 2 || !v.videoWidth) return;
    const t = v.paused ? timeRef.current : logicalNow();
    const w = webcamVideo.current,
      cameraInfo = data.recording.camera;
    if (w && cameraInfo && w.readyState >= 1) {
      // The webcam file starts offsetUs after the screen file; both share the raw clock.
      const target = Math.max(0, v.currentTime - cameraInfo.offsetUs / 1_000_000);
      if (v.paused) {
        if (!w.paused) w.pause();
        if (Math.abs(w.currentTime - target) > 0.002 && !w.seeking) w.currentTime = target;
      } else {
        if (Math.abs(w.playbackRate - v.playbackRate) > 1e-6) w.playbackRate = v.playbackRate;
        if (w.paused && target < w.duration) void w.play().catch(() => {});
        if (Math.abs(w.currentTime - target) > 0.08 && !w.seeking) w.currentTime = target;
      }
    }
    if (needsStage(p) && stageRef.current === undefined) {
      stageRef.current = createStage();
      if (!stageRef.current) setStageMissing(true);
    }
    renderFrame(c.getContext('2d')!, {
      stage: stageRef.current ?? null,
      hasWebcam: !!cameraInfo,
      source: v,
      sourceWidth: v.videoWidth,
      sourceHeight: v.videoHeight,
      cameras: motionSamples(cam, t, 60, p.effects.motionBlur),
      project: p,
      width: c.width,
      height: c.height,
      background: background.current,
      overlays,
      atUs: t,
      webcam:
        w && cameraInfo && w.readyState >= 2 && w.videoWidth
          ? { source: w, width: w.videoWidth, height: w.videoHeight }
          : null,
    });
    const crop = p.composition.crop;
    for (const [m, region] of [
      [minimap.current, crop],
      [fullmap.current, { x: 0, y: 0, width: 1, height: 1 }],
    ] as const) {
      if (!m) continue;
      const w = Math.max(2, Math.round(m.clientWidth * devicePixelRatio)),
        h = Math.max(2, Math.round(m.clientHeight * devicePixelRatio));
      if (m.width !== w || m.height !== h) {
        m.width = w;
        m.height = h;
      }
      m.getContext('2d')!.drawImage(
        v,
        region.x * v.videoWidth,
        region.y * v.videoHeight,
        region.width * v.videoWidth,
        region.height * v.videoHeight,
        0,
        0,
        w,
        h,
      );
    }
    // logicalNow only reads refs; draw is stable per data/overlays.
  }, [data, overlays]);
  const minimapRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      minimap.current = el;
      if (el) requestAnimationFrame(draw);
    },
    [draw],
  );
  const fullmapRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      fullmap.current = el;
      if (el) requestAnimationFrame(draw);
    },
    [draw],
  );
  // Fit the canvas to the stage at the output aspect ratio; pixels never exceed the output size.
  const output = project && data ? outputSize(project, data.recording) : undefined;
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !output) return;
    const resize = () => {
      const availableW = el.clientWidth,
        availableH = el.clientHeight,
        ratio = output.width / output.height;
      const cssWidth = Math.max(10, Math.min(availableW, availableH * ratio)),
        cssHeight = cssWidth / ratio;
      const scale = Math.min(1, (cssWidth * devicePixelRatio) / output.width);
      setCanvasSize({
        cssWidth,
        cssHeight,
        width: Math.max(2, Math.round(output.width * scale)),
        height: Math.max(2, Math.round(output.height * scale)),
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, [output?.width, output?.height]);
  const backgroundKey = project ? JSON.stringify(project.composition.background) : '';
  useEffect(() => {
    const bg = project?.composition.background;
    if (bg?.type !== 'custom' && bg?.type !== 'wallpaper') {
      setCustomImage(null);
      return;
    }
    let cancelled = false;
    void loadBackgroundSource(bg)
      .then((image) => (cancelled ? image?.close() : setCustomImage(image)))
      .catch((e) => toast.error(`Background image unavailable: ${errorText(e)}`));
    return () => {
      cancelled = true;
    };
  }, [backgroundKey]);
  useEffect(() => {
    const p = shown.current;
    if (!p) return;
    background.current = paintBackground(
      p.composition.background,
      canvasSize.width,
      canvasSize.height,
      customImage,
    );
    draw();
  }, [backgroundKey, canvasSize.width, canvasSize.height, customImage, draw]);
  useEffect(() => {
    if (!playing) draw();
  }, [project, camera, canvasSize, playing, draw]);

  const seek = useCallback(
    (atUs: number) => {
      const p = committed.current,
        v = video.current;
      if (!p || !v || !data) return;
      const t = Math.round(clamp(atUs, p.trim.startUs, p.trim.endUs));
      timeRef.current = t;
      v.currentTime = seconds(logicalToRaw(data.recording, t));
      setTime(t);
    },
    [data],
  );
  useEffect(() => {
    if (!playing || !data) return;
    let frame = 0,
      lastUi = 0;
    const tick = (now: number) => {
      const v = video.current,
        p = committed.current;
      if (!v || !p) return;
      let raw = us(v.currentTime);
      const pause = pausedRange(data.recording, raw);
      if (pause) {
        raw = pause.endUs;
        v.currentTime = seconds(raw);
      }
      let t = rawToLogical(data.recording, raw);
      if (t < p.trim.startUs) {
        v.currentTime = seconds(logicalToRaw(data.recording, p.trim.startUs));
        t = p.trim.startUs;
      }
      const edit = editRef.current;
      // Cut segments are skipped like pauses; speed and volume follow the active piece.
      if (edit && t < p.trim.endUs && !edit.pieceAt(t)) {
        t = edit.nextKept(t);
        v.currentTime = seconds(logicalToRaw(data.recording, t));
      }
      const piece = edit?.pieceAt(t);
      const wantedRate = playback.current.rate * (piece?.speed ?? 1),
        wantedVolume = playback.current.volume * (piece?.volume ?? 1);
      if (Math.abs(v.playbackRate - wantedRate) > 1e-6) v.playbackRate = wantedRate;
      if (Math.abs(v.volume - wantedVolume) > 1e-6) v.volume = wantedVolume;
      if (t >= p.trim.endUs) {
        if (loop) {
          v.currentTime = seconds(logicalToRaw(data.recording, p.trim.startUs));
          t = p.trim.startUs;
        } else {
          v.pause();
          t = p.trim.endUs;
          v.currentTime = seconds(logicalToRaw(data.recording, t));
        }
      }
      timeRef.current = t;
      if (!playback.current.muted && edit)
        sounds.current.tick(
          cuesRef.current,
          edit.toOutput(t),
          playback.current.rate,
          (shown.current?.effects.sounds.volume ?? 0) * playback.current.volume,
        );
      draw();
      if (now - lastUi >= 50) {
        setTime(t);
        lastUi = now;
      }
      frame = requestAnimationFrame(tick);
    };
    sounds.current.reset();
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, data, loop, draw]);
  const playback = useRef({ rate, volume, muted });
  playback.current = { rate, volume, muted };
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = muted;
    v.volume = volume;
    v.playbackRate = rate;
    // Export changes pitch with speed; the preview matches it.
    v.preservesPitch = false;
  }, [muted, volume, rate, data]);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current || worker.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);

  function togglePlay() {
    const v = video.current,
      p = committed.current;
    if (!v || !p || !data) return;
    if (v.paused) {
      if (timeRef.current >= p.trim.endUs - us(0.03)) seek(p.trim.startUs);
      void v.play().catch((e) => toast.error(errorText(e)));
    } else {
      v.pause();
      timeRef.current = logicalNow();
      setTime(timeRef.current);
    }
  }
  const selectedZooms = project ? project.zooms.filter((z) => selected.includes(z.id)) : [];
  const selectedSegments: Segment[] = project
    ? project.segments.filter((x) => selected.includes(x.id))
    : [];
  function select(ids: string[]) {
    setSelected(ids);
    const p = committed.current;
    if (!ids.length || !p) return;
    setPanel(ids.every((id) => p.zooms.some((z) => z.id === id)) ? 'zoom' : 'segment');
  }
  function deleteSelected() {
    if (!selected.length || !committed.current) return;
    commit(removeItems(committed.current, selected));
    setSelected([]);
  }
  function addAt(kind: ItemKind | 'crop', atUs: number) {
    if (kind === 'crop') return setPanel('crop');
    if (!committed.current) return;
    try {
      const before = committed.current,
        next = kind === 'zoom' ? addZoom(before, atUs) : addSegment(before, kind, atUs);
      commit(next);
      const created = items(next).find((i) => !items(before).some((old) => old.id === i.id));
      if (created) {
        setSelected([created.id]);
        setPanel(kind === 'zoom' ? 'zoom' : 'segment');
      }
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  function split() {
    const p = committed.current;
    if (!p) return;
    const all = items(p),
      target =
        selected.length === 1
          ? all.find((i) => i.id === selected[0])
          : all.find((i) => i.startUs < time && time < i.endUs);
    if (!target) return void toast.error('Select a segment under the playhead to split it.');
    splitAt(target.id);
  }
  function splitAt(id: string) {
    const p = committed.current;
    if (!p) return;
    try {
      commit(splitItem(p, id, timeRef.current));
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  function regenerate() {
    if (!committed.current || !data) return;
    const p = committed.current;
    const zooms = regenerateZooms(p.zooms, data.events, data.recording.durationUs, {
      offset: p.autoZoom.offset,
      move: p.stage.defaultMove,
      depth: p.autoZoom.depth,
      typing: p.autoZoom.typing,
      geometry: data.recording.geometry,
    });
    // Generated zooms start on track 1; move any that collide with other segments.
    commit(
      settleTracks(
        { ...p, zooms },
        zooms.filter((z) => z.provenance === 'generated').map((z) => z.id),
      ),
    );
    setSelected([]);
  }
  /** Places the selected text segment where the preview is clicked or dragged. */
  function textPointer(e: React.PointerEvent<HTMLCanvasElement>, phase: 'down' | 'move' | 'up') {
    const id =
      phase === 'down' ? selectedSegments.find((x) => x.kind === 'text')?.id : textDrag.current;
    if (!id || (phase === 'down' && selectedSegments.length !== 1)) return false;
    const r = e.currentTarget.getBoundingClientRect(),
      position = {
        x: clamp((e.clientX - r.left) / r.width),
        y: clamp((e.clientY - r.top) / r.height),
      };
    const change = (p: Project) => ({
      ...p,
      segments: p.segments.map((x) => (x.id === id && x.kind === 'text' ? { ...x, position } : x)),
    });
    if (phase === 'down') {
      e.currentTarget.setPointerCapture(e.pointerId);
      textDrag.current = id;
    }
    if (phase === 'up') {
      textDrag.current = null;
      update(change);
    } else preview(change);
    return true;
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (paletteOpen || exportOpen) return;
      if (
        target?.closest(
          'input:not([type=range]),select,textarea,[contenteditable],[role=dialog],[role=menu]',
        )
      )
        return;
      if ((e.code === 'Space' || e.key === 'Enter') && target?.closest('button,a,[role="button"]'))
        return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod) return;
      else if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? us(1) : FRAME_US;
        video.current?.pause();
        seek(timeRef.current + (e.key === 'ArrowLeft' ? -step : step));
      } else if (e.key === 'Home' && committed.current) seek(committed.current.trim.startUs);
      else if (e.key === 'End' && committed.current) seek(committed.current.trim.endUs);
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      else if (e.key === 'Escape') setSelected([]);
      else if (e.key.toLowerCase() === 's') split();
      else if (e.key.toLowerCase() === 'a') addAt('zoom', timeRef.current);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  async function exportVideo() {
    if (!committed.current || !data || worker.current) return;
    setError('');
    video.current?.pause();
    if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
    if (exportFile.current) await removeMedia(exportFile.current).catch(() => {});
    const format = exportFormat;
    exportFile.current = `export-${crypto.randomUUID()}.${format}`;
    exportUrl.current = undefined;
    setExportState({ status: 'running', progress: 0 });
    const job = new Worker(new URL('../export/job.worker.ts', import.meta.url), { type: 'module' });
    worker.current = job;
    job.onerror = (e) => {
      setError(`Export failed: ${e.message}`);
      job.terminate();
      worker.current = null;
      void removeMedia(exportFile.current!).catch(() => {});
      setExportState({ status: 'idle', progress: 0 });
    };
    job.onmessage = async (e: MessageEvent<ExportReply>) => {
      const m = e.data;
      if (m.type === 'progress') {
        setExportState((previous) => ({ ...previous, progress: m.progress }));
        return;
      }
      job.terminate();
      worker.current = null;
      if (m.type === 'done') {
        try {
          const file = await mediaFile(m.name);
          exportUrl.current = URL.createObjectURL(file);
          setExportState({ status: 'done', progress: 1, url: exportUrl.current, format });
          toast.success('Video ready', { description: 'Download it from the export dialog.' });
        } catch (error) {
          setError(errorText(error));
          setExportState({ status: 'idle', progress: 0 });
        }
      } else {
        setExportState({ status: 'idle', progress: 0 });
        if (m.type === 'error') setError(`Export failed: ${m.error}`);
      }
    };
    job.postMessage({
      type: 'start',
      project: structuredClone(committed.current),
      recording: data.recording,
      events: data.events,
      outputName: exportFile.current,
      ...(format === 'gif' ? { gif: gifOptions } : {}),
    } satisfies ExportRequest);
  }

  const timelineActions = {
    split: (id: string) => splitAt(id),
    duplicate: (id: string) => {
      if (!committed.current) return;
      try {
        const before = committed.current,
          next = duplicateItem(before, id);
        commit(next);
        const created = items(next).find((i) => !items(before).some((old) => old.id === i.id));
        if (created) select([created.id]);
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    remove: (ids: string[]) => {
      if (!committed.current) return;
      commit(removeItems(committed.current, ids));
      setSelected([]);
    },
    edit: (id: string) => select([id]),
    moveToTrack: (id: string, track: number) => {
      const p = committed.current,
        item = p && items(p).find((i) => i.id === id);
      if (!p || !item || !data) return;
      const next = moveItems(p, [id], 0, data.recording.durationUs, track - item.track);
      if (items(next).find((i) => i.id === id)?.track !== track)
        toast.error(`Track ${track + 1} is busy at this time.`);
      else commit(next);
    },
    zoomPatch: (id: string, patch: Partial<Zoom>) =>
      update((p) => ({
        ...p,
        zooms: p.zooms.map((z) => (z.id === id ? { ...z, ...patch, provenance: 'manual' } : z)),
      })),
    addAt: (kind: ItemKind, atUs: number) => addAt(kind, atUs),
  };
  const togglePanel = (next: Panel) => {
    setPanel(next);
    if (inspector.current?.isCollapsed()) inspector.current.expand();
  };

  if (!data || !project)
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader crumb={<span className="font-medium">Project</span>} />
        <main className="grid flex-1 grid-cols-[1fr_320px] gap-3 p-3">
          {error ? (
            <Alert variant="destructive" className="col-span-2 self-start">
              <TriangleAlert />
              <AlertTitle>This project could not be opened</AlertTitle>
              <AlertDescription>
                {error}{' '}
                <a href="/editor.html" className="underline">
                  Return to library
                </a>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Skeleton className="h-full min-h-80 rounded-xl" aria-label="Opening project…" />
              <Skeleton className="h-full rounded-xl" />
            </>
          )}
        </main>
      </div>
    );
  const cam = camera?.at(time);
  const fileName = `${project.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Recording'}.mp4`;
  const SaveIcon =
    saved === 'Saved' ? CloudCheck : saved === 'Save failed' ? CloudAlert : CloudUpload;
  const rail: { id: Panel; label: string; icon: typeof ZoomIn }[] = [
    { id: 'style', label: 'Style', icon: SlidersHorizontal },
    { id: 'zoom', label: 'Zoom', icon: ZoomIn },
    { id: 'segment', label: 'Segment', icon: Layers },
    { id: 'crop', label: 'Crop', icon: Crop },
    { id: 'clip', label: 'Clip', icon: Scissors },
    ...(data.recording.camera ? [{ id: 'camera' as const, label: 'Camera', icon: Video }] : []),
  ];
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader
        menubar={
          <EditorMenubar
            actions={{
              library: () => (location.href = '/editor.html'),
              newRecording: () =>
                toast.info('Start a recording from the Lensprout toolbar button', {
                  description: 'Or press Ctrl+Shift+Y on the page you want to record.',
                }),
              exportVideo: () => {
                setExportFormat('mp4');
                setExportOpen(true);
              },
              exportGif: () => {
                setExportFormat('gif');
                setExportOpen(true);
              },
              presets: () => togglePanel('style'),
              smartTrim: () => setSmartOpen(true),
              undo,
              redo,
              canUndo: history.current.length > 0,
              canRedo: future.current.length > 0,
              split,
              remove: deleteSelected,
              hasSelection: selected.length > 0,
              regenerate,
              add: (kind) => addAt(kind, timeRef.current),
              hasCamera: !!data.recording.camera,
              panel: (next) => togglePanel(next),
              fitTimeline: () => setFitSignal((n) => n + 1),
              toggleInspector: () =>
                inspectorOpen ? inspector.current?.collapse() : inspector.current?.expand(),
              inspectorOpen,
              fullscreen: () => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void stageFrame.current?.requestFullscreen().catch(() => {});
              },
              togglePlay,
              playing,
              loop,
              setLoop,
              rate,
              setRate,
              muted,
              setMuted,
            }}
          />
        }
        crumb={
          <Input
            aria-label="Project name"
            value={project.name}
            maxLength={200}
            onChange={(e) => update((p) => ({ ...p, name: e.target.value }), 'name')}
            className="h-8 w-[min(360px,40vw)] border-transparent bg-transparent font-semibold shadow-none hover:border-border focus-visible:bg-card"
          />
        }
      >
        <Badge
          variant={saved === 'Save failed' ? 'destructive' : 'secondary'}
          className="save-status hidden gap-1 sm:inline-flex"
          role="status"
        >
          {saved === 'Saving…' ? <Spinner className="size-3" /> : <SaveIcon className="size-3.5" />}
          {saved}
        </Badge>
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <IconAction
          icon={Undo2}
          label="Undo"
          shortcut="Ctrl Z"
          side="bottom"
          disabled={!history.current.length}
          onClick={undo}
        />
        <IconAction
          icon={Redo2}
          label="Redo"
          shortcut="Ctrl ⇧ Z"
          side="bottom"
          disabled={!future.current.length}
          onClick={redo}
        />
        <Button
          variant="outline"
          size="sm"
          className="hidden gap-2 text-muted-foreground md:inline-flex"
          onClick={() => setPaletteOpen(true)}
        >
          <CommandIcon /> Commands <Kbd>Ctrl K</Kbd>
        </Button>
        <Button onClick={() => setExportOpen(true)}>
          <Download /> Export video
        </Button>
      </AppHeader>
      {saveError && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <TriangleAlert />
          <AlertTitle>Edits are not saved</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
          <AlertAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => committed.current && enqueueSave(committed.current)}
            >
              <RefreshCw /> Retry save
            </Button>
          </AlertAction>
        </Alert>
      )}
      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1 p-3"
        defaultLayout={mainLayout.defaultLayout}
        onLayoutChanged={mainLayout.onLayoutChanged}
      >
        <ResizablePanel id="workspace" defaultSize="64%" minSize="35%">
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full"
            defaultLayout={workLayout.defaultLayout}
            onLayoutChanged={workLayout.onLayoutChanged}
          >
            <ResizablePanel id="preview" minSize="40%">
              <section
                ref={stageFrame}
                aria-label="Video preview"
                className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
              >
                <div
                  ref={stage}
                  className="stage-checker relative mx-3 mt-3 grid min-h-0 flex-1 place-items-center rounded-lg"
                >
                  <canvas
                    ref={canvas}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    style={{ width: canvasSize.cssWidth, height: canvasSize.cssHeight }}
                    aria-label="Composition preview"
                    className="block cursor-pointer rounded-md shadow-lg"
                    onPointerDown={(e) => {
                      if (!textPointer(e, 'down')) togglePlay();
                    }}
                    onPointerMove={(e) => textDrag.current && textPointer(e, 'move')}
                    onPointerUp={(e) => textDrag.current && textPointer(e, 'up')}
                  />
                  {/* Kept rendered (not display:none) so Chrome keeps decoding frames for the canvas. */}
                  <video
                    ref={video}
                    src={data.url}
                    className="pointer-events-none absolute bottom-0 left-0 size-0.5 opacity-[0.01]"
                    playsInline
                    preload="auto"
                    onLoadedMetadata={() => seek(timeRef.current)}
                    onLoadedData={draw}
                    onSeeked={draw}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onError={() =>
                      toast.error(
                        'The source video cannot be played. It may be incomplete or use an unsupported codec.',
                      )
                    }
                  />
                  {data.webcamUrl && (
                    // Follows the main video in draw(); muted because the mic is in the main track.
                    <video
                      ref={webcamVideo}
                      src={data.webcamUrl}
                      aria-hidden
                      className="pointer-events-none absolute bottom-0 left-0 size-0.5 opacity-[0.01]"
                      muted
                      playsInline
                      preload="auto"
                      onLoadedData={draw}
                      onSeeked={draw}
                    />
                  )}
                </div>
                <div className="m-3 flex items-center gap-1 rounded-lg border bg-background/60 px-2 py-1.5">
                  <IconAction
                    icon={muted || volume === 0 ? VolumeX : Volume2}
                    label={muted ? 'Unmute preview' : 'Mute preview'}
                    disabled={!data.recording.hasAudio}
                    onClick={() => setMuted(!muted)}
                  />
                  <Slider
                    thumbLabel="Preview volume"
                    className="hidden w-20 lg:flex"
                    min={0}
                    max={1}
                    step={0.05}
                    disabled={!data.recording.hasAudio}
                    value={muted ? 0 : volume}
                    onValueChange={(v) => {
                      setVolume(v as number);
                      setMuted(false);
                    }}
                  />
                  <span className="mx-1 flex items-center">
                    <IconAction
                      icon={SkipBack}
                      label="Jump to start"
                      shortcut="Home"
                      onClick={() => seek(project.trim.startUs)}
                    />
                    <IconAction
                      icon={StepBack}
                      label="Previous frame"
                      shortcut="←"
                      onClick={() => {
                        video.current?.pause();
                        seek(timeRef.current - FRAME_US);
                      }}
                    />
                    <Button
                      size="icon-lg"
                      className="mx-1 rounded-full"
                      aria-label={playing ? 'Pause preview' : 'Play preview'}
                      onClick={togglePlay}
                    >
                      {playing ? (
                        <Pause className="fill-current" />
                      ) : (
                        <Play className="fill-current" />
                      )}
                    </Button>
                    <IconAction
                      icon={StepForward}
                      label="Next frame"
                      shortcut="→"
                      onClick={() => {
                        video.current?.pause();
                        seek(timeRef.current + FRAME_US);
                      }}
                    />
                    <IconAction
                      icon={SkipForward}
                      label="Jump to end"
                      shortcut="End"
                      onClick={() => seek(project.trim.endUs)}
                    />
                  </span>
                  <span
                    className="clock mr-2 font-mono text-[13px] whitespace-nowrap tabular-nums"
                    title="Time in the exported video"
                  >
                    {formatTime(editMap ? editMap.toOutput(time) : time - project.trim.startUs)}
                    <span className="text-muted-foreground">
                      {' / '}
                      {formatTime(
                        editMap ? editMap.durationUs : project.trim.endUs - project.trim.startUs,
                      )}
                    </span>
                  </span>
                  <Slider
                    thumbLabel="Playhead"
                    className="min-w-16 flex-1"
                    min={project.trim.startUs}
                    max={project.trim.endUs}
                    step={us(0.01)}
                    value={clamp(time, project.trim.startUs, project.trim.endUs)}
                    onValueChange={(v) => seek(v as number)}
                  />
                  <Choice
                    label="Playback speed"
                    value={String(rate)}
                    options={[0.5, 1, 1.5, 2].map((r) => ({ id: String(r), label: `${r}×` }))}
                    onChange={(v) => setRate(Number(v))}
                    className="ml-1 hidden w-24 min-w-0 md:flex"
                  />
                  <IconAction
                    icon={Repeat}
                    label="Loop playback"
                    active={loop}
                    onClick={() => setLoop(!loop)}
                  />
                  <IconAction
                    icon={Maximize}
                    label="Fullscreen preview"
                    onClick={() => {
                      if (document.fullscreenElement) void document.exitFullscreen();
                      else void stageFrame.current?.requestFullscreen().catch(() => {});
                    }}
                  />
                </div>
              </section>
            </ResizablePanel>
            <ResizableHandle withHandle className="mx-1.5 bg-transparent" />
            <ResizablePanel
              id="inspector"
              panelRef={inspector}
              defaultSize="380px"
              minSize="300px"
              maxSize="560px"
              collapsible
              collapsedSize="56px"
              onResize={(size) => setInspectorOpen(size.inPixels > 80)}
            >
              <div className="flex h-full gap-2">
                <nav
                  aria-label="Editor panels"
                  className="flex h-full w-[4.25rem] shrink-0 flex-col items-center gap-1 rounded-2xl border bg-card py-2 shadow-sm"
                >
                  {rail.map((r) => (
                    <RailButton
                      key={r.id}
                      icon={r.icon}
                      label={r.label}
                      active={panel === r.id && inspectorOpen}
                      onClick={() => togglePanel(r.id)}
                    />
                  ))}
                  <RailButton icon={Download} label="Export" onClick={() => setExportOpen(true)} />
                  <span className="flex-1" />
                  <IconAction
                    icon={HelpCircle}
                    label="Shortcuts and help"
                    side="left"
                    size="icon-lg"
                    active={panel === 'help' && inspectorOpen}
                    onClick={() => togglePanel('help')}
                  />
                  <IconAction
                    icon={inspectorOpen ? PanelRightClose : PanelRightOpen}
                    label={inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}
                    side="left"
                    size="icon-lg"
                    onClick={() =>
                      inspectorOpen ? inspector.current?.collapse() : inspector.current?.expand()
                    }
                  />
                </nav>
                <aside
                  aria-label={`${panel} settings`}
                  className={cn(
                    'flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm',
                    !inspectorOpen && 'hidden',
                  )}
                >
                  <header className="flex items-center gap-2 border-b px-4 py-3">
                    <h2 className="text-base font-semibold">
                      {
                        {
                          style: 'Style',
                          zoom: 'Zoom',
                          segment: 'Segment',
                          crop: 'Crop',
                          clip: 'Clip',
                          camera: 'Camera',
                          help: 'Help',
                        }[panel]
                      }
                    </h2>
                  </header>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="p-4 pb-6">
                      {panel === 'style' && (
                        <StylePanel
                          project={project}
                          update={update}
                          webglMissing={stageMissing}
                          recording={data.recording}
                          customImage={customImage}
                          onPickImage={(f) =>
                            void saveBackgroundImage(f)
                              .then((mediaRef) =>
                                update((p) => ({
                                  ...p,
                                  composition: {
                                    ...p.composition,
                                    background: { type: 'custom', mediaRef, blur: 'none' },
                                  },
                                })),
                              )
                              .catch((e) => toast.error(errorText(e)))
                          }
                        />
                      )}
                      {panel === 'zoom' && (
                        <ZoomPanel
                          project={project}
                          recording={data.recording}
                          selected={selectedZooms}
                          time={time}
                          camera={cam}
                          pointer={camera?.pointer(time)}
                          minimapRef={minimapRef}
                          update={update}
                          preview={preview}
                          onDelete={deleteSelected}
                          onRegenerate={regenerate}
                        />
                      )}
                      {panel === 'segment' &&
                        (selectedSegments.length ? (
                          <SegmentPanel
                            project={project}
                            recording={data.recording}
                            selected={selectedSegments}
                            minimapRef={minimapRef}
                            update={update}
                            preview={preview}
                            onDelete={deleteSelected}
                          />
                        ) : (
                          <p className="py-4 text-sm text-muted-foreground">
                            Select a segment on the timeline, or add one with{' '}
                            <strong>Add segment</strong>.
                          </p>
                        ))}
                      {panel === 'crop' && (
                        <CropPanel
                          project={project}
                          recording={data.recording}
                          fullmapRef={fullmapRef}
                          update={update}
                          preview={preview}
                        />
                      )}
                      {panel === 'clip' && (
                        <ClipPanel project={project} recording={data.recording} update={update} />
                      )}
                      {panel === 'camera' && data.recording.camera && (
                        <CameraPanel
                          project={project}
                          update={update}
                          onAddSegment={() => addAt('camera', timeRef.current)}
                        />
                      )}
                      {panel === 'help' && <HelpPanel />}
                    </div>
                  </ScrollArea>
                </aside>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle className="my-1.5 bg-transparent" />
        <ResizablePanel id="timeline" defaultSize="36%" minSize="160px">
          <Timeline
            project={project}
            recording={data.recording}
            events={data.events}
            file={data.file}
            time={time}
            playing={playing}
            selected={selected}
            fitSignal={fitSignal}
            actions={timelineActions}
            onSelect={select}
            onSeek={seek}
            onPreview={setProject}
            onCommit={(next) => commit(next)}
            onCancel={cancelPreview}
            onAddAt={(at) => addAt('zoom', at)}
            toolbar={
              <>
                <AddMenu onAdd={(kind) => addAt(kind, time)} camera={!!data.recording.camera} />
                <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
                <IconAction
                  icon={SquareSplitHorizontal}
                  label="Split segment"
                  shortcut="S"
                  onClick={split}
                />
                <IconAction
                  icon={Trash2}
                  label="Delete selected segments"
                  shortcut="Del"
                  disabled={!selected.length}
                  onClick={deleteSelected}
                />
                <IconAction icon={RefreshCw} label="Regenerate auto zoom" onClick={regenerate} />
                <IconAction icon={Sparkles} label="Smart trim" onClick={() => setSmartOpen(true)} />
              </>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <ExportDialog
        open={exportOpen}
        project={project}
        recording={data.recording}
        state={exportState}
        error={error}
        fileName={fileName}
        format={exportFormat}
        gif={gifOptions}
        onFormat={setExportFormat}
        onGif={setGifOptions}
        onOutput={(o: OutputSettings) => update((p) => ({ ...p, output: o }))}
        onStart={exportVideo}
        onCancel={() => {
          setExportState((p) => ({ ...p, status: 'cancelling' }));
          worker.current?.postMessage({ type: 'cancel' } satisfies ExportRequest);
        }}
        onClose={() => setExportOpen(false)}
      />
      <SmartTrimDialog
        open={smartOpen}
        project={project}
        recording={data.recording}
        events={data.events}
        onClose={() => setSmartOpen(false)}
        onApply={(next, applied, skipped) => {
          commit(next);
          setSmartOpen(false);
          toast.success(
            `Smart trim applied ${applied} change${applied === 1 ? '' : 's'}` +
              (skipped ? ` (${skipped} skipped: overlapping speed segments)` : ''),
          );
        }}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        hasSelection={selected.length > 0}
        hasCamera={!!data.recording.camera}
        actions={{
          add: (kind) => addAt(kind, timeRef.current),
          split,
          remove: deleteSelected,
          undo,
          redo,
          regenerate,
          panel: (next) => togglePanel(next),
          exportVideo: () => setExportOpen(true),
          smartTrim: () => setSmartOpen(true),
          fitTimeline: () => setFitSignal((n) => n + 1),
          theme: setTheme,
        }}
      />
    </div>
  );
}
