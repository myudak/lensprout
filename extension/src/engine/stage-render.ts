import type { Camera } from './camera';
import { viewExtents } from '../domain/crop';
import { drawDeck, drawFace, drawShadow } from './devices';
import { createStageRenderer, type StageSource } from './stage-gl';
import {
  SHADOW_MARGIN,
  buildDevice,
  deviceLayout,
  placeDevice,
  restScale,
  type Rect,
} from './stage';
import type { Context2D, RenderJob, ScreenBox } from './render';

/** WebGL compositor plus the 2D work canvases it textures from. Create once per preview/export. */
export function createStage() {
  let gl: ReturnType<typeof createStageRenderer>;
  try {
    gl = createStageRenderer();
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const canvas = () => new OffscreenCanvas(2, 2);
  return {
    gl,
    screen: canvas(),
    face: canvas(),
    deck: canvas(),
    shadow: canvas(),
    keys: new Map<string, string>(),
    ids: new WeakMap<object, number>(),
    nextId: 1,
  };
}
export type Stage = NonNullable<ReturnType<typeof createStage>>;

const MAX_TEXTURE = 4096;
const size = (c: OffscreenCanvas, w: number, h: number) => {
  const W = Math.max(2, Math.round(w)),
    H = Math.max(2, Math.round(h));
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  return c.getContext('2d')!;
};

/**
 * Renders the screen into a texture, places the device for every pose and composites through
 * WebGL, then copies the result into `ctx`. Overlays outside the screen (chord, webcam, text) are
 * drawn by the caller afterwards.
 */
export function renderStaged(
  ctx: Context2D,
  job: RenderJob,
  stage: Stage,
  region: Rect,
  renderScreen: (ctx: Context2D, job: RenderJob, box: ScreenBox) => void,
) {
  const { project, width, height } = job,
    st = project.stage,
    c = project.composition,
    unitOut = Math.min(width, height) / 1080;
  const { fx, fy } = viewExtents(project, job.sourceWidth, job.sourceHeight);
  const aspect = (job.sourceWidth * c.crop.width * fx) / (job.sourceHeight * c.crop.height * fy),
    g = deviceLayout(st.device, 1000 * aspect, 1000);
  const pad = c.padding * Math.min(width, height),
    rest = restScale(g, region, pad);
  const flat = st.mode !== '3d';
  const pose = (cam: Camera) =>
    flat
      ? { yaw: 0, pitch: 0, roll: 0, push: 0 }
      : { yaw: cam.yaw, pitch: cam.pitch, roll: cam.roll, push: cam.push };
  // Identical poses (2D-only motion) need one 3D pass.
  const poses = job.cameras
    .map(pose)
    .filter(
      (p, i, all) =>
        i === 0 ||
        Math.abs(p.yaw - all[0]!.yaw) +
          Math.abs(p.pitch - all[0]!.pitch) +
          Math.abs(p.roll - all[0]!.roll) +
          Math.abs(p.push - all[0]!.push) >
          1e-4,
    );
  const theme = st.deviceTheme,
    bareGeometryRadius = (c.radius * unitOut) / rest;
  const meshes = buildDevice(st.device, g, theme, bareGeometryRadius);
  const placed = poses.map((p) => placeDevice(g, meshes, p, region, rest, st.perspective));
  // Canvas pixels per geometry pixel: the on-screen size, enlarged while the camera pushes in.
  let k = placed[0]!.scale / Math.max(0.5, 1 - poses[0]!.push);
  k = Math.min(k, MAX_TEXTURE / Math.max(g.face.width, g.face.height));
  const scaleIn = k / placed[0]!.scale,
    unit = unitOut * scaleIn;
  // 1. Screen contents (camera crop, blur, cursor, clicks) at texture resolution.
  const screenCtx = size(stage.screen, g.screen.width * k, g.screen.height * k);
  renderScreen(screenCtx, job, {
    x: 0,
    y: 0,
    width: stage.screen.width,
    height: stage.screen.height,
    radius: 0,
    shadow: false,
    unit,
  });
  // 2. Face (every frame) and static textures (only when their key changes).
  drawFace(
    size(stage.face, g.face.width * k, g.face.height * k),
    st.device,
    g,
    theme,
    stage.screen,
    k,
    bareGeometryRadius * k,
  );
  const staticPart = (name: 'deck' | 'shadow', key: string, draw: () => void) => {
    if (stage.keys.get(name) !== key) {
      draw();
      stage.keys.set(name, key);
    }
    return { source: stage[name], key } satisfies StageSource;
  };
  const textures: Record<string, StageSource> = {
    face: { source: stage.face, key: null },
  };
  if (g.base) {
    const dk = Math.min(k, MAX_TEXTURE / g.base.width);
    textures.deck = staticPart('deck', `${theme}|${Math.round(g.base.width * dk)}`, () =>
      drawDeck(size(stage.deck, g.base!.width * dk, g.base!.depth * dk), g, theme, dk),
    );
  }
  const shadowAlpha = st.device === 'none' ? (c.shadow ? 0.5 : 0) : 0.55;
  if (shadowAlpha > 0) {
    // The shadow quad spans the face plus a margin; draw the blurred face shape inside it.
    const grow = Math.min(g.face.width, g.face.height) * SHADOW_MARGIN,
      qw = g.face.width + grow * 2,
      qh = g.face.height + grow * 2 + g.below,
      sk = 256 / Math.max(qw, qh);
    textures.shadow = staticPart('shadow', `${st.device}|${qw.toFixed(0)}x${qh.toFixed(0)}`, () => {
      const ctxS = size(stage.shadow, qw * sk, qh * sk);
      drawShadow(ctxS, stage.shadow.width, stage.shadow.height, {
        x: grow * sk,
        y: grow * 0.6 * sk,
        w: g.face.width * sk,
        h: (g.face.height + g.below) * sk,
        r: Math.max(g.radius, bareGeometryRadius) * sk,
      });
    });
  }
  // 3. Composite.
  let background: StageSource | null = null;
  if (job.background && c.background.type !== 'hidden') {
    const object = job.background as object;
    let id = stage.ids.get(object);
    if (id === undefined) {
      id = stage.nextId++;
      stage.ids.set(object, id);
    }
    background = { source: job.background as TexImageSource, key: `${id}|${width}x${height}` };
  }
  const result = stage.gl.draw({
    width,
    height,
    background,
    motion: c.backgroundMotion,
    timeSec: (job.atUs ?? 0) / 1_000_000,
    textures,
    poses: placed.map((p, i) => ({
      meshes: p.meshes,
      shadow: p.shadow,
      shadowAlpha,
      // The glare band slides across the glass as the screen turns.
      glare: 0.55 + poses[i]!.yaw / 70,
      eye: p.eye,
      focal: p.focal,
      center: p.center,
    })),
  });
  ctx.drawImage(result, 0, 0, width, height);
}
