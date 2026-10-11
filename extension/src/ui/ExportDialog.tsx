import { Download, TriangleAlert, X } from '@/src/components/app/icons';
import { QUALITIES, type OutputSettings, type Project, type Recording } from '../domain/model';
import { outputSize } from '../engine/render';
import { createEditMap } from '../domain/edit-map';
import { Segmented } from '@/src/components/app/app';
import { formatTime } from '@/src/lib/format';
import { Button, buttonVariants } from '@/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { Progress } from '@/src/components/ui/progress';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { Spinner } from '@/src/components/ui/spinner';
import { SwitchRow } from '@/src/components/app/app';
import type { GifOptions } from '../export/protocol';
import { Mascot } from '@/src/components/brand/brand';

export type ExportFormat = 'mp4' | 'gif';
export type ExportState = {
  status: 'idle' | 'running' | 'cancelling' | 'done';
  progress: number;
  url?: string;
  /** Format of the finished file (the choice may change afterwards). */
  format?: ExportFormat;
};
const Label = ({ children }: { children: string }) => (
  <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
    {children}
  </span>
);
const LABELS: Record<OutputSettings['quality'], string> = {
  720: '720p',
  1080: '1080p',
  1440: '1440p',
  2160: '4K',
};

export function ExportDialog({
  open,
  project,
  recording,
  state,
  error,
  fileName,
  format,
  gif,
  onFormat,
  onGif,
  onOutput,
  onStart,
  onCancel,
  onClose,
}: {
  format: ExportFormat;
  gif: GifOptions;
  onFormat: (format: ExportFormat) => void;
  onGif: (gif: GifOptions) => void;
  open: boolean;
  project: Project;
  recording: Recording;
  state: ExportState;
  error: string;
  fileName: string;
  onOutput: (output: OutputSettings) => void;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const busy = state.status === 'running' || state.status === 'cancelling';
  const size = outputSize(project, recording);
  const length = createEditMap(project).durationUs;
  const gifWidth = Math.min(gif.width, size.width),
    gifHeight = Math.round((gifWidth * size.height) / size.width / 2) * 2,
    gifFrames = Math.ceil((length / 1_000_000) * gif.fps);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent showCloseButton={false} className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">Export video</DialogTitle>
          <DialogDescription>
            Rendered on this device as {format === 'gif' ? 'an animated GIF' : 'an MP4 file'}.
          </DialogDescription>
        </DialogHeader>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3"
          aria-label="Close export"
          disabled={busy}
          onClick={onClose}
        >
          <X />
        </Button>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Format</Label>
            <Segmented
              label="Export format"
              value={format}
              options={[
                { id: 'mp4', label: 'MP4 video' },
                { id: 'gif', label: 'GIF' },
              ]}
              onChange={(f) => !busy && onFormat(f)}
            />
          </div>
          {format === 'gif' ? (
            <>
              <div className="grid gap-2">
                <Label>Width</Label>
                <Segmented
                  label="GIF width"
                  value={String(gif.width)}
                  options={[480, 720, 960].map((w) => ({ id: String(w), label: `${w} px` }))}
                  onChange={(w) =>
                    !busy && onGif({ ...gif, width: Number(w) as GifOptions['width'] })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Frame rate</Label>
                <Segmented
                  label="GIF frame rate"
                  value={String(gif.fps)}
                  options={[10, 15, 20].map((f) => ({ id: String(f), label: `${f} fps` }))}
                  onChange={(f) => !busy && onGif({ ...gif, fps: Number(f) as GifOptions['fps'] })}
                />
              </div>
              <SwitchRow
                label="Loop forever"
                checked={gif.loop}
                disabled={busy}
                onChange={(loop) => onGif({ ...gif, loop })}
              />
              <p className="export-summary rounded-lg bg-muted px-3 py-2.5 text-sm">
                <strong className="tabular-nums">
                  {gifWidth} × {gifHeight}
                </strong>{' '}
                · {gif.fps} fps · GIF · {gifFrames} frames ·{' '}
                <span className="tabular-nums">{formatTime(length)}</span>
              </p>
              {length > 30_000_000 && (
                <p className="text-xs text-muted-foreground">
                  GIFs longer than 30 seconds get large and slow to load; MP4 is usually better.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                  Resolution
                </span>
                <Segmented
                  label="Resolution"
                  value={String(project.output.quality)}
                  options={QUALITIES.map((q) => ({ id: String(q), label: LABELS[q] }))}
                  onChange={(q) =>
                    !busy &&
                    onOutput({ ...project.output, quality: Number(q) as OutputSettings['quality'] })
                  }
                />
              </div>
              <div className="grid gap-2">
                <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                  Frame rate
                </span>
                <Segmented
                  label="Frame rate"
                  value={String(project.output.fps)}
                  options={[
                    { id: '30', label: '30 fps' },
                    { id: '60', label: '60 fps' },
                  ]}
                  onChange={(f) =>
                    !busy && onOutput({ ...project.output, fps: Number(f) as 30 | 60 })
                  }
                />
              </div>
              <p className="export-summary rounded-lg bg-muted px-3 py-2.5 text-sm">
                <strong className="tabular-nums">
                  {size.width} × {size.height}
                </strong>{' '}
                · {project.output.fps} fps · MP4 (H.264{recording.hasAudio ? ' + AAC audio' : ''})
                {recording.camera ? ' + webcam' : ''}
                {project.stage.mode === '3d' ? ' · 3D' : ''}
                {project.stage.device !== 'none' ? ` · ${project.stage.device} frame` : ''} ·{' '}
                <span className="tabular-nums">{formatTime(length)}</span>
              </p>
            </>
          )}
          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {busy && (
            <div className="grid gap-2" role="status">
              <Progress value={Math.round(state.progress * 100)} aria-label="Export progress" />
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                {state.status === 'cancelling'
                  ? 'Cancelling…'
                  : `Rendering ${Math.round(state.progress * 100)}%`}
              </span>
            </div>
          )}
          {state.status === 'done' && state.url && (
            <p role="status" className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Mascot pose="success" className="size-10" />
              {state.format === 'gif' ? 'GIF' : 'Video'} ready
            </p>
          )}
          {state.status === 'idle' && !error && (
            <p className="text-xs text-muted-foreground">
              Keep this tab open until rendering finishes.
            </p>
          )}
        </div>
        <DialogFooter>
          {busy ? (
            <Button variant="outline" disabled={state.status === 'cancelling'} onClick={onCancel}>
              Cancel export
            </Button>
          ) : (
            <>
              {state.status === 'done' && state.url && (
                <a
                  className={buttonVariants()}
                  href={state.url}
                  download={fileName.replace(/\.mp4$/, state.format === 'gif' ? '.gif' : '.mp4')}
                >
                  <Download /> {state.format === 'gif' ? 'Download GIF' : 'Download MP4'}
                </a>
              )}
              <Button variant={state.status === 'done' ? 'outline' : 'default'} onClick={onStart}>
                {state.status === 'done' ? 'Export again' : 'Start export'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
