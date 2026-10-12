import { Plus } from '@/src/components/app/icons';
import type { Project, WebcamStyle } from '../domain/model';
import { FieldRow, Segmented, SwitchRow, TileGroup } from '@/src/components/app/app';
import { Button } from '@/src/components/ui/button';
import { Slider } from '@/src/components/ui/slider';
import { cn } from '@/src/lib/utils';
import { Inspector, Section, type Update } from './panels';

const CORNERS: { id: WebcamStyle['corner']; label: string }[] = [
  { id: 'tl', label: 'Top left' },
  { id: 'tr', label: 'Top right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'br', label: 'Bottom right' },
];

/** Global webcam style; camera segments on the timeline override it for a range. */
export function CameraPanel({
  project,
  update,
  onAddSegment,
}: {
  project: Project;
  update: Update;
  onAddSegment: () => void;
}) {
  const w = project.webcam;
  const set = (patch: Partial<WebcamStyle>, coalesce?: string) =>
    update((p) => ({ ...p, webcam: { ...p.webcam, ...patch } }), coalesce);
  return (
    <Inspector id="camera">
      <Section title="Layout">
        <Segmented
          label="Webcam layout"
          value={w.layout}
          options={[
            { id: 'pip', label: 'Bubble' },
            { id: 'side-by-side', label: 'Side by side' },
            { id: 'stacked', label: 'Stacked' },
          ]}
          onChange={(layout) => set({ layout })}
        />
        {w.layout !== 'pip' && (
          <FieldRow label="Camera share">
            <Slider
              thumbLabel="Camera share of the frame"
              className="w-36"
              min={0.25}
              max={0.5}
              step={0.01}
              value={w.split}
              onValueChange={(v) => set({ split: v as number }, 'webcam-split')}
            />
            <output className="w-9 text-right text-xs tabular-nums">
              {Math.round(w.split * 100)}%
            </output>
          </FieldRow>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {w.layout === 'pip'
            ? 'The webcam floats over the recording in a corner.'
            : 'The screen and the camera share the frame; the corner picks which side the camera takes.'}
        </p>
      </Section>
      <Section title="Shape">
        <Segmented
          label="Webcam shape"
          value={w.shape}
          options={[
            { id: 'circle', label: 'Circle' },
            { id: 'rounded', label: 'Rounded' },
            { id: 'square', label: 'Square' },
          ]}
          onChange={(shape) => set({ shape })}
        />
      </Section>
      <Section title="Placement">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">Corner</span>
          <TileGroup
            label="Webcam corner"
            className="grid-cols-2"
            itemClassName="relative size-10 min-h-0 p-0"
            value={w.corner}
            options={CORNERS.map((c) => ({
              id: c.id,
              label: c.label,
              content: (
                <span
                  className={cn(
                    'absolute size-3 rounded-full bg-muted-foreground/60',
                    c.id[0] === 't' ? 'top-1.5' : 'bottom-1.5',
                    c.id[1] === 'l' ? 'left-1.5' : 'right-1.5',
                    w.corner === c.id && 'bg-primary',
                  )}
                />
              ),
            }))}
            onChange={(corner) => set({ corner })}
          />
        </div>
        <FieldRow label="Size">
          <Slider
            thumbLabel="Webcam size"
            className="w-36"
            min={0.1}
            max={0.6}
            step={0.01}
            value={w.size}
            onValueChange={(v) => set({ size: v as number }, 'webcam-size')}
          />
          <output className="w-9 text-right text-xs tabular-nums">
            {Math.round(w.size * 100)}%
          </output>
        </FieldRow>
        <FieldRow label="Margin">
          <Slider
            thumbLabel="Webcam margin"
            className="w-36"
            min={0}
            max={0.15}
            step={0.005}
            value={w.margin}
            onValueChange={(v) => set({ margin: v as number }, 'webcam-margin')}
          />
          <output className="w-9 text-right text-xs tabular-nums">
            {Math.round(w.margin * 100)}%
          </output>
        </FieldRow>
      </Section>
      <Section title="Look">
        <SwitchRow label="Mirror" checked={w.mirror} onChange={(mirror) => set({ mirror })} />
        <SwitchRow label="Shadow" checked={w.shadow} onChange={(shadow) => set({ shadow })} />
        <SwitchRow label="White border" checked={w.border} onChange={(border) => set({ border })} />
      </Section>
      <Section title="Camera segments">
        <p className="text-xs leading-relaxed text-muted-foreground">
          A camera segment switches the layout for part of the video: bubble, small, large, side by
          side, stacked, full frame or hidden. Changes ease in and out.
        </p>
        <Button variant="secondary" className="justify-self-start" onClick={onAddSegment}>
          <Plus /> Add camera segment
        </Button>
      </Section>
    </Inspector>
  );
}
