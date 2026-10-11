import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, MousePointer2, RefreshCw, RotateCcw, Trash2 } from '@/src/components/app/icons';
import {
  ASPECTS,
  DEPTH_PRESETS,
  NO_MOVE,
  OFFSET_LIMIT,
  clamp,
  seconds,
  us,
  type Background,
  type Blur,
  type ClickStyle,
  type CursorSettings,
  type Force,
  type Point,
  type Project,
  type Recording,
  type Zoom,
} from '../domain/model';
import { GRADIENTS, WALLPAPERS, paintBackground } from '../engine/backgrounds';
import {
  loadWallpaperIndex,
  wallpaperThumbUrl,
  type PackWallpaper,
} from '../engine/wallpaper-pack';
import type { Camera } from '../engine/camera';
import {
  FieldRow,
  NumberField,
  Segmented,
  SwitchRow,
  Choice,
  TileGroup,
  ColorPicker,
} from '@/src/components/app/app';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/src/components/ui/accordion';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Slider } from '@/src/components/ui/slider';
import { Kbd } from '@/src/components/ui/kbd';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { cn } from '@/src/lib/utils';
import { PresetControls } from './presets-panel';
import {
  BackgroundMotionControls,
  CursorPackPicker,
  MoveControl,
  StageControls,
} from './stage-panel';

export type Update = (change: (p: Project) => Project, coalesce?: string) => void;

/**
 * Collapsible inspector sections. Open sections are remembered per panel in localStorage, so the
 * inspector keeps the layout the user chose.
 */
export function Inspector({ id, children }: { id: string; children: ReactNode }) {
  const key = `inspector:${id}`;
  const [closed, setClosed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const names = sectionNames(children);
  return (
    <Accordion
      multiple
      value={[...names].filter((s) => !closed.includes(s))}
      onValueChange={(open) => {
        const next = [...names].filter((s) => !(open as string[]).includes(s));
        setClosed(next);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* Storage can be unavailable; the layout then simply resets. */
        }
      }}
      className="gap-0"
    >
      {children}
    </Accordion>
  );
}
function sectionNames(children: ReactNode) {
  const names = new Set<string>();
  Children.forEach(children, (child) => {
    if (isValidElement<{ title?: string }>(child) && typeof child.props.title === 'string')
      names.add(child.props.title);
  });
  return names;
}

export function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={title} className="border-border">
      <AccordionTrigger className="px-4 py-3.5 text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase hover:text-foreground hover:no-underline aria-expanded:text-foreground">
        <span className="flex items-center gap-2">
          {title}
          {badge}
        </span>
      </AccordionTrigger>
      <AccordionContent className="grid gap-3 pb-4 [&_p:not(:last-child)]:mb-0">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

/** Non-collapsible block for content that should always be visible. */
export function Block({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-3 px-4 py-3.5 not-last:border-b', className)}>{children}</div>
  );
}

/** Background preview painted at thumbnail size. */
function SwatchCanvas({
  background,
  image,
}: {
  background: Background;
  image?: ImageBitmap | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(background);
  useEffect(() => {
    const c = canvas.current!,
      ctx = c.getContext('2d')!;
    const painted = paintBackground(background, c.width, c.height, image);
    ctx.clearRect(0, 0, c.width, c.height);
    if (painted) ctx.drawImage(painted, 0, 0);
    // Keyed by the serialized background; the object itself is recreated on every render.
  }, [key, image]);
  return (
    <canvas
      ref={canvas}
      width={112}
      height={70}
      aria-hidden
      className="block aspect-[16/10] w-full rounded-lg"
    />
  );
}

const BLURS: { id: Blur; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'light', label: 'Light' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'strong', label: 'Strong' },
];
const COLORS = [
  '#ffffff',
  '#f1f5f9',
  '#e2e8f0',
  '#0f172a',
  '#14532d',
  '#1e3a8a',
  '#7c2d12',
  '#fde68a',
];

/** Color field: a swatch popover with hex entry (see ColorPicker). */
export function ColorInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return <ColorPicker {...props} />;
}

const HIGHLIGHTS: { id: CursorSettings['highlight']['style']; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'ring', label: 'Ring' },
  { id: 'halo', label: 'Halo' },
  { id: 'spotlight', label: 'Spotlight' },
];

/** Overlay cursor and highlight. The captured cursor stays in the frames underneath. */
function CursorControls({ project, update }: { project: Project; update: Update }) {
  const { overlay: o, highlight: h } = project.cursor;
  const setOverlay = (patch: Partial<CursorSettings['overlay']>, coalesce?: string) =>
    update(
      (p) => ({ ...p, cursor: { ...p.cursor, overlay: { ...p.cursor.overlay, ...patch } } }),
      coalesce,
    );
  const setHighlight = (patch: Partial<CursorSettings['highlight']>, coalesce?: string) =>
    update(
      (p) => ({ ...p, cursor: { ...p.cursor, highlight: { ...p.cursor.highlight, ...patch } } }),
      coalesce,
    );
  return (
    <>
      <SwitchRow
        label="Overlay cursor"
        description="A larger cursor drawn on top of the captured one"
        checked={o.enabled}
        onChange={(enabled) => setOverlay({ enabled })}
      />
      {o.enabled && (
        <>
          <CursorPackPicker
            value={o.pack}
            color={o.color}
            onChange={(pack) => setOverlay({ pack })}
          />
          <FieldRow label="Size">
            <Slider
              thumbLabel="Cursor size"
              className="w-36"
              min={1}
              max={4}
              step={0.1}
              value={o.size}
              onValueChange={(v) => setOverlay({ size: v as number }, 'cursor-size')}
            />
            <output className="w-9 text-right text-xs tabular-nums">{o.size.toFixed(1)}×</output>
          </FieldRow>
          <Segmented
            label="Cursor shape"
            value={o.style}
            options={[
              { id: 'auto', label: 'Match page', title: 'Arrow, hand or text cursor as recorded' },
              { id: 'arrow', label: 'Always arrow' },
            ]}
            onChange={(style) => setOverlay({ style })}
          />
          <FieldRow label="Color">
            <ColorInput
              label="Cursor color"
              value={o.color}
              onChange={(color) => setOverlay({ color }, 'cursor-color')}
            />
          </FieldRow>
          <SwitchRow
            label="Cursor shadow"
            checked={o.shadow}
            onChange={(shadow) => setOverlay({ shadow })}
          />
        </>
      )}
      <FieldRow label="Highlight">
        <Choice
          label="Cursor highlight"
          value={h.style}
          options={HIGHLIGHTS}
          onChange={(style) => setHighlight({ style })}
        />
      </FieldRow>
      {h.style !== 'none' && (
        <>
          {h.style !== 'spotlight' && (
            <FieldRow label="Highlight color">
              <ColorInput
                label="Highlight color"
                value={h.color}
                onChange={(color) => setHighlight({ color }, 'highlight-color')}
              />
            </FieldRow>
          )}
          <FieldRow label="Highlight size">
            <Slider
              thumbLabel="Highlight size"
              className="w-36"
              min={0.5}
              max={3}
              step={0.05}
              value={h.size}
              onValueChange={(v) => setHighlight({ size: v as number }, 'highlight-size')}
            />
            <output className="w-9 text-right text-xs tabular-nums">{h.size.toFixed(1)}×</output>
          </FieldRow>
          <FieldRow label={h.style === 'spotlight' ? 'Dimming' : 'Opacity'}>
            <Slider
              thumbLabel={h.style === 'spotlight' ? 'Spotlight dimming' : 'Highlight opacity'}
              className="w-36"
              min={0.05}
              max={1}
              step={0.05}
              value={h.opacity}
              onValueChange={(v) => setHighlight({ opacity: v as number }, 'highlight-opacity')}
            />
            <output className="w-9 text-right text-xs tabular-nums">
              {Math.round(h.opacity * 100)}%
            </output>
          </FieldRow>
        </>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Chrome draws the real cursor into the recording, so it cannot be removed, smoothed or
        swapped; the overlay covers it exactly. Cursor tracking covers Chrome web pages only.
      </p>
    </>
  );
}

/**
 * Where the cursor sits inside a follow-cursor zoom. The box is the zoomed view; the camera keeps
 * the cursor at the dot (offset from the center as a fraction of the view, ±OFFSET_LIMIT).
 */
export function OffsetPad({
  label,
  value,
  aspect,
  onChange,
}: {
  label: string;
  value: Point;
  aspect: number;
  onChange: (offset: Point, done: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null),
    dragging = useRef(false);
  const limit = (n: number) => Math.round(clamp(n, -OFFSET_LIMIT, OFFSET_LIMIT) * 100) / 100;
  const at = (e: React.PointerEvent): Point => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: limit((e.clientX - r.left) / r.width - 0.5),
      y: limit((e.clientY - r.top) / r.height - 0.5),
    };
  };
  const centered = value.x === 0 && value.y === 0;
  return (
    <div className="grid gap-2">
      <div
        ref={box}
        role="group"
        tabIndex={0}
        aria-label={`${label}. Drag, or use the arrow keys, to move the cursor within the zoomed view.`}
        className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-lg border bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-muted/40 bg-[size:33.333%_33.333%] outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{ paddingTop: `${100 / Math.max(0.3, Math.min(4, aspect))}%` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          onChange(at(e), false);
        }}
        onPointerMove={(e) => dragging.current && onChange(at(e), false)}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          onChange(at(e), true);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          const d = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          }[e.key];
          if (!d) return;
          e.preventDefault();
          onChange({ x: limit(value.x + d[0]!), y: limit(value.y + d[1]!) }, true);
        }}
      >
        <span
          className="pointer-events-none absolute border border-dashed border-primary/40"
          style={{
            left: `${(0.5 - OFFSET_LIMIT) * 100}%`,
            top: `${(0.5 - OFFSET_LIMIT) * 100}%`,
            right: `${(0.5 - OFFSET_LIMIT) * 100}%`,
            bottom: `${(0.5 - OFFSET_LIMIT) * 100}%`,
          }}
        />
        <span className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full bg-muted-foreground/50" />
        <MousePointer2
          aria-hidden
          className="pointer-events-none absolute size-6 fill-foreground text-background drop-shadow"
          style={{ left: `${(0.5 + value.x) * 100}%`, top: `${(0.5 + value.y) * 100}%` }}
        />
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <NumberField
          label="Offset X (%)"
          min={-OFFSET_LIMIT * 100}
          max={OFFSET_LIMIT * 100}
          step={1}
          value={Math.round(value.x * 100)}
          onValue={(x) => onChange({ x: limit(x / 100), y: value.y }, true)}
        />
        <NumberField
          label="Offset Y (%)"
          min={-OFFSET_LIMIT * 100}
          max={OFFSET_LIMIT * 100}
          step={1}
          value={Math.round(value.y * 100)}
          onValue={(y) => onChange({ x: value.x, y: limit(y / 100) }, true)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={centered}
          onClick={() => onChange({ x: 0, y: 0 }, true)}
        >
          <RotateCcw /> Center
        </Button>
      </div>
    </div>
  );
}

export function StylePanel({
  project,
  update,
  onPickImage,
  customImage,
  webglMissing = false,
  recording,
}: {
  project: Project;
  recording: Recording;
  update: Update;
  onPickImage: (file: File) => void;
  customImage: ImageBitmap | null;
  webglMissing?: boolean;
}) {
  const c = project.composition,
    bg = c.background,
    tab = bg.type === 'custom' || bg.type === 'wallpaper' ? 'image' : bg.type,
    file = useRef<HTMLInputElement>(null);
  const [pack, setPack] = useState<PackWallpaper[]>([]);
  useEffect(() => {
    let live = true;
    void loadWallpaperIndex().then((list) => live && setPack(list));
    return () => {
      live = false;
    };
  }, []);
  const setBackground = (background: Background) =>
    update((p) => ({ ...p, composition: { ...p.composition, background } }));
  const blur =
    bg.type === 'image' || bg.type === 'custom' || bg.type === 'wallpaper' ? bg.blur : 'moderate';
  const fx = project.effects;
  const setClick = (patch: Partial<Project['effects']['click']>) =>
    update(
      (p) => ({ ...p, effects: { ...p.effects, click: { ...p.effects.click, ...patch } } }),
      'click',
    );
  const hidden = tab === 'hidden';
  return (
    <Inspector id="style">
      <Section title="Presets">
        <PresetControls project={project} recording={recording} update={update} />
      </Section>
      <Section title="Stage">
        <StageControls project={project} update={update} webglMissing={webglMissing} />
      </Section>
      <Section title="Canvas">
        <FieldRow label="Aspect ratio">
          <Choice
            label="Aspect ratio"
            value={c.aspect}
            options={ASPECTS}
            onChange={(aspect) =>
              update((p) => ({ ...p, composition: { ...p.composition, aspect } }))
            }
            className="w-40"
          />
        </FieldRow>
        {c.aspect !== 'native' && (
          <>
            <Segmented
              label="Fit"
              value={c.fit}
              options={[
                { id: 'contain', label: 'Show whole screen' },
                { id: 'fill', label: 'Fill and follow' },
              ]}
              onChange={(fit) => update((p) => ({ ...p, composition: { ...p.composition, fit } }))}
            />
            {c.fit === 'fill' && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                The video fills the frame and pans to follow the cursor, which suits vertical (9:16)
                clips. Padding and corners are off while filling.
              </p>
            )}
          </>
        )}
      </Section>
      <Section title="Background">
        <Segmented
          label="Background type"
          value={tab}
          options={[
            { id: 'image', label: 'Image' },
            { id: 'hidden', label: 'Hidden' },
            { id: 'gradient', label: 'Gradient' },
            { id: 'color', label: 'Color' },
          ]}
          onChange={(t) => {
            if (t === 'hidden') setBackground({ type: 'hidden' });
            if (t === 'image')
              setBackground({ type: 'image', preset: WALLPAPERS[0]!.id, blur: 'moderate' });
            if (t === 'gradient') setBackground({ type: 'gradient', preset: GRADIENTS[0]!.id });
            if (t === 'color') setBackground({ type: 'color', color: '#e2e8f0' });
          }}
        />
        {tab === 'image' && (
          <>
            {pack.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground">Wallpapers</p>
                <TileGroup
                  label="Wallpaper pack"
                  className="grid-cols-4"
                  itemClassName="min-h-0 p-0.5"
                  value={bg.type === 'wallpaper' ? bg.id : null}
                  options={pack.map((w) => ({
                    id: w.id,
                    label: `${w.name} wallpaper`,
                    content: (
                      <img
                        src={wallpaperThumbUrl(w.id)}
                        alt=""
                        loading="lazy"
                        className="block aspect-[16/10] w-full rounded-lg object-cover"
                      />
                    ),
                  }))}
                  onChange={(id) =>
                    setBackground({
                      type: 'wallpaper',
                      id,
                      blur: bg.type === 'wallpaper' ? bg.blur : 'none',
                    })
                  }
                />
                <p className="text-xs font-semibold text-muted-foreground">Lensprout</p>
              </>
            )}
            <TileGroup
              label="Wallpaper"
              className="grid-cols-4"
              itemClassName="min-h-0 p-0.5"
              value={bg.type === 'image' ? bg.preset : null}
              options={WALLPAPERS.map((w) => ({
                id: w.id,
                label: `${w.name} wallpaper`,
                content: (
                  <SwatchCanvas background={{ type: 'image', preset: w.id, blur: 'light' }} />
                ),
              }))}
              onChange={(preset) => setBackground({ type: 'image', preset, blur })}
            />
            <Button
              variant="outline"
              className="h-auto justify-start gap-3 p-1.5"
              onClick={() => file.current?.click()}
            >
              <span className="grid aspect-[16/10] w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-dashed bg-muted">
                {bg.type === 'custom' && customImage ? (
                  <span className="pointer-events-none w-full">
                    <SwatchCanvas background={bg} image={customImage} />
                  </span>
                ) : (
                  <ImagePlus className="size-4 text-muted-foreground" />
                )}
              </span>
              {bg.type === 'custom' ? 'Replace custom image' : 'Select custom image'}
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              aria-label="Custom background image"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickImage(f);
                e.target.value = '';
              }}
            />
            <FieldRow label="Image blur">
              <Choice
                label="Image blur"
                value={blur}
                options={BLURS}
                onChange={(value) => {
                  if (bg.type === 'image' || bg.type === 'custom' || bg.type === 'wallpaper')
                    setBackground({ ...bg, blur: value });
                }}
              />
            </FieldRow>
          </>
        )}
        {tab === 'gradient' && (
          <TileGroup
            label="Gradient"
            className="grid-cols-4"
            itemClassName="min-h-0 p-0.5"
            value={bg.type === 'gradient' ? bg.preset : null}
            options={GRADIENTS.map((g) => ({
              id: g.id,
              label: `${g.name} gradient`,
              content: <SwatchCanvas background={{ type: 'gradient', preset: g.id }} />,
            }))}
            onChange={(preset) => setBackground({ type: 'gradient', preset })}
          />
        )}
        {tab === 'color' && (
          <div className="flex flex-wrap items-center gap-2">
            <TileGroup
              label="Background color"
              className="flex w-auto flex-wrap gap-2"
              itemClassName="size-8 min-h-0 min-w-0 rounded-full border-2 border-border p-0 aria-pressed:ring-2 aria-pressed:ring-primary/30"
              value={bg.type === 'color' ? bg.color : null}
              options={COLORS.map((color) => ({
                id: color,
                label: `Background ${color}`,
                content: <span className="sr-only">{color}</span>,
                style: { background: color },
              }))}
              onChange={(color) => setBackground({ type: 'color', color })}
            />
            <ColorInput
              label="Background color"
              value={bg.type === 'color' ? bg.color : '#e2e8f0'}
              onChange={(color) => setBackground({ type: 'color', color })}
            />
          </div>
        )}
        {hidden && (
          <p className="text-xs text-muted-foreground">
            The recording fills the whole video with no padding or frame.
          </p>
        )}
        <BackgroundMotionControls project={project} update={update} disabled={hidden} />
      </Section>
      <Section title="Frame">
        <FieldRow label="Padding" className={cn(hidden && 'opacity-50')}>
          <Slider
            thumbLabel="Padding"
            className="w-36"
            min={0}
            max={0.2}
            step={0.005}
            disabled={hidden}
            value={c.padding}
            onValueChange={(v) =>
              update(
                (p) => ({ ...p, composition: { ...p.composition, padding: v as number } }),
                'padding',
              )
            }
          />
          <output className="w-9 text-right text-xs tabular-nums">
            {Math.round(c.padding * 100)}%
          </output>
        </FieldRow>
        <FieldRow label="Corners" className={cn(hidden && 'opacity-50')}>
          <Slider
            thumbLabel="Corner radius"
            className="w-36"
            min={0}
            max={48}
            step={1}
            disabled={hidden}
            value={c.radius}
            onValueChange={(v) =>
              update(
                (p) => ({ ...p, composition: { ...p.composition, radius: v as number } }),
                'radius',
              )
            }
          />
          <output className="w-9 text-right text-xs tabular-nums">{c.radius}</output>
        </FieldRow>
        <SwitchRow
          label="Drop shadow"
          checked={c.shadow}
          disabled={hidden}
          onChange={(shadow) =>
            update((p) => ({ ...p, composition: { ...p.composition, shadow } }))
          }
        />
      </Section>
      <Section title="Cursor">
        <CursorControls project={project} update={update} />
      </Section>
      <Section title="Click animation">
        <FieldRow label="Style">
          <Choice
            label="Click style"
            value={fx.click.style}
            options={[
              { id: 'none', label: 'None' },
              { id: 'orb', label: 'Orb' },
              { id: 'ring', label: 'Ring' },
            ]}
            onChange={(style) => setClick({ style: style as ClickStyle })}
          />
        </FieldRow>
        <FieldRow label="Force">
          <Choice
            label="Click force"
            value={fx.click.force}
            disabled={fx.click.style === 'none'}
            options={[
              { id: 'weak', label: 'Weak' },
              { id: 'moderate', label: 'Moderate' },
              { id: 'strong', label: 'Strong' },
            ]}
            onChange={(force) => setClick({ force: force as Force })}
          />
        </FieldRow>
        <FieldRow label="Color">
          <ColorInput
            label="Click color"
            value={fx.click.color}
            disabled={fx.click.style === 'none'}
            onChange={(color) => setClick({ color })}
          />
        </FieldRow>
      </Section>
      <Section title="Effects">
        <SwitchRow
          label="Motion blur"
          checked={fx.motionBlur}
          onChange={(motionBlur) =>
            update((p) => ({ ...p, effects: { ...p.effects, motionBlur } }))
          }
        />
        <SwitchRow
          label="Keyboard shortcuts"
          description="Shows modifier shortcuts pressed while recording"
          checked={fx.keystrokes}
          onChange={(keystrokes) =>
            update((p) => ({ ...p, effects: { ...p.effects, keystrokes } }))
          }
        />
      </Section>
      <Section title="Sounds">
        <SwitchRow
          label="Click sounds"
          description="A soft click on every mouse press"
          checked={fx.sounds.clicks}
          onChange={(clicks) =>
            update((p) => ({
              ...p,
              effects: { ...p.effects, sounds: { ...p.effects.sounds, clicks } },
            }))
          }
        />
        <SwitchRow
          label="Keyboard sounds"
          description="A light tick while typing and for shortcuts"
          checked={fx.sounds.keys}
          onChange={(keys) =>
            update((p) => ({
              ...p,
              effects: { ...p.effects, sounds: { ...p.effects.sounds, keys } },
            }))
          }
        />
        {(fx.sounds.clicks || fx.sounds.keys) && (
          <FieldRow label="Sound volume">
            <Slider
              thumbLabel="Sound volume"
              className="w-36"
              min={0.05}
              max={1}
              step={0.05}
              value={fx.sounds.volume}
              onValueChange={(v) =>
                update(
                  (p) => ({
                    ...p,
                    effects: { ...p.effects, sounds: { ...p.effects.sounds, volume: v as number } },
                  }),
                  'sound-volume',
                )
              }
            />
            <output className="w-9 text-right text-xs tabular-nums">
              {Math.round(fx.sounds.volume * 100)}%
            </output>
          </FieldRow>
        )}
      </Section>
    </Inspector>
  );
}

function DepthControl({
  value,
  onChange,
  label = 'Zoom depth',
}: {
  value: number;
  onChange: (value: number, coalesce?: string) => void;
  label?: string;
}) {
  const preset = DEPTH_PRESETS.find((d) => Math.abs(d.value - value) < 1e-6)?.id ?? 'custom';
  return (
    <div className="grid gap-3">
      <FieldRow label="Preset">
        <Choice
          label={`${label} preset`}
          value={preset}
          options={[
            ...DEPTH_PRESETS.map((d) => ({ id: d.id, label: d.label })),
            ...(preset === 'custom' ? [{ id: 'custom', label: 'Custom' }] : []),
          ]}
          onChange={(id) => {
            const p = DEPTH_PRESETS.find((d) => d.id === id);
            if (p) onChange(p.value);
          }}
        />
      </FieldRow>
      <FieldRow label="Depth">
        <Slider
          thumbLabel={label}
          className="w-36"
          min={1.1}
          max={4}
          step={0.05}
          value={value}
          onValueChange={(v) => onChange(v as number, label)}
        />
        <output className="w-11 text-right text-xs font-semibold tabular-nums">
          {value.toFixed(2)}×
        </output>
      </FieldRow>
    </div>
  );
}

/** Full-frame source thumbnail with a draggable focus target or frame rectangle. */
function Minimap({
  minimapRef,
  aspect,
  zoom,
  camera,
  pointer,
  mode,
  onFocus,
}: {
  minimapRef: (canvas: HTMLCanvasElement | null) => void;
  aspect: number;
  zoom: Zoom;
  camera?: Camera;
  pointer?: Point;
  mode: 'target' | 'frame';
  onFocus: (point: Point, done: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null),
    dragging = useRef(false);
  const fixed = zoom.focus.mode === 'fixed' ? zoom.focus.point : null;
  const toPoint = (e: React.PointerEvent): Point => {
    const r = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  // Fill projects view a narrower column (fx) or band (fy) of the frame.
  const fx = camera?.fx ?? 1,
    fy = camera?.fy ?? 1,
    hx = (0.5 * fx) / zoom.magnification,
    hy = (0.5 * fy) / zoom.magnification;
  const view =
    mode === 'frame' && fixed
      ? {
          x: clamp(fixed.x, hx, 1 - hx),
          y: clamp(fixed.y, hy, 1 - hy),
          zoom: zoom.magnification,
          fx,
          fy,
        }
      : camera;
  return (
    <div
      ref={box}
      className={cn(
        'relative w-full touch-none overflow-hidden rounded-lg bg-black select-none',
        fixed && 'cursor-crosshair',
      )}
      // Padding keeps the box height explicit for the grid; the canvas fills it absolutely.
      style={{ paddingTop: `${100 / aspect}%` }}
      onPointerDown={(e) => {
        if (!fixed) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        onFocus(toPoint(e), false);
      }}
      onPointerMove={(e) => dragging.current && onFocus(toPoint(e), false)}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        onFocus(toPoint(e), true);
      }}
    >
      <canvas
        ref={minimapRef}
        aria-label="Source frame. Drag to place the zoom focus."
        className="absolute inset-0 size-full"
      />
      {view && (mode === 'frame' || !fixed) && (
        <span
          className="pointer-events-none absolute rounded border-2 border-green-400 shadow-[0_0_0_999px_rgba(0,0,0,0.45)]"
          style={{
            left: `${(view.x - (0.5 * view.fx) / view.zoom) * 100}%`,
            top: `${(view.y - (0.5 * view.fy) / view.zoom) * 100}%`,
            width: `${(100 * view.fx) / view.zoom}%`,
            height: `${(100 * view.fy) / view.zoom}%`,
          }}
        />
      )}
      {fixed && mode === 'target' && (
        <span
          className="pointer-events-none absolute -mt-4 -ml-4 size-8 rounded-full border-4 border-red-500 bg-[radial-gradient(circle,#fff_0_4px,#ef4444_4px_6px,transparent_6px)] shadow-[0_0_0_2px_rgba(255,255,255,0.85)]"
          style={{ left: `${fixed.x * 100}%`, top: `${fixed.y * 100}%` }}
        />
      )}
      {!fixed && pointer && (
        <span
          className="pointer-events-none absolute -mt-1.5 -ml-1.5 size-3 rounded-full border-2 border-green-500 bg-white"
          style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }}
        />
      )}
    </div>
  );
}

export function ZoomPanel({
  project,
  recording,
  selected,
  time,
  camera,
  pointer,
  minimapRef,
  update,
  preview,
  onDelete,
  onRegenerate,
}: {
  project: Project;
  recording: Recording;
  selected: Zoom[];
  time: number;
  camera?: Camera;
  pointer?: Point;
  minimapRef: (canvas: HTMLCanvasElement | null) => void;
  update: Update;
  preview: (change: (p: Project) => Project) => void;
  onDelete: () => void;
  onRegenerate: () => void;
}) {
  const [tab, setTab] = useState<'segment' | 'global'>(selected.length ? 'segment' : 'global');
  const [mode, setMode] = useState<'target' | 'frame'>('target');
  const firstId = selected[0]?.id;
  useEffect(() => {
    if (firstId) setTab('segment');
  }, [firstId]);
  const ids = new Set(selected.map((z) => z.id));
  const editSelected = (patch: (z: Zoom) => Partial<Zoom>, coalesce?: string) =>
    update(
      (p) => ({
        ...p,
        zooms: p.zooms.map((z) =>
          ids.has(z.id) ? { ...z, ...patch(z), provenance: 'manual' } : z,
        ),
      }),
      coalesce,
    );
  const zoom = selected.length === 1 ? selected[0]! : undefined;
  const active = tab === 'segment' && selected.length ? 'segment' : 'global';
  const crop = project.composition.crop;
  return (
    <div className="grid gap-4">
      <Segmented
        label="Zoom settings scope"
        value={active}
        options={[
          { id: 'segment', label: 'Segment' },
          { id: 'global', label: 'Global' },
        ]}
        onChange={setTab}
      />
      {active === 'segment' && zoom && (
        <Inspector id="zoom-segment">
          <Block>
            <div className="flex items-center gap-2">
              <Badge variant={zoom.provenance === 'generated' ? 'secondary' : 'default'}>
                {zoom.provenance === 'generated' ? 'Auto' : 'Manual'}
              </Badge>
              <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {seconds(zoom.startUs).toFixed(2)}–{seconds(zoom.endUs).toFixed(2)} s
              </span>
              <span className="flex-1" />
              <Button variant="destructive" size="sm" onClick={onDelete} aria-label="Delete zoom">
                <Trash2 /> Delete
              </Button>
            </div>
          </Block>
          <Section title="Position">
            <Segmented
              label="Focus"
              value={zoom.focus.mode}
              options={[
                { id: 'follow-pointer', label: 'Follow cursor' },
                { id: 'fixed', label: 'Fixed' },
              ]}
              onChange={(m) =>
                editSelected(() => ({
                  focus:
                    m === 'fixed'
                      ? {
                          mode: 'fixed',
                          point: camera
                            ? { x: camera.x, y: camera.y }
                            : (pointer ?? { x: 0.5, y: 0.5 }),
                        }
                      : project.autoZoom.offset.x || project.autoZoom.offset.y
                        ? { mode: 'follow-pointer', offset: { ...project.autoZoom.offset } }
                        : { mode: 'follow-pointer' },
                }))
              }
            />
            {zoom.focus.mode === 'fixed' && (
              <Segmented
                label="Fixed focus mode"
                value={mode}
                options={[
                  { id: 'target', label: 'Target' },
                  { id: 'frame', label: 'Frame' },
                ]}
                onChange={setMode}
              />
            )}
            <Minimap
              minimapRef={minimapRef}
              aspect={(recording.width * crop.width) / (recording.height * crop.height)}
              zoom={zoom}
              camera={camera}
              pointer={pointer}
              mode={mode}
              onFocus={(point, done) => {
                const change = (p: Project) => ({
                  ...p,
                  zooms: p.zooms.map((z) =>
                    z.id === zoom.id
                      ? {
                          ...z,
                          focus: { mode: 'fixed' as const, point },
                          provenance: 'manual' as const,
                        }
                      : z,
                  ),
                });
                if (done) update(change);
                else preview(change);
              }}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {zoom.focus.mode === 'fixed'
                ? mode === 'frame'
                  ? 'Drag the frame to choose what stays visible; depth sets its size.'
                  : 'Drag the target to choose the zoom center.'
                : 'The camera follows the recorded cursor and only pans when it nears the edge of the view.'}
            </p>
            {zoom.focus.mode === 'follow-pointer' && (
              <>
                <span className="text-sm font-medium">Cursor position in the zoomed view</span>
                <OffsetPad
                  label="Cursor position in the zoomed view"
                  aspect={(recording.width * crop.width) / (recording.height * crop.height)}
                  value={zoom.focus.offset ?? { x: 0, y: 0 }}
                  onChange={(offset, done) => {
                    const change = (p: Project) => ({
                      ...p,
                      zooms: p.zooms.map((z) =>
                        z.id === zoom.id
                          ? {
                              ...z,
                              focus: {
                                mode: 'follow-pointer' as const,
                                ...(offset.x || offset.y ? { offset } : {}),
                              },
                              provenance: 'manual' as const,
                            }
                          : z,
                      ),
                    });
                    if (done) update(change);
                    else preview(change);
                  }}
                />
              </>
            )}
            {zoom.focus.mode === 'fixed' && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Focus X (0–1)"
                  min={0}
                  max={1}
                  step={0.01}
                  value={zoom.focus.point.x}
                  onValue={(x) =>
                    editSelected((z) => ({
                      focus: {
                        mode: 'fixed',
                        point: { x: clamp(x), y: z.focus.mode === 'fixed' ? z.focus.point.y : 0.5 },
                      },
                    }))
                  }
                />
                <NumberField
                  label="Focus Y (0–1)"
                  min={0}
                  max={1}
                  step={0.01}
                  value={zoom.focus.point.y}
                  onValue={(y) =>
                    editSelected((z) => ({
                      focus: {
                        mode: 'fixed',
                        point: { x: z.focus.mode === 'fixed' ? z.focus.point.x : 0.5, y: clamp(y) },
                      },
                    }))
                  }
                />
              </div>
            )}
          </Section>
          <Section title="3D camera move">
            <MoveControl
              label="Camera move"
              value={zoom.move ?? project.stage.defaultMove ?? NO_MOVE}
              threeD={project.stage.mode === '3d'}
              onChange={(move, coalesce) => editSelected(() => ({ move }), coalesce)}
            />
          </Section>
          <Section title="Depth">
            <DepthControl
              value={zoom.magnification}
              onChange={(magnification, coalesce) =>
                editSelected(() => ({ magnification }), coalesce)
              }
            />
            <NumberField
              label="Magnification"
              value={zoom.magnification}
              min={1}
              max={4}
              onValue={(n) => editSelected(() => ({ magnification: clamp(n, 1, 4) }))}
              suffix="×"
            />
          </Section>
          <Section title="Timing">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Zoom start (s)"
                value={seconds(zoom.startUs)}
                onValue={(n) => editSelected(() => ({ startUs: us(Math.max(0, n)) }))}
                min={0}
                max={seconds(zoom.endUs)}
                suffix="s"
              />
              <NumberField
                label="Zoom end (s)"
                value={seconds(zoom.endUs)}
                onValue={(n) => editSelected(() => ({ endUs: us(n) }))}
                min={seconds(zoom.startUs)}
                max={seconds(recording.durationUs)}
                suffix="s"
              />
            </div>
          </Section>
        </Inspector>
      )}
      {active === 'segment' && selected.length > 1 && (
        <Inspector id="zoom-multi">
          <Block>
            <div className="flex items-center gap-2">
              <strong>{selected.length} zooms selected</strong>
              <span className="flex-1" />
              <Button variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 /> Delete
              </Button>
            </div>
          </Block>
          <Section title="Depth">
            <DepthControl
              value={selected[0]!.magnification}
              onChange={(magnification, coalesce) =>
                editSelected(() => ({ magnification }), coalesce)
              }
            />
          </Section>
        </Inspector>
      )}
      {active === 'global' && (
        <Inspector id="zoom-global">
          {!selected.length && (
            <Block>
              <p className="text-xs text-muted-foreground">
                Select a zoom on the timeline to edit it.
              </p>
            </Block>
          )}
          <Section title="Default depth">
            <DepthControl
              label="Default zoom depth"
              value={project.autoZoom.depth}
              onChange={(depth, coalesce) =>
                update((p) => ({ ...p, autoZoom: { ...p.autoZoom, depth } }), coalesce)
              }
            />
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                update((p) => ({
                  ...p,
                  zooms: p.zooms.map((z) => ({ ...z, magnification: p.autoZoom.depth })),
                }))
              }
            >
              Apply to all zooms
            </Button>
          </Section>
          <Section title="Default camera move">
            <MoveControl
              label="Default camera move"
              value={project.stage.defaultMove}
              threeD={project.stage.mode === '3d'}
              onChange={(defaultMove, coalesce) =>
                update((p) => ({ ...p, stage: { ...p.stage, defaultMove } }), coalesce)
              }
            />
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                update((p) => ({
                  ...p,
                  zooms: p.zooms.map((z) => ({ ...z, move: { ...p.stage.defaultMove } })),
                }))
              }
            >
              Apply move to all zooms
            </Button>
          </Section>
          <Section title="Cursor offset">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Where the cursor sits in follow-cursor zooms. Off-center shows more of the page on the
              other side, for example place it lower left to see more up and to the right.
            </p>
            <OffsetPad
              label="Default cursor position in zoomed views"
              aspect={(recording.width * crop.width) / (recording.height * crop.height)}
              value={project.autoZoom.offset}
              onChange={(offset, done) => {
                const change = (p: Project) => ({ ...p, autoZoom: { ...p.autoZoom, offset } });
                if (done) update(change);
                else preview(change);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                update((p) => {
                  const offset = p.autoZoom.offset,
                    centered = !offset.x && !offset.y;
                  return {
                    ...p,
                    zooms: p.zooms.map((z) =>
                      z.focus.mode === 'follow-pointer'
                        ? {
                            ...z,
                            focus: centered
                              ? { mode: 'follow-pointer' }
                              : { mode: 'follow-pointer', offset: { ...offset } },
                          }
                        : z,
                    ),
                  };
                })
              }
            >
              Apply to all follow zooms
            </Button>
          </Section>
          <Section title="Automatic zoom">
            <SwitchRow
              label="Zoom while typing"
              checked={project.autoZoom.typing}
              onChange={(typing) => update((p) => ({ ...p, autoZoom: { ...p.autoZoom, typing } }))}
            />
            <Button variant="secondary" className="justify-self-start" onClick={onRegenerate}>
              <RefreshCw /> Regenerate auto zoom
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Zooms come from click clusters, presses longer than 2 s and typing. A single, isolated
              click does not zoom. Regenerating keeps the zooms you edited.
            </p>
            {recording.pointerTracked === false && (
              <Alert>
                <AlertDescription className="text-xs">
                  Cursor tracking was unavailable for this capture, so no automatic zooms exist. Add
                  zooms manually with fixed focus.
                </AlertDescription>
              </Alert>
            )}
            {recording.source !== 'tab' && recording.pointerTracked !== false && (
              <p className="text-xs text-muted-foreground">
                Screen recordings track the cursor over Chrome web pages; other apps get no
                automatic zoom.
              </p>
            )}
          </Section>
          <Block>
            <p className="text-xs text-muted-foreground tabular-nums">
              At {seconds(time).toFixed(2)} s
            </p>
          </Block>
        </Inspector>
      )}
    </div>
  );
}

export function ClipPanel({
  project,
  recording,
  update,
}: {
  project: Project;
  recording: Recording;
  update: Update;
}) {
  const t = project.trim;
  const source =
    recording.source === 'tab'
      ? 'Browser tab'
      : recording.source === 'window'
        ? 'Window'
        : 'Entire screen';
  return (
    <Inspector id="clip">
      <Section title="Trim">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Trim start (s)"
            min={0}
            max={seconds(t.endUs)}
            value={seconds(t.startUs)}
            suffix="s"
            onValue={(n) =>
              update((p) => ({ ...p, trim: { ...p.trim, startUs: us(Math.max(0, n)) } }))
            }
          />
          <NumberField
            label="Trim end (s)"
            min={seconds(t.startUs)}
            max={seconds(recording.durationUs)}
            value={seconds(t.endUs)}
            suffix="s"
            onValue={(n) => update((p) => ({ ...p, trim: { ...p.trim, endUs: us(n) } }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Or drag the orange handles on the clip track. The source recording is never cut.
        </p>
      </Section>
      <Section title="Source">
        <dl className="grid gap-2 text-sm">
          {[
            ['Captured', source],
            ['Size', `${recording.width} × ${recording.height}`],
            ['Length', `${seconds(recording.durationUs).toFixed(2)} s`],
            ['Audio', recording.hasAudio ? 'Yes' : 'No'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </Inspector>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Command palette'],
  ['Space', 'Play / pause'],
  ['← / →', 'Previous / next frame'],
  ['⇧ ← / →', 'Back / forward 1 s'],
  ['Home / End', 'Jump to trim start / end'],
  ['A', 'Add zoom at playhead'],
  ['S', 'Split selected segment'],
  ['Delete', 'Delete selected segments'],
  ['Ctrl Z / Ctrl ⇧ Z', 'Undo / redo'],
  ['Ctrl + / − / 0', 'Zoom timeline in / out / fit'],
  ['Esc', 'Clear selection'],
];

export function HelpPanel() {
  return (
    <Inspector id="help">
      <Section title="Keyboard shortcuts">
        <dl className="grid gap-2 text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <dd className="text-muted-foreground">{v}</dd>
              <dt>
                <Kbd>{k}</Kbd>
              </dt>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="About this project">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Recordings, edits and exports stay in this browser profile. The source recording is never
          modified; edits are stored separately and autosave. Right-click timeline segments for more
          actions.
        </p>
      </Section>
    </Inspector>
  );
}
