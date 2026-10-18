import { useRef } from 'react';
import { Sparkles, Trash2 } from '@/src/components/app/icons';
import {
  FULL_FRAME,
  SPEEDS,
  clamp,
  seconds,
  us,
  type Project,
  type Recording,
  type Rect,
  type Segment,
  CAMERA_LAYOUTS,
  type CameraLayout,
} from '../domain/model';
import { isFullFrame } from '../domain/crop';
import {
  FieldRow,
  NumberField,
  Segmented,
  SwitchRow,
  Choice,
  ColorPicker,
} from '@/src/components/app/app';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Slider } from '@/src/components/ui/slider';
import { Textarea } from '@/src/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { cn } from '@/src/lib/utils';
import { Block, Inspector, Section, type Update } from './panels';
import { KIND_INFO } from './kinds';
import { LAYOUT_LABELS } from './Timeline';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
/**
 * A frame thumbnail (drawn by the editor through `canvasRef`) with a draggable, resizable
 * rectangle. Emits previews while dragging and a final value on release.
 */
export function RectEditor({
  canvasRef,
  aspect,
  rect,
  label,
  minimum = 0.05,
  onChange,
}: {
  canvasRef: (canvas: HTMLCanvasElement | null) => void;
  aspect: number;
  rect: Rect;
  label: string;
  minimum?: number;
  onChange: (rect: Rect, done: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null),
    drag = useRef<{ handle: Handle; x: number; y: number; start: Rect } | null>(null);
  const next = (e: React.PointerEvent): Rect => {
    const d = drag.current!,
      r = box.current!.getBoundingClientRect(),
      dx = (e.clientX - d.x) / r.width,
      dy = (e.clientY - d.y) / r.height,
      s = d.start;
    if (d.handle === 'move')
      return { ...s, x: clamp(s.x + dx, 0, 1 - s.width), y: clamp(s.y + dy, 0, 1 - s.height) };
    let left = s.x,
      top = s.y,
      right = s.x + s.width,
      bottom = s.y + s.height;
    if (d.handle.includes('w')) left = clamp(left + dx, 0, right - minimum);
    if (d.handle.includes('e')) right = clamp(right + dx, left + minimum, 1);
    if (d.handle.includes('n')) top = clamp(top + dy, 0, bottom - minimum);
    if (d.handle.includes('s')) bottom = clamp(bottom + dy, top + minimum, 1);
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const start = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: rect };
  };
  const handlers = {
    onPointerMove: (e: React.PointerEvent) => drag.current && onChange(next(e), false),
    onPointerUp: (e: React.PointerEvent) => {
      if (!drag.current) return;
      const value = next(e);
      drag.current = null;
      onChange(value, true);
    },
  };
  const corner = 'absolute size-3.5 rounded-[4px] border-2 border-green-500 bg-white shadow-sm';
  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      className="relative w-full touch-none overflow-hidden rounded-lg bg-black select-none"
      style={{ paddingTop: `${100 / aspect}%` }}
    >
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
      <div
        className="absolute cursor-move rounded-[3px] border-2 border-green-400 shadow-[0_0_0_999px_rgba(0,0,0,0.5)]"
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
          height: `${rect.height * 100}%`,
        }}
        onPointerDown={start('move')}
        {...handlers}
      >
        <span
          className={cn(corner, '-top-2 -left-2 cursor-nwse-resize')}
          onPointerDown={start('nw')}
          {...handlers}
        />
        <span
          className={cn(corner, '-top-2 -right-2 cursor-nesw-resize')}
          onPointerDown={start('ne')}
          {...handlers}
        />
        <span
          className={cn(corner, '-bottom-2 -left-2 cursor-nesw-resize')}
          onPointerDown={start('sw')}
          {...handlers}
        />
        <span
          className={cn(corner, '-right-2 -bottom-2 cursor-nwse-resize')}
          onPointerDown={start('se')}
          {...handlers}
        />
      </div>
    </div>
  );
}

const pct = (n: number) => Math.round(n * 1000) / 10;
/** Numeric rectangle fields (percent), the accessible alternative to dragging. */
function RectFields({
  rect,
  prefix,
  minimum,
  onRect,
}: {
  rect: Rect;
  prefix: string;
  minimum: number;
  onRect: (rect: Rect) => void;
}) {
  const set = (patch: Partial<Rect>) => {
    const r = { ...rect, ...patch };
    const width = clamp(r.width, minimum, 1),
      height = clamp(r.height, minimum, 1);
    onRect({ x: clamp(r.x, 0, 1 - width), y: clamp(r.y, 0, 1 - height), width, height });
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField
        label={`${prefix} left (%)`}
        value={pct(rect.x)}
        step={0.5}
        onValue={(n) => set({ x: n / 100 })}
      />
      <NumberField
        label={`${prefix} top (%)`}
        value={pct(rect.y)}
        step={0.5}
        onValue={(n) => set({ y: n / 100 })}
      />
      <NumberField
        label={`${prefix} width (%)`}
        value={pct(rect.width)}
        step={0.5}
        onValue={(n) => set({ width: n / 100 })}
      />
      <NumberField
        label={`${prefix} height (%)`}
        value={pct(rect.height)}
        step={0.5}
        onValue={(n) => set({ height: n / 100 })}
      />
    </div>
  );
}

/** Most frequent browser viewport seen during a screen/window capture. */
export function autoCrop(recording: Recording): Rect | undefined {
  const best = recording.viewports?.[0]?.rect;
  if (!best) return undefined;
  const x = clamp(best.x),
    y = clamp(best.y);
  return { x, y, width: clamp(best.width, 0.1, 1 - x), height: clamp(best.height, 0.1, 1 - y) };
}

export function CropPanel({
  project,
  recording,
  fullmapRef,
  update,
  preview,
}: {
  project: Project;
  recording: Recording;
  fullmapRef: (canvas: HTMLCanvasElement | null) => void;
  update: Update;
  preview: (change: (p: Project) => Project) => void;
}) {
  const crop = project.composition.crop,
    auto = autoCrop(recording);
  const setCrop = (rect: Rect, done = true) => {
    const change = (p: Project) => ({ ...p, composition: { ...p.composition, crop: rect } });
    if (done) update(change);
    else preview(change);
  };
  const same = (a?: Rect) => !!a && JSON.stringify(a) === JSON.stringify(crop);
  return (
    <Inspector id="crop">
      <Section title="Crop">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={isFullFrame(crop)}
            className="aria-pressed:border-primary aria-pressed:bg-accent"
            onClick={() => setCrop({ ...FULL_FRAME })}
          >
            None
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={same(auto)}
            className="aria-pressed:border-primary aria-pressed:bg-accent"
            disabled={!auto}
            onClick={() => auto && setCrop(auto)}
            title={auto ? 'Keep only the web page, without tabs and toolbars' : undefined}
          >
            <Sparkles /> Crop browser bars
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {recording.source === 'tab'
            ? 'Tab recordings contain only the page, so there are no browser bars to remove. Drag the frame to crop anything else.'
            : recording.source === 'file'
              ? 'Imported videos have no page data, so drag the frame to crop.'
              : auto
                ? 'Crop browser bars keeps just the web page you used during recording, so the video feels full screen.'
                : 'No web page was detected in this capture. Drag the frame to crop manually.'}
        </p>
        <RectEditor
          canvasRef={fullmapRef}
          aspect={recording.width / recording.height}
          rect={crop}
          minimum={0.1}
          label="Crop area. Drag the frame or its corners."
          onChange={setCrop}
        />
        <RectFields rect={crop} prefix="Crop" minimum={0.1} onRect={(r) => setCrop(r)} />
        <p className="text-xs text-muted-foreground">
          Fixed zoom points and blur areas are placed relative to the cropped picture.
        </p>
      </Section>
    </Inspector>
  );
}

export function SegmentPanel({
  project,
  recording,
  selected,
  minimapRef,
  update,
  preview,
  onDelete,
}: {
  project: Project;
  recording: Recording;
  selected: Segment[];
  minimapRef: (canvas: HTMLCanvasElement | null) => void;
  update: Update;
  preview: (change: (p: Project) => Project) => void;
  onDelete: () => void;
}) {
  if (selected.length !== 1)
    return (
      <div className="flex items-center gap-2 py-3">
        <strong>{selected.length} segments selected</strong>
        <span className="flex-1" />
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 /> Delete
        </Button>
      </div>
    );
  const s = selected[0]!;
  const info = KIND_INFO[s.kind],
    KindIcon = info.icon;
  const edit = (patch: Partial<Segment>, coalesce?: string, done = true) => {
    const change = (p: Project) => ({
      ...p,
      segments: p.segments.map((x) => (x.id === s.id ? ({ ...x, ...patch } as Segment) : x)),
    });
    if (done) update(change, coalesce);
    else preview(change);
  };
  const crop = project.composition.crop;
  return (
    <Inspector id={`segment-${s.kind}`}>
      <Block>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 text-xs"
            // Mixing toward the foreground keeps kind colors readable (AA) in both themes.
            style={{
              color: `color-mix(in oklab, ${info.color} 45%, var(--foreground))`,
              borderColor: `color-mix(in oklab, ${info.color} 40%, transparent)`,
            }}
          >
            <KindIcon /> {info.label}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {seconds(s.startUs).toFixed(2)}–{seconds(s.endUs).toFixed(2)} s · track {s.track + 1}
          </span>
          <span className="flex-1" />
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 /> Delete segment
          </Button>
        </div>
        {s.kind === 'cut' && (
          <p className="text-xs text-muted-foreground">
            This range is removed from the exported video. Playback skips it.
          </p>
        )}
      </Block>
      {s.kind === 'speed' && (
        <Section title="Speed">
          <ToggleGroup
            aria-label="Segment speed"
            value={[String(s.speed)]}
            onValueChange={(v) => v[0] && edit({ speed: Number(v[0]) })}
            variant="outline"
            spacing={1}
            className="grid w-full grid-cols-5"
          >
            {SPEEDS.map((v) => (
              <ToggleGroupItem
                key={v}
                value={String(v)}
                className="aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              >
                {v}×
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            Audio pitch follows the speed, like fast-forwarding a tape.
          </p>
        </Section>
      )}
      {s.kind === 'audio' && (
        <Section title="Volume">
          <SwitchRow
            label="Mute this range"
            checked={s.volume === 0}
            onChange={(mute) => edit({ volume: mute ? 0 : 1 })}
          />
          <FieldRow label="Volume">
            <Slider
              thumbLabel="Segment volume"
              className="w-36"
              min={0}
              max={1}
              step={0.05}
              value={s.volume}
              onValueChange={(v) => edit({ volume: v as number }, 'volume')}
            />
            <output className="w-10 text-right text-xs tabular-nums">
              {Math.round(s.volume * 100)}%
            </output>
          </FieldRow>
        </Section>
      )}
      {s.kind === 'text' && (
        <Section title="Text">
          <Textarea
            aria-label="Text content"
            rows={3}
            maxLength={200}
            value={s.text}
            onChange={(e) => edit({ text: e.target.value }, 'text')}
          />
          <Segmented
            label="Text style"
            value={s.style}
            options={[
              { id: 'pill', label: 'Pill' },
              { id: 'box', label: 'Box' },
              { id: 'plain', label: 'Plain' },
            ]}
            onChange={(style) => edit({ style })}
          />
          <FieldRow label="Size">
            <Slider
              thumbLabel="Text size"
              className="w-36"
              min={16}
              max={160}
              step={2}
              value={s.size}
              onValueChange={(v) => edit({ size: v as number }, 'size')}
            />
            <output className="w-9 text-right text-xs tabular-nums">{s.size}</output>
          </FieldRow>
          <FieldRow label="Color">
            <ColorPicker
              label="Text color"
              value={s.color}
              onChange={(color) => edit({ color }, 'color')}
            />
          </FieldRow>
          <FieldRow label="Position">
            <Segmented
              label="Text position"
              className="w-48"
              value={
                s.position.x === 0.5 && [0.12, 0.5, 0.85].includes(s.position.y)
                  ? String(s.position.y)
                  : 'custom'
              }
              options={[
                { id: '0.12', label: 'Top' },
                { id: '0.5', label: 'Middle' },
                { id: '0.85', label: 'Bottom' },
              ]}
              onChange={(y) => edit({ position: { x: 0.5, y: Number(y) } })}
            />
          </FieldRow>
          <p className="text-xs text-muted-foreground">Or drag the text on the preview.</p>
        </Section>
      )}
      {s.kind === 'camera' && (
        <Section title="Camera layout">
          <FieldRow label="Layout">
            <Choice
              label="Camera layout"
              value={s.layout}
              options={CAMERA_LAYOUTS.map((l) => ({ id: l, label: LAYOUT_LABELS[l] }))}
              onChange={(layout) => edit({ layout: layout as CameraLayout })}
            />
          </FieldRow>
          <p className="text-xs text-muted-foreground">
            Overrides the webcam style from the Camera panel for this range, easing in and out.
          </p>
        </Section>
      )}
      {s.kind === 'blur' && (
        <Section title="Blur area">
          <RectEditor
            canvasRef={minimapRef}
            aspect={(recording.width * crop.width) / (recording.height * crop.height)}
            rect={s.rect}
            minimum={0.02}
            label="Blur area. Drag the box or its corners."
            onChange={(rect, done) => edit({ rect }, undefined, done)}
          />
          <RectFields
            rect={s.rect}
            prefix="Blur"
            minimum={0.02}
            onRect={(rect) => edit({ rect })}
          />
          <FieldRow label="Strength">
            <Slider
              thumbLabel="Blur strength"
              className="w-36"
              min={4}
              max={60}
              step={1}
              value={s.strength}
              onValueChange={(v) => edit({ strength: v as number }, 'strength')}
            />
            <output className="w-9 text-right text-xs tabular-nums">{s.strength}</output>
          </FieldRow>
          <p className="text-xs text-muted-foreground">
            The area follows the camera, so it stays on the same content while zoomed.
          </p>
        </Section>
      )}
      <Section title="Timing">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Segment start (s)"
            value={seconds(s.startUs)}
            onValue={(n) => edit({ startUs: us(Math.max(0, n)) })}
            suffix="s"
          />
          <NumberField
            label="Segment end (s)"
            value={seconds(s.endUs)}
            onValue={(n) => edit({ endUs: us(n) })}
            suffix="s"
          />
        </div>
      </Section>
    </Inspector>
  );
}
