import type { CameraLayout, Project } from '../domain/model';
import type { Context2D } from './render';

export type WebcamBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  opacity: number;
};
const TRANSITION_US = 300_000;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Rect = { x: number; y: number; width: number; height: number };
/** One arrangement without transition: the screen's container and the webcam box, in output pixels. */
type Arrangement = { screen: Rect; webcam: WebcamBox };

/** PiP boxes: the global corner/size, scaled by a small/large/hidden segment. */
function pipBox(
  project: Pick<Project, 'webcam'>,
  layout: CameraLayout | 'default',
  width: number,
  height: number,
): WebcamBox {
  const w = project.webcam,
    short = Math.min(width, height);
  const scale =
    layout === 'small' ? 0.6 : layout === 'large' ? 1.6 : layout === 'hidden' ? 0.85 : 1;
  const base = Math.min(short * w.size * scale, short * 0.6),
    boxW = w.shape === 'circle' ? base : base * (4 / 3),
    boxH = base,
    margin = short * w.margin;
  const x = w.corner.endsWith('l') ? margin : width - margin - boxW,
    y = w.corner.startsWith('t') ? margin : height - margin - boxH;
  const radius = w.shape === 'circle' ? base / 2 : w.shape === 'rounded' ? base * 0.16 : 0;
  return { x, y, width: boxW, height: boxH, radius, opacity: layout === 'hidden' ? 0 : 1 };
}

function arrangement(
  project: Pick<Project, 'webcam'>,
  layout: CameraLayout | 'default',
  width: number,
  height: number,
): Arrangement {
  const w = project.webcam,
    full = { x: 0, y: 0, width, height };
  const kind = layout === 'default' ? w.layout : layout;
  if (kind === 'fullscreen') return { screen: full, webcam: { ...full, radius: 0, opacity: 1 } };
  if (kind === 'side-by-side' || kind === 'stacked') {
    // Screen and camera share the frame; the camera side follows the corner setting.
    const short = Math.min(width, height),
      margin = short * Math.max(0.02, w.margin),
      side = kind === 'side-by-side',
      first = side ? w.corner.endsWith('l') : w.corner.startsWith('t'),
      length = side ? width : height,
      cam = length * w.split,
      region = first ? { from: 0, to: cam } : { from: length - cam, to: length };
    const screen = side
      ? { x: first ? cam : 0, y: 0, width: width - cam, height }
      : { x: 0, y: first ? cam : 0, width, height: height - cam };
    const box = side
      ? {
          x: region.from + (first ? margin : 0),
          y: margin,
          width: cam - margin,
          height: height - margin * 2,
        }
      : {
          x: margin,
          y: region.from + (first ? margin : 0),
          width: width - margin * 2,
          height: cam - margin,
        };
    const smaller = Math.min(box.width, box.height);
    const radius = w.shape === 'square' ? 0 : smaller * (w.shape === 'circle' ? 0.1 : 0.06);
    return { screen, webcam: { ...box, radius, opacity: 1 } };
  }
  const pip = kind === 'pip' ? 'default' : kind;
  return { screen: full, webcam: pipBox(project, pip, width, height) };
}

const mixRect = <T extends Rect>(a: T, b: T, p: number, extra: (keyof T)[] = []) => {
  const out = { ...a };
  for (const k of ['x', 'y', 'width', 'height', ...extra] as (keyof T)[])
    (out[k] as number) = lerp(a[k] as number, b[k] as number, p);
  return out;
};

/**
 * Screen container and webcam placement at a logical time: the global arrangement, or the active
 * camera segment's layout, eased over 300 ms at the segment edges. Without a webcam in the
 * recording the screen uses the whole frame. Shared by preview and export.
 */
export function compositionLayout(
  project: Pick<Project, 'webcam' | 'segments'>,
  atUs: number,
  width: number,
  height: number,
  hasWebcam = true,
): { screen: Rect; webcam: WebcamBox | null } {
  if (!hasWebcam) return { screen: { x: 0, y: 0, width, height }, webcam: null };
  const base = arrangement(project, 'default', width, height);
  const segment = project.segments.find(
    (s) => s.kind === 'camera' && s.startUs <= atUs && atUs < s.endUs,
  );
  let result = base;
  if (segment?.kind === 'camera') {
    const target = arrangement(project, segment.layout, width, height);
    const p = ease(
      Math.max(
        0,
        Math.min(
          1,
          (atUs - segment.startUs) / TRANSITION_US,
          (segment.endUs - atUs) / TRANSITION_US,
        ),
      ),
    );
    result = {
      screen: mixRect(base.screen, target.screen, p),
      webcam: mixRect(base.webcam, target.webcam, p, ['radius', 'opacity']),
    };
  }
  return { screen: result.screen, webcam: result.webcam.opacity <= 0.001 ? null : result.webcam };
}

/** Webcam box only (see compositionLayout). */
export function webcamLayout(
  project: Pick<Project, 'webcam' | 'segments'>,
  atUs: number,
  width: number,
  height: number,
): WebcamBox | null {
  return compositionLayout(project, atUs, width, height).webcam;
}

/** Cover-fits the webcam frame into its box with shape, mirror, border and shadow. */
export function drawWebcam(
  ctx: Context2D,
  project: Pick<Project, 'webcam'>,
  box: WebcamBox,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  unit: number,
) {
  const w = project.webcam;
  const fullscreen = box.radius === 0 && box.x === 0 && box.y === 0;
  ctx.save();
  ctx.globalAlpha = box.opacity;
  if (w.shadow && !fullscreen) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 30 * unit;
    ctx.shadowOffsetY = 10 * unit;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, box.radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.width, box.height, box.radius);
  ctx.save();
  ctx.clip();
  const scale = Math.max(box.width / sourceWidth, box.height / sourceHeight),
    dw = sourceWidth * scale,
    dh = sourceHeight * scale,
    dx = box.x + (box.width - dw) / 2,
    dy = box.y + (box.height - dh) / 2;
  if (w.mirror) {
    ctx.translate(box.x * 2 + box.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, dx, dy, dw, dh);
  ctx.restore();
  if (w.border && !fullscreen) {
    ctx.lineWidth = Math.max(2, 4 * unit);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.stroke();
  }
  ctx.restore();
}
