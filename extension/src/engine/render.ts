import type { Camera, CameraEvaluator } from './camera';
import type { Project, Recording, Segment } from '../domain/model';
import { CHORD_US, CLICK_US, FORCE, type Overlays } from './effects';
import { drawCursor } from './cursor';
import { compositionLayout, drawWebcam } from './webcam';
import { needsStage } from './stage';
import { ASPECT_RATIOS, viewExtents } from '../domain/crop';
import { renderStaged, type Stage } from './stage-render';
export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const RATIOS = ASPECT_RATIOS;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output pixels: `quality` is the short side; the long side is capped at 3840. */
export function outputSize(
  project: Pick<Project, 'composition' | 'output'>,
  source: Pick<Recording, 'width' | 'height'>,
) {
  const { aspect, crop } = project.composition;
  const ratio =
    aspect === 'native'
      ? (source.width * crop.width) / (source.height * crop.height)
      : RATIOS[aspect];
  const short = project.output.quality;
  let width = ratio >= 1 ? short * ratio : short,
    height = ratio >= 1 ? short : short / ratio;
  const fit = Math.min(1, 3840 / Math.max(width, height));
  width *= fit;
  height *= fit;
  return { width: even(width), height: even(height) };
}

/**
 * Frame placement in output pixels for the cropped source (pass the full source size; the crop is
 * applied here). Hidden background fills the canvas with no frame styling.
 */
export function frameRect(
  project: Pick<Project, 'composition'>,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  /** Region the frame is centered in (webcam layouts shrink it); defaults to the whole output. */
  container = { x: 0, y: 0, width, height },
) {
  const c = project.composition,
    // Fill covers its region edge to edge: no padding, corners or shadow.
    hidden = c.background.type === 'hidden' || c.fit === 'fill',
    unit = Math.min(width, height) / 1080,
    pad = hidden ? 0 : c.padding * Math.min(width, height),
    { fx, fy } = viewExtents(project, sourceWidth, sourceHeight),
    cw = sourceWidth * c.crop.width * fx,
    ch = sourceHeight * c.crop.height * fy;
  const scale = Math.max(
    1e-6,
    Math.min((container.width - pad * 2) / cw, (container.height - pad * 2) / ch),
  );
  const w = cw * scale,
    h = ch * scale;
  return {
    x: container.x + (container.width - w) / 2,
    y: container.y + (container.height - h) / 2,
    width: w,
    height: h,
    radius: hidden ? 0 : c.radius * unit,
    shadow: !hidden && c.shadow,
    unit,
  };
}

/** Camera samples across a half-frame shutter; one sample when the camera is still or blur is off. */
export function motionSamples(
  camera: Pick<CameraEvaluator, 'at'>,
  atUs: number,
  fps: number,
  enabled: boolean,
): Camera[] {
  const current = camera.at(atUs);
  if (!enabled) return [current];
  const shutterUs = (0.5 / fps) * 1_000_000,
    earlier = camera.at(atUs - shutterUs);
  // 3D turns and pushes count too, so the stage blurs while it moves.
  const motion =
    Math.abs(Math.log(current.zoom / earlier.zoom)) +
    Math.hypot(current.x - earlier.x, current.y - earlier.y) * current.zoom +
    ((Math.abs(current.yaw - earlier.yaw) +
      Math.abs(current.pitch - earlier.pitch) +
      Math.abs(current.roll - earlier.roll)) *
      Math.PI) /
      180 +
    Math.abs(current.push - earlier.push);
  if (motion < 0.003) return [current];
  const count = Math.min(8, 2 + Math.floor(motion / 0.004));
  return Array.from({ length: count }, (_, i) =>
    i ? camera.at(atUs - (shutterUs * i) / (count - 1)) : current,
  );
}

export type RenderJob = {
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  /** First entry is the current camera; others are motion-blur samples. */
  cameras: Camera[];
  project: Project;
  width: number;
  height: number;
  background: CanvasImageSource | null;
  overlays?: Overlays;
  atUs?: number;
  /** Decoded webcam frame for this time, when the recording has a webcam. */
  webcam?: { source: CanvasImageSource; width: number; height: number } | null;
  /**
   * The recording has a webcam: its layout may share the frame with the screen. Kept separate
   * from `webcam` so a frame that is not decoded yet does not move the screen.
   */
  hasWebcam?: boolean;
  /** WebGL stage for 3D, device frames and animated backgrounds; without it they render flat. */
  stage?: Stage | null;
};
/** Where the screen contents are drawn: a frame on the output, or a whole stage texture. */
export type ScreenBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  shadow: boolean;
  unit: number;
};

function roundRect(ctx: Context2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (r > 0) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

type Box = ScreenBox;
/** Camera-space (cropped, normalized) rectangle → source pixel rectangle. */
function sourceRect(job: RenderJob, x: number, y: number, w: number, h: number) {
  const crop = job.project.composition.crop,
    cw = job.sourceWidth * crop.width,
    ch = job.sourceHeight * crop.height;
  return [
    crop.x * job.sourceWidth + x * cw,
    crop.y * job.sourceHeight + y * ch,
    w * cw,
    h * ch,
  ] as const;
}
/** Half the camera view per axis, in cropped-frame units (fill views are narrower). */
const halves = (c: Camera) => ({ hx: (0.5 * c.fx) / c.zoom, hy: (0.5 * c.fy) / c.zoom });
function drawSource(ctx: Context2D, job: RenderJob, box: Box, c: Camera) {
  const { hx, hy } = halves(c);
  ctx.drawImage(
    job.source,
    ...sourceRect(job, c.x - hx, c.y - hy, 2 * hx, 2 * hy),
    box.x,
    box.y,
    box.width,
    box.height,
  );
}
/** Camera-space point → output pixels. */
const toBox = (box: Box, c: Camera, x: number, y: number) => {
  const { hx, hy } = halves(c);
  return {
    x: box.x + ((x - (c.x - hx)) / (2 * hx)) * box.width,
    y: box.y + ((y - (c.y - hy)) / (2 * hy)) * box.height,
  };
};
const activeSegments = (job: RenderJob) => {
  const t = job.atUs;
  return t === undefined ? [] : job.project.segments.filter((s) => s.startUs <= t && t < s.endUs);
};
/** Fade in/out over 180 ms at segment edges. */
const fadeFor = (s: Segment, atUs: number) =>
  Math.max(0, Math.min(1, (atUs - s.startUs) / 180_000, (s.endUs - atUs) / 180_000));

function drawBlurs(ctx: Context2D, job: RenderJob, box: Box) {
  const c = job.cameras[0]!;
  for (const s of activeSegments(job)) {
    if (s.kind !== 'blur') continue;
    const a = toBox(box, c, s.rect.x, s.rect.y),
      b = toBox(box, c, s.rect.x + s.rect.width, s.rect.y + s.rect.height),
      px = s.strength * box.unit * Math.sqrt(c.zoom);
    // Sampling a margin around the region avoids transparent fringes inside the blurred area.
    const mx = (px * 2 * c.fx) / (c.zoom * box.width),
      my = (px * 2 * c.fy) / (c.zoom * box.height);
    const x0 = Math.max(0, s.rect.x - mx),
      y0 = Math.max(0, s.rect.y - my),
      x1 = Math.min(1, s.rect.x + s.rect.width + mx),
      y1 = Math.min(1, s.rect.y + s.rect.height + my);
    const p0 = toBox(box, c, x0, y0),
      p1 = toBox(box, c, x1, y1);
    ctx.save();
    roundRect(ctx, a.x, a.y, b.x - a.x, b.y - a.y, 6 * box.unit);
    ctx.clip();
    ctx.filter = `blur(${px}px)`;
    ctx.drawImage(
      job.source,
      ...sourceRect(job, x0, y0, x1 - x0, y1 - y0),
      p0.x,
      p0.y,
      p1.x - p0.x,
      p1.y - p0.y,
    );
    ctx.restore();
  }
}

function wrapLines(ctx: Context2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(String.fromCharCode(10))) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function drawTexts(ctx: Context2D, job: RenderJob, unit: number) {
  for (const s of activeSegments(job)) {
    if (s.kind !== 'text' || !s.text.trim()) continue;
    const size = s.size * unit,
      lineHeight = size * 1.25;
    ctx.save();
    ctx.globalAlpha = fadeFor(s, job.atUs!);
    ctx.font = `700 ${size}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrapLines(ctx, s.text, job.width * 0.8),
      textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width)),
      padX = s.style === 'plain' ? 0 : size * 0.7,
      padY = s.style === 'plain' ? 0 : size * 0.4,
      w = textWidth + padX * 2,
      h = lines.length * lineHeight + padY * 2,
      cx = s.position.x * job.width,
      top = Math.min(Math.max(0, s.position.y * job.height - h / 2), job.height - h);
    if (s.style !== 'plain') {
      ctx.fillStyle = 'rgba(17, 24, 39, 0.78)';
      roundRect(
        ctx,
        cx - w / 2,
        top,
        w,
        h,
        s.style === 'pill' ? Math.min(h / 2, size) : size * 0.25,
      );
      ctx.fill();
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = size * 0.25;
      ctx.shadowOffsetY = size * 0.06;
    }
    ctx.fillStyle = s.color;
    lines.forEach((l, i) => ctx.fillText(l, cx, top + padY + lineHeight * (i + 0.5)));
    ctx.restore();
  }
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function drawClicks(ctx: Context2D, job: RenderJob, box: Box) {
  const fx = job.project.effects.click;
  if (fx.style === 'none' || !job.overlays || job.atUs === undefined) return;
  const c = job.cameras[0]!,
    radius = 34 * box.unit * FORCE[fx.force] * (0.75 + 0.25 * c.zoom);
  for (const click of job.overlays.clicks(job.atUs)) {
    const { x: px, y: py } = toBox(box, c, click.point.x, click.point.y),
      p = click.ageUs / CLICK_US,
      fade = Math.pow(1 - p, 1.4);
    if (px < box.x || py < box.y || px > box.x + box.width || py > box.y + box.height) continue;
    ctx.save();
    if (fx.style === 'orb') {
      const r = radius * (0.45 + 0.55 * ease(p));
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `${fx.color}00`);
      g.addColorStop(
        0.55,
        `${fx.color}${Math.round(fade * 90)
          .toString(16)
          .padStart(2, '0')}`,
      );
      g.addColorStop(
        0.8,
        `${fx.color}${Math.round(fade * 230)
          .toString(16)
          .padStart(2, '0')}`,
      );
      g.addColorStop(1, `${fx.color}00`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.16 * (1 - p * 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = fade;
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = Math.max(1, radius * 0.16 * (1 - p * 0.6));
      ctx.beginPath();
      ctx.arc(px, py, radius * (0.3 + 0.75 * ease(p)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawChord(ctx: Context2D, job: RenderJob, unit: number) {
  if (!job.project.effects.keystrokes || !job.overlays || job.atUs === undefined) return;
  const chord = job.overlays.chord(job.atUs);
  if (!chord) return;
  const t = chord.ageUs / CHORD_US,
    alpha = Math.min(1, t / 0.08, (1 - t) / 0.2);
  const size = 30 * unit;
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.font = `600 ${size}px system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const text = chord.keys.split('+').join('  +  '),
    w = ctx.measureText(text).width + size * 1.4,
    h = size * 2,
    x = (job.width - w) / 2,
    y = job.height - h - 48 * unit;
  ctx.fillStyle = 'rgba(17, 24, 39, 0.82)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, job.width / 2, y + h / 2 + 1);
  ctx.restore();
}

/**
 * Everything inside the screen: the camera view of the source (motion samples averaged), blur
 * regions, the cursor and clicks, clipped to `box`. The flat path draws it onto the output; the
 * stage path draws it into the screen texture.
 */
export function renderScreen(ctx: Context2D, job: RenderJob, box: ScreenBox) {
  ctx.save();
  roundRect(ctx, box.x, box.y, box.width, box.height, box.radius);
  ctx.clip();
  ctx.fillStyle = '#000000';
  ctx.fillRect(box.x, box.y, box.width, box.height);
  // Running average: sample i is drawn with alpha 1/(i+1).
  job.cameras.forEach((c, i) => {
    ctx.globalAlpha = 1 / (i + 1);
    drawSource(ctx, job, box, c);
  });
  ctx.globalAlpha = 1;
  drawBlurs(ctx, job, box);
  const cursor = job.atUs !== undefined ? job.overlays?.cursor(job.atUs) : undefined;
  if (cursor) {
    const c = job.cameras[0]!;
    drawCursor(
      ctx,
      job.project.cursor,
      cursor,
      {
        ...toBox(box, c, cursor.point.x, cursor.point.y),
        // Pixels per cropped-frame height (fill views show a fraction fy of it).
        scale: (c.zoom * box.height) / c.fy,
      },
      box,
    );
  }
  drawClicks(ctx, job, box);
  ctx.restore();
}

/** One implementation for preview and export, in output pixel coordinates. */
export function renderFrame(ctx: Context2D, job: RenderJob) {
  const { width, height } = job,
    unit = Math.min(width, height) / 1080;
  const layout = compositionLayout(
    job.project,
    job.atUs ?? 0,
    width,
    height,
    job.hasWebcam ?? !!job.webcam,
  );
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (job.stage && needsStage(job.project)) {
    renderStaged(ctx, job, job.stage, layout.screen, renderScreen);
  } else {
    const box = frameRect(
      job.project,
      job.sourceWidth,
      job.sourceHeight,
      width,
      height,
      layout.screen,
    );
    if (job.background) ctx.drawImage(job.background, 0, 0, width, height);
    else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
    }
    if (box.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.38)';
      ctx.shadowBlur = 48 * box.unit;
      ctx.shadowOffsetY = 18 * box.unit;
      ctx.fillStyle = '#111111';
      roundRect(ctx, box.x, box.y, box.width, box.height, box.radius);
      ctx.fill();
      ctx.restore();
    }
    renderScreen(ctx, job, box);
  }
  drawChord(ctx, job, unit);
  if (job.webcam && layout.webcam)
    drawWebcam(
      ctx,
      job.project,
      layout.webcam,
      job.webcam.source,
      job.webcam.width,
      job.webcam.height,
      unit,
    );
  drawTexts(ctx, job, unit);
  ctx.restore();
}
