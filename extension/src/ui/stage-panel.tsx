import { useEffect, useRef } from 'react';
import { AppWindow, Laptop, Monitor, Smartphone, Square, Tablet } from '@/src/components/app/icons';
import {
  BACKGROUND_MOTIONS,
  CURSOR_PACKS,
  TILT_LIMIT,
  type BackgroundMotion,
  type CameraMove,
  type CursorPack,
  type DeviceKind,
  type Project,
  type Stage,
} from '../domain/model';
import { paintCursor } from '../engine/cursor';
import { FieldRow, Segmented, Choice, TileGroup } from '@/src/components/app/app';
import { Slider } from '@/src/components/ui/slider';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { cn } from '@/src/lib/utils';

type Update = (change: (p: Project) => Project, coalesce?: string) => void;

const DEVICE_OPTIONS: { id: DeviceKind; label: string; icon: typeof Laptop }[] = [
  { id: 'none', label: 'No frame', icon: Square },
  { id: 'browser', label: 'Browser', icon: AppWindow },
  { id: 'laptop', label: 'Laptop', icon: Laptop },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'phone', label: 'Phone', icon: Smartphone },
  { id: 'monitor', label: 'Monitor', icon: Monitor },
];
/** Resting poses; positive yaw faces left, negative pitch leans the top away. */
const TILTS = [
  { id: 'straight', label: 'Straight', tilt: { yaw: 0, pitch: 0 } },
  { id: 'left', label: 'Left', tilt: { yaw: 14, pitch: -6 } },
  { id: 'right', label: 'Right', tilt: { yaw: -14, pitch: -6 } },
  { id: 'top', label: 'Top', tilt: { yaw: 0, pitch: -14 } },
] as const;

/** Style → Stage: flat or 3D, device frame, resting tilt and perspective. */
export function StageControls({
  project,
  update,
  webglMissing,
}: {
  project: Project;
  update: Update;
  webglMissing: boolean;
}) {
  const st = project.stage;
  const set = (patch: Partial<Stage>, coalesce?: string) =>
    update((p) => ({ ...p, stage: { ...p.stage, ...patch } }), coalesce);
  const preset = TILTS.find((t) => t.tilt.yaw === st.tilt.yaw && t.tilt.pitch === st.tilt.pitch);
  const three = st.mode === '3d';
  return (
    <>
      <Segmented
        label="Stage"
        value={st.mode}
        options={[
          { id: 'flat', label: 'Flat' },
          { id: '3d', label: '3D' },
        ]}
        onChange={(mode) => set({ mode })}
      />
      <TileGroup
        label="Device frame"
        value={st.device}
        options={DEVICE_OPTIONS.map((d) => ({
          id: d.id,
          label: d.label,
          content: (
            <>
              <d.icon className="size-5" />
              {d.label}
            </>
          ),
        }))}
        onChange={(device) => set({ device })}
      />
      {st.device !== 'none' && (
        <Segmented
          label="Device finish"
          value={st.deviceTheme}
          options={[
            { id: 'dark', label: 'Space gray' },
            { id: 'light', label: 'Silver' },
          ]}
          onChange={(deviceTheme) => set({ deviceTheme })}
        />
      )}
      {three && (
        <>
          <Segmented
            label="Resting tilt"
            value={preset?.id ?? 'custom'}
            options={TILTS.map((t) => ({ id: t.id, label: t.label }))}
            onChange={(id) => set({ tilt: { ...TILTS.find((t) => t.id === id)!.tilt } })}
          />
          <FieldRow label="Turn">
            <Slider
              thumbLabel="Resting turn"
              className="w-36"
              min={-TILT_LIMIT}
              max={TILT_LIMIT}
              step={1}
              value={st.tilt.yaw}
              onValueChange={(v) => set({ tilt: { ...st.tilt, yaw: v as number } }, 'tilt-yaw')}
            />
            <output className="w-9 text-right text-xs tabular-nums">{st.tilt.yaw}°</output>
          </FieldRow>
          <FieldRow label="Lean">
            <Slider
              thumbLabel="Resting lean"
              className="w-36"
              min={-TILT_LIMIT}
              max={TILT_LIMIT}
              step={1}
              value={st.tilt.pitch}
              onValueChange={(v) => set({ tilt: { ...st.tilt, pitch: v as number } }, 'tilt-pitch')}
            />
            <output className="w-9 text-right text-xs tabular-nums">{st.tilt.pitch}°</output>
          </FieldRow>
          <FieldRow label="Perspective">
            <Slider
              thumbLabel="Perspective"
              className="w-36"
              min={0}
              max={1}
              step={0.05}
              value={st.perspective}
              onValueChange={(v) => set({ perspective: v as number }, 'perspective')}
            />
            <output className="w-9 text-right text-xs tabular-nums">
              {Math.round(st.perspective * 100)}%
            </output>
          </FieldRow>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Each zoom can tilt, orbit, dolly or swing toward clicks: pick its camera move in the
            Zoom panel.
          </p>
        </>
      )}
      {webglMissing && (st.mode === '3d' || st.device !== 'none') && (
        <Alert>
          <AlertDescription className="text-xs">
            3D, device frames and animated backgrounds need WebGL2, which this browser does not
            provide. The preview and export render flat.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

const MOVE_LABELS: Record<CameraMove['kind'], string> = {
  none: 'None',
  tilt: 'Tilt',
  orbit: 'Orbit',
  dolly: 'Dolly',
  swing: 'Swing',
};
const MOVE_HELP: Record<CameraMove['kind'], string> = {
  none: 'The stage keeps its resting tilt.',
  tilt: 'Turns the screen to one side while zoomed.',
  orbit: 'Sweeps slowly around the screen across the zoom.',
  dolly: 'Pushes the camera in for extra depth.',
  swing: 'Turns toward the cursor and clicks. Strong settings can feel busy.',
};

/** Camera move editor for one zoom (or the default for automatic zooms). */
export function MoveControl({
  label,
  value,
  onChange,
  threeD,
}: {
  label: string;
  value: CameraMove;
  onChange: (move: CameraMove, coalesce?: string) => void;
  threeD: boolean;
}) {
  return (
    <>
      <Segmented
        label={label}
        value={value.kind}
        options={(Object.keys(MOVE_LABELS) as CameraMove['kind'][]).map((id) => ({
          id,
          label: MOVE_LABELS[id],
        }))}
        onChange={(kind) => onChange({ ...value, kind })}
      />
      {(value.kind === 'tilt' || value.kind === 'orbit') && (
        <Segmented
          label={`${label} direction`}
          value={value.direction}
          options={[
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ]}
          onChange={(direction) => onChange({ ...value, direction })}
        />
      )}
      {value.kind !== 'none' && (
        <FieldRow label="Strength">
          <Slider
            thumbLabel={`${label} strength`}
            className="w-36"
            min={0.2}
            max={1}
            step={0.05}
            value={value.strength}
            onValueChange={(v) => onChange({ ...value, strength: v as number }, 'move-strength')}
          />
          <output className="w-9 text-right text-xs tabular-nums">
            {Math.round(value.strength * 100)}%
          </output>
        </FieldRow>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {threeD ? MOVE_HELP[value.kind] : 'Camera moves play when the stage is 3D (Style → Stage).'}
      </p>
    </>
  );
}

const MOTION_LABELS: Record<BackgroundMotion['kind'], string> = {
  none: 'Still',
  drift: 'Drift',
  aurora: 'Aurora',
  waves: 'Waves',
};
/** Style → Background motion. */
export function BackgroundMotionControls({
  project,
  update,
  disabled,
}: {
  project: Project;
  update: Update;
  disabled?: boolean;
}) {
  const m = project.composition.backgroundMotion;
  const set = (patch: Partial<BackgroundMotion>, coalesce?: string) =>
    update(
      (p) => ({
        ...p,
        composition: {
          ...p.composition,
          backgroundMotion: { ...p.composition.backgroundMotion, ...patch },
        },
      }),
      coalesce,
    );
  return (
    <>
      <FieldRow label="Motion" className={cn(disabled && 'opacity-50')}>
        <Choice
          label="Background motion"
          value={m.kind}
          disabled={disabled}
          options={BACKGROUND_MOTIONS.map((k) => ({ id: k, label: MOTION_LABELS[k] }))}
          onChange={(kind) => set({ kind })}
        />
      </FieldRow>
      {m.kind !== 'none' && !disabled && (
        <FieldRow label="Speed">
          <Slider
            thumbLabel="Background motion speed"
            className="w-36"
            min={0.25}
            max={2}
            step={0.05}
            value={m.speed}
            onValueChange={(v) => set({ speed: v as number }, 'motion-speed')}
          />
          <output className="w-9 text-right text-xs tabular-nums">{m.speed.toFixed(2)}×</output>
        </FieldRow>
      )}
    </>
  );
}

const PACK_LABELS: Record<CursorPack, string> = {
  classic: 'Classic',
  glass: 'Glass',
  pop: 'Pop',
  ink: 'Ink',
  sprout: 'Sprout',
};
function PackSwatch({ pack, color }: { pack: CursorPack; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!,
      ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    paintCursor(ctx, pack, 'arrow', 14, 8, 30, color, true);
    paintCursor(ctx, pack, 'pointer', 46, 10, 28, color, true);
  }, [pack, color]);
  return <canvas ref={canvas} width={72} height={48} className="h-12 w-[72px]" aria-hidden />;
}
/** Style → Cursor pack picker (swatches draw the real shapes). */
export function CursorPackPicker({
  value,
  color,
  onChange,
}: {
  value: CursorPack;
  color: string;
  onChange: (pack: CursorPack) => void;
}) {
  return (
    <TileGroup
      label="Cursor pack"
      value={value}
      options={CURSOR_PACKS.map((pack) => ({
        id: pack,
        label: PACK_LABELS[pack],
        content: (
          <>
            <PackSwatch pack={pack} color={color} />
            {PACK_LABELS[pack]}
          </>
        ),
      }))}
      onChange={onChange}
    />
  );
}
