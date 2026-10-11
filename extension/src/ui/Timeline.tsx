import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box,
  Copy,
  Crosshair,
  MousePointer2,
  Pencil,
  Plus,
  Rows3,
  SquareSplitHorizontal,
  Trash2,
  Video,
} from '@/src/components/app/icons';
import {
  CAMERA_LAYOUTS,
  CAMERA_MOVES,
  DEPTH_PRESETS,
  clamp,
  type CameraLayout,
  seconds,
  type InputEvent,
  type Project,
  type Recording,
  type Zoom,
} from '../domain/model';
import { moveItems, resizeItem, setTrim } from '../domain/commands';
import { items, type Item, type ItemKind } from '../domain/segments';
import { formatTime } from '@/src/lib/format';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Slider } from '@/src/components/ui/slider';
import { Kbd } from '@/src/components/ui/kbd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/src/components/ui/context-menu';
import { IconAction } from '@/src/components/app/app';
import { ZoomIn } from '@/src/components/app/icons';
import { KIND_INFO } from './kinds';
import { filmstrip } from './thumbs';

export { KIND_INFO } from './kinds';
const GUTTER = 18;
/** Lane pitch in px (h-11 + gap); vertical drags change track every LANE pixels. */
const LANE = 48;
/** mm:ss, with tenths when ticks are closer than a second. */
const label = (t: number, step: number) => {
  const text = `${Math.floor(t / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(t % 60)
    .toString()
    .padStart(2, '0')}`;
  return step < 1 ? `${text}.${Math.round((t % 1) * 10) % 10}` : text;
};
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const ADDABLE = Object.keys(KIND_INFO) as (ItemKind | 'crop')[];
/** Camera segments need a webcam in the recording. */
const addable = (camera: boolean) => ADDABLE.filter((k) => camera || k !== 'camera');
export const LAYOUT_LABELS: Record<CameraLayout, string> = {
  hidden: 'Hidden',
  small: 'Small',
  large: 'Large',
  fullscreen: 'Full frame',
  pip: 'Picture in picture',
  'side-by-side': 'Side by side',
  stacked: 'Stacked',
};

function itemText(project: Project, item: Item): string {
  if (item.kind === 'zoom') {
    const z = project.zooms.find((zoom) => zoom.id === item.id)!;
    return `${z.magnification.toFixed(1)}×`;
  }
  const s = project.segments.find((segment) => segment.id === item.id)!;
  switch (s.kind) {
    case 'cut':
      return 'Cut';
    case 'speed':
      return `${s.speed}×`;
    case 'audio':
      return s.volume === 0 ? 'Muted' : `${Math.round(s.volume * 100)}%`;
    case 'text':
      return s.text || 'Text';
    case 'blur':
      return 'Blur';
    case 'camera':
      return `Camera ${LAYOUT_LABELS[s.layout].toLowerCase()}`;
  }
}
/** Accessible names; zooms keep the wording the tests and screen readers rely on. */
function itemName(project: Project, item: Item) {
  const at = seconds(item.startUs).toFixed(2);
  if (item.kind === 'zoom') {
    const z = project.zooms.find((zoom) => zoom.id === item.id)!;
    return `Zoom at ${at} seconds, ${z.magnification} times`;
  }
  return `${KIND_INFO[item.kind].label} segment at ${at} seconds: ${itemText(project, item)}`;
}

/** “Add to timeline” menu with every segment type, plus a quick-zoom button. */
export function AddMenu({
  onAdd,
  camera = false,
}: {
  onAdd: (kind: ItemKind | 'crop') => void;
  camera?: boolean;
}) {
  return (
    <div className="flex">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="secondary"
              className="h-8 rounded-r-none bg-accent text-accent-foreground hover:bg-accent/80"
            />
          }
        >
          <Plus /> Add segment
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-72 p-2"
          aria-label="Add to timeline"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
              Add to timeline
            </DropdownMenuLabel>
            <div className="grid grid-cols-2 gap-1">
              {addable(camera).map((kind) => {
                const Icon = KIND_INFO[kind].icon;
                return (
                  <DropdownMenuItem
                    key={kind}
                    onClick={() => onAdd(kind)}
                    className="h-10 gap-2.5 rounded-lg bg-muted/60 px-3 text-sm"
                  >
                    <Icon style={{ color: KIND_INFO[kind].color }} /> {KIND_INFO[kind].label}
                  </DropdownMenuItem>
                );
              })}
            </div>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconAction
        icon={ZoomIn}
        label="Add zoom"
        shortcut="A"
        variant="secondary"
        className="h-8 rounded-l-none border-l border-background bg-accent text-accent-foreground hover:bg-accent/80"
        onClick={() => onAdd('zoom')}
      />
    </div>
  );
}

type Drag =
  | {
      kind: 'move';
      id: string;
      ids: string[];
      x: number;
      y: number;
      original: Project;
      moved: boolean;
      shift: boolean;
    }
  | { kind: 'start' | 'end'; id: string; x: number; original: Project; moved: boolean }
  | { kind: 'trim-start' | 'trim-end'; x: number; original: Project; moved: boolean }
  | { kind: 'scrub'; x: number; moved: boolean }
  | { kind: 'lane'; x: number; moved: boolean };

export type TimelineActions = {
  split: (id: string) => void;
  duplicate: (id: string) => void;
  remove: (ids: string[]) => void;
  edit: (id: string) => void;
  moveToTrack: (id: string, track: number) => void;
  zoomPatch: (id: string, patch: Partial<Zoom>) => void;
  addAt: (kind: ItemKind, atUs: number) => void;
};

export function Timeline({
  project,
  recording,
  events,
  file,
  time,
  playing,
  selected,
  toolbar,
  fitSignal = 0,
  actions,
  onSelect,
  onSeek,
  onPreview,
  onCommit,
  onCancel,
  onAddAt,
}: {
  project: Project;
  recording: Recording;
  events: InputEvent[];
  file: Blob;
  time: number;
  playing: boolean;
  selected: string[];
  toolbar: ReactNode;
  /** Changing this number resets the timeline zoom to fit. */
  fitSignal?: number;
  actions: TimelineActions;
  onSelect: (ids: string[]) => void;
  onSeek: (atUs: number) => void;
  onPreview: (next: Project) => void;
  onCommit: (next: Project) => void;
  onCancel: () => void;
  onAddAt: (atUs: number) => void;
}) {
  const duration = recording.durationUs,
    durationS = seconds(duration);
  const scroller = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    // Screen x (relative to the scroller) to keep fixed while zooming; null keeps the playhead fixed.
    anchor = useRef<number | null>(null);
  const [view, setView] = useState(800),
    [scale, setScale] = useState(0),
    [strip, setStrip] = useState<string>(),
    [menu, setMenu] = useState<{ id?: string; atUs: number; track: number }>({ atUs: 0, track: 0 });
  useEffect(() => setScale(0), [fitSignal]);
  useLayoutEffect(() => {
    const el = scroller.current!;
    const observer = new ResizeObserver(() => setView(el.clientWidth));
    observer.observe(el);
    setView(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  const fit = Math.max(1, (view - GUTTER * 2) / Math.max(durationS, 0.1)),
    maxPps = Math.max(fit * 1.01, 480),
    pps = fit * Math.pow(maxPps / fit, scale),
    inner = durationS * pps,
    width = inner + GUTTER * 2;
  const x = (us: number) => GUTTER + seconds(us) * pps;
  const at = (clientX: number) => {
    const rect = content.current!.getBoundingClientRect();
    return Math.round(clamp(((clientX - rect.left - GUTTER) / pps) * 1_000_000, 0, duration));
  };
  const previousPps = useRef(pps);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && previousPps.current !== pps) {
      const screenX =
        anchor.current ?? GUTTER + seconds(time) * previousPps.current - el.scrollLeft;
      const anchoredTime = (el.scrollLeft + screenX - GUTTER) / previousPps.current;
      el.scrollLeft = Math.max(0, GUTTER + anchoredTime * pps - screenX);
      previousPps.current = pps;
      anchor.current = null;
    }
  });
  // Ctrl/⌘ + wheel (and trackpad pinch) zooms the timeline around the pointer, not the page.
  useEffect(() => {
    const el = scroller.current!;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      anchor.current = e.clientX - el.getBoundingClientRect().left;
      setScale((s) => clamp(s - e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  // Ctrl/⌘ + = / − / 0 zoom the timeline in, out, or back to fit instead of the browser page.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (
        (e.target as HTMLElement | null)?.closest(
          'input:not([type=range]),textarea,select,[contenteditable]',
        )
      )
        return;
      if (e.key === '=' || e.key === '+') setScale((s) => clamp(s + 0.12));
      else if (e.key === '-' || e.key === '_') setScale((s) => clamp(s - 0.12));
      else if (e.key === '0') setScale(0);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const px = x(time);
    if (px < el.scrollLeft + 40 || px > el.scrollLeft + el.clientWidth - 40)
      el.scrollLeft = Math.max(0, px - el.clientWidth * 0.25);
  });
  const thumbs = Math.min(160, Math.max(1, Math.ceil(inner / 72)));
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void filmstrip(file, recording, thumbs, 44, controller.signal).then((canvas) => {
        if (canvas && !controller.signal.aborted) setStrip(canvas.toDataURL('image/jpeg', 0.7));
      });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [file, recording, thumbs]);
  const major = STEPS.find((s) => s * pps >= 84) ?? 600;
  const ticks = useMemo(() => {
    const minor = major / 5,
      list: { t: number; major: boolean }[] = [];
    // Integer steps avoid accumulated float error (1.9999 s would label as 00:01).
    for (let i = 0; i * minor <= durationS + 1e-9 && i < 4000; i++)
      list.push({ t: Math.round(i * minor * 1000) / 1000, major: i % 5 === 0 });
    return list;
  }, [major, durationS]);
  const clicks = useMemo(() => events.filter((e) => e.kind === 'pointer-down'), [events]);
  const all = items(project);
  const lanes = Math.max(2, Math.max(0, ...all.map((i) => i.track)) + 2);

  function begin(e: React.PointerEvent, d: Drag) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = d;
    if (d.kind === 'scrub') onSeek(at(e.clientX));
  }
  const moved = (d: Extract<Drag, { kind: 'move' }>, e: React.PointerEvent) =>
    moveItems(
      d.original,
      d.ids,
      ((e.clientX - d.x) / pps) * 1_000_000,
      duration,
      Math.round((e.clientY - d.y) / LANE),
    );
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (
      Math.abs(e.clientX - d.x) > 3 ||
      (d.kind === 'move' && Math.abs(e.clientY - d.y) > LANE / 2)
    )
      d.moved = true;
    if (!d.moved) return;
    const t = at(e.clientX);
    switch (d.kind) {
      case 'scrub':
      case 'lane':
        return onSeek(t);
      case 'move':
        return onPreview(moved(d, e));
      case 'start':
      case 'end':
        return onPreview(resizeItem(d.original, d.id, d.kind, t, duration));
      case 'trim-start':
      case 'trim-end':
        return onPreview(
          setTrim(d.original, d.kind === 'trim-start' ? 'start' : 'end', t, duration),
        );
    }
  }
  function end(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const t = at(e.clientX);
    if (d.kind === 'move' && !d.moved) {
      onCancel();
      const item = all.find((i) => i.id === d.id);
      onSelect(
        d.shift
          ? selected.includes(d.id)
            ? selected.filter((id) => id !== d.id)
            : [...selected, d.id]
          : [d.id],
      );
      if (item && !d.shift && (time < item.startUs || time >= item.endUs)) onSeek(item.startUs);
      return;
    }
    if (d.kind === 'lane') {
      if (!d.moved) {
        onSelect([]);
        onSeek(t);
      }
      return;
    }
    if (d.kind === 'scrub') return;
    if (!d.moved) return onCancel();
    if (d.kind === 'move') onCommit(moved(d, e));
    else if (d.kind === 'start' || d.kind === 'end')
      onCommit(resizeItem(d.original, d.id, d.kind, t, duration));
    else onCommit(setTrim(d.original, d.kind === 'trim-start' ? 'start' : 'end', t, duration));
  }
  const handlers = {
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: () => {
      drag.current = null;
      onCancel();
    },
  };
  /** Right-click target: the segment under the pointer, or an empty spot on a lane. */
  function locateMenu(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const id = target.closest<HTMLElement>('[data-item]')?.dataset.item;
    const lane = target.closest<HTMLElement>('[data-track]');
    setMenu({ id, atUs: at(e.clientX), track: lane ? Number(lane.dataset.track) : 0 });
    if (id && !selected.includes(id)) onSelect([id]);
  }
  const menuItem = menu.id ? all.find((i) => i.id === menu.id) : undefined;
  const menuSegment = menuItem ? project.segments.find((s) => s.id === menuItem.id) : undefined;
  const menuZoom =
    menuItem?.kind === 'zoom' ? project.zooms.find((z) => z.id === menuItem.id) : undefined;
  const trimStart = x(project.trim.startUs),
    trimEnd = x(project.trim.endUs);
  return (
    <section
      aria-label="Timeline"
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
        {toolbar}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom timeline out"
          title="Zoom timeline out (Ctrl −)"
          onClick={() => setScale((s) => clamp(s - 0.15))}
        >
          −
        </Button>
        <Slider
          thumbLabel="Timeline zoom"
          className="w-28"
          min={0}
          max={1}
          step={0.01}
          value={scale}
          onValueChange={(v) => setScale(v as number)}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom timeline in"
          title="Zoom timeline in (Ctrl +)"
          onClick={() => setScale((s) => clamp(s + 0.15))}
        >
          +
        </Button>
      </div>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              ref={scroller}
              className="timeline-scroll relative min-h-0 flex-1 overflow-auto"
              onContextMenuCapture={locateMenu}
            />
          }
        >
          <div ref={content} className="relative min-w-full pb-2 select-none" style={{ width }}>
            <div
              role="slider"
              tabIndex={-1}
              aria-label="Timeline ruler"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={time}
              className="sticky top-0 z-[6] h-8 cursor-ew-resize touch-none border-b bg-card/95 backdrop-blur"
              onPointerDown={(e) => begin(e, { kind: 'scrub', x: e.clientX, moved: true })}
              {...handlers}
            >
              {ticks.map((tick) => (
                <span
                  key={tick.t.toFixed(3)}
                  className={cn(
                    'absolute bottom-0 w-px bg-border',
                    tick.major ? 'h-3 bg-muted-foreground/50' : 'h-1.5',
                  )}
                  style={{ left: GUTTER + tick.t * pps }}
                >
                  {tick.major && (
                    <small className="absolute bottom-3 left-1 text-[10.5px] whitespace-nowrap text-muted-foreground tabular-nums">
                      {label(tick.t, major)}
                    </small>
                  )}
                </span>
              ))}
              {clicks.map((c) => (
                <span
                  key={c.id}
                  aria-hidden
                  className="pointer-events-none absolute bottom-3.5 -ml-[2.5px] size-[5px] rounded-full bg-amber-500/80"
                  style={{ left: x(c.atUs) }}
                />
              ))}
            </div>
            <div className="grid gap-1 pt-1">
              {Array.from({ length: lanes }, (_, track) => (
                <div
                  key={track}
                  data-track={track}
                  className="lane relative h-11 touch-none border-b border-dashed border-border/70"
                  onPointerDown={(e) => begin(e, { kind: 'lane', x: e.clientX, moved: false })}
                  onDoubleClick={(e) => {
                    if (e.target === e.currentTarget) onAddAt(at(e.clientX));
                  }}
                  {...handlers}
                >
                  <span className="pointer-events-none sticky left-0 z-[3] inline-block rounded-r-md bg-card/90 px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                    {String(track + 1).padStart(2, '0')}
                  </span>
                  {all
                    .filter((i) => i.track === track)
                    .map((item) => {
                      const isSelected = selected.includes(item.id);
                      const zoom =
                        item.kind === 'zoom'
                          ? project.zooms.find((z) => z.id === item.id)
                          : undefined;
                      const Icon = KIND_INFO[item.kind].icon;
                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          data-item={item.id}
                          data-kind={item.kind}
                          data-provenance={zoom?.provenance}
                          aria-label={itemName(project, item)}
                          aria-pressed={isSelected}
                          className="segment absolute top-1 bottom-1 z-[2] flex min-w-1.5 cursor-grab items-center justify-center overflow-hidden rounded-lg text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
                          style={{
                            left: x(item.startUs),
                            width: Math.max(6, x(item.endUs) - x(item.startUs)),
                          }}
                          onPointerDown={(e) =>
                            begin(e, {
                              kind: 'move',
                              id: item.id,
                              ids: isSelected && selected.length > 1 ? selected : [item.id],
                              x: e.clientX,
                              y: e.clientY,
                              original: project,
                              moved: false,
                              shift: e.shiftKey,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              onSelect([item.id]);
                              onSeek(item.startUs);
                            }
                          }}
                          {...handlers}
                        >
                          <span className="pointer-events-none flex items-center gap-1 px-3 whitespace-nowrap">
                            <Icon className="size-3.5 shrink-0" />
                            <span className="max-w-56 truncate">{itemText(project, item)}</span>
                            {zoom?.focus.mode === 'fixed' && <Crosshair className="size-3" />}
                          </span>
                          {(['start', 'end'] as const).map((edge) => (
                            <span
                              key={edge}
                              // Pointer-only affordance inside a button; timing fields are the keyboard alternative.
                              aria-hidden
                              data-handle={edge}
                              className={cn(
                                'handle absolute inset-y-0 w-2.5 cursor-ew-resize',
                                edge === 'start' ? 'left-0' : 'right-0',
                              )}
                              onPointerDown={(e) =>
                                begin(e, {
                                  kind: edge,
                                  id: item.id,
                                  x: e.clientX,
                                  original: project,
                                  moved: false,
                                })
                              }
                              {...handlers}
                            />
                          ))}
                        </div>
                      );
                    })}
                </div>
              ))}
              <div
                className="relative h-12 touch-none"
                onPointerDown={(e) => begin(e, { kind: 'lane', x: e.clientX, moved: false })}
                {...handlers}
              >
                <span className="pointer-events-none sticky left-0 z-[3] inline-block rounded-r-md bg-card/90 px-1.5 text-[10px] font-semibold text-muted-foreground">
                  CLIP
                </span>
                <div
                  className="filmstrip pointer-events-none absolute top-1.5 bottom-1 rounded-lg bg-muted bg-[length:100%_100%]"
                  style={{
                    left: GUTTER,
                    width: inner,
                    backgroundImage: strip ? `url(${strip})` : undefined,
                  }}
                />
                {project.segments
                  .filter((s) => s.kind === 'cut')
                  .map((s) => (
                    <div
                      key={s.id}
                      className="pointer-events-none absolute top-1.5 bottom-1 bg-[repeating-linear-gradient(135deg,rgb(239_68_68/0.45)_0_6px,rgb(254_226_226/0.55)_6px_12px)]"
                      style={{ left: x(s.startUs), width: x(s.endUs) - x(s.startUs) }}
                    />
                  ))}
                <div
                  className="pointer-events-none absolute top-1.5 bottom-1 bg-background/75"
                  style={{ left: GUTTER, width: Math.max(0, trimStart - GUTTER) }}
                />
                <div
                  className="pointer-events-none absolute top-1.5 bottom-1 bg-background/75"
                  style={{ left: trimEnd, width: Math.max(0, GUTTER + inner - trimEnd) }}
                />
                <div
                  className="pointer-events-none absolute top-1 bottom-0.5 rounded-lg border-[2.5px] border-trim"
                  style={{ left: trimStart, width: Math.max(0, trimEnd - trimStart) }}
                >
                  {(['trim-start', 'trim-end'] as const).map((kind) => (
                    <span
                      key={kind}
                      role="slider"
                      tabIndex={-1}
                      aria-label={kind === 'trim-start' ? 'Drag trim start' : 'Drag trim end'}
                      aria-valuenow={
                        kind === 'trim-start' ? project.trim.startUs : project.trim.endUs
                      }
                      className={cn(
                        'pointer-events-auto absolute -inset-y-0.5 w-3 cursor-ew-resize bg-trim',
                        kind === 'trim-start' ? '-left-2 rounded-l-md' : '-right-2 rounded-r-md',
                      )}
                      onPointerDown={(e) =>
                        begin(e, { kind, x: e.clientX, original: project, moved: false })
                      }
                      {...handlers}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute top-2 bottom-0 z-[5] -ml-px w-0.5 bg-primary"
              style={{ left: x(time) }}
            >
              <span
                className="pointer-events-auto absolute -top-1.5 -left-1.5 size-3.5 cursor-ew-resize touch-none rounded-[4px_4px_7px_7px] bg-primary shadow"
                onPointerDown={(e) => begin(e, { kind: 'scrub', x: e.clientX, moved: true })}
                {...handlers}
              />
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56 p-1">
          {menuItem ? (
            <>
              <ContextMenuGroup>
                <ContextMenuLabel className="text-xs text-muted-foreground">
                  {KIND_INFO[menuItem.kind].label} · {itemText(project, menuItem)}
                </ContextMenuLabel>
              </ContextMenuGroup>
              <ContextMenuItem onClick={() => actions.edit(menuItem.id)}>
                <Pencil /> Edit…
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!(time > menuItem.startUs + 100_000 && time < menuItem.endUs - 100_000)}
                onClick={() => actions.split(menuItem.id)}
              >
                <SquareSplitHorizontal /> Split at playhead{' '}
                <ContextMenuShortcut>S</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onClick={() => actions.duplicate(menuItem.id)}>
                <Copy /> Duplicate
              </ContextMenuItem>
              {menuSegment?.kind === 'camera' && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Video /> Camera layout
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="p-1">
                    {CAMERA_LAYOUTS.map((layout) => (
                      <ContextMenuItem
                        key={layout}
                        disabled={menuSegment.layout === layout}
                        onClick={() =>
                          onCommit({
                            ...project,
                            segments: project.segments.map((s) =>
                              s.id === menuSegment.id && s.kind === 'camera' ? { ...s, layout } : s,
                            ),
                          })
                        }
                      >
                        {LAYOUT_LABELS[layout]}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Rows3 /> Move to track
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="p-1">
                  {Array.from({ length: lanes }, (_, t) => (
                    <ContextMenuItem
                      key={t}
                      disabled={t === menuItem.track}
                      onClick={() => actions.moveToTrack(menuItem.id, t)}
                    >
                      Track {t + 1}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              {menuZoom && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() =>
                      actions.zoomPatch(menuZoom.id, {
                        focus:
                          menuZoom.focus.mode === 'fixed'
                            ? { mode: 'follow-pointer' }
                            : { mode: 'fixed', point: { x: 0.5, y: 0.5 } },
                      })
                    }
                  >
                    {menuZoom.focus.mode === 'fixed' ? <MousePointer2 /> : <Crosshair />}
                    {menuZoom.focus.mode === 'fixed' ? 'Follow cursor' : 'Fixed focus'}
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <ZoomIn /> Depth
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="p-1">
                      {DEPTH_PRESETS.map((d) => (
                        <ContextMenuItem
                          key={d.id}
                          onClick={() => actions.zoomPatch(menuZoom.id, { magnification: d.value })}
                        >
                          {d.label} <ContextMenuShortcut>{d.value}×</ContextMenuShortcut>
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Box /> Camera move
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="p-1">
                      {CAMERA_MOVES.map((kind) => (
                        <ContextMenuItem
                          key={kind}
                          disabled={(menuZoom.move?.kind ?? 'none') === kind}
                          onClick={() =>
                            actions.zoomPatch(menuZoom.id, {
                              move: { ...(menuZoom.move ?? project.stage.defaultMove), kind },
                            })
                          }
                        >
                          {kind[0]!.toUpperCase() + kind.slice(1)}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                </>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() =>
                  actions.remove(selected.includes(menuItem.id) ? selected : [menuItem.id])
                }
              >
                <Trash2 /> Delete <ContextMenuShortcut>Del</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuGroup>
                <ContextMenuLabel className="text-xs text-muted-foreground">
                  Add at {formatTime(menu.atUs)}
                </ContextMenuLabel>
              </ContextMenuGroup>
              {addable(!!recording.camera)
                .filter((k): k is ItemKind => k !== 'crop')
                .map((kind) => {
                  const Icon = KIND_INFO[kind].icon;
                  return (
                    <ContextMenuItem key={kind} onClick={() => actions.addAt(kind, menu.atUs)}>
                      <Icon style={{ color: KIND_INFO[kind].color }} /> {KIND_INFO[kind].label}
                    </ContextMenuItem>
                  );
                })}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <div className="flex shrink-0 items-center gap-3 border-t px-3.5 py-1.5 text-[11.5px] text-muted-foreground">
        <span>
          {lanes} tracks · {all.length} segment{all.length === 1 ? '' : 's'}
          {selected.length > 1 ? ` · ${selected.length} selected` : ''} · trim{' '}
          {formatTime(project.trim.endUs - project.trim.startUs)}
        </span>
        <span className="flex-1" />
        <span className="hidden items-center gap-1 lg:flex">
          Drag to move (up/down changes track) · Pull edges to resize · <Kbd>⇧</Kbd> click to
          multi-select · Right-click for more · <Kbd>Ctrl</Kbd> + scroll to zoom
        </span>
      </div>
    </section>
  );
}
