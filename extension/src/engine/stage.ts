import type { DeviceKind, Project } from '../domain/model';
import type { Camera } from './camera';

/**
 * Pure geometry of the 3D stage (no WebGL here, so it is unit-testable). World units are output
 * pixels: the plane z = 0 maps 1:1 onto the output at the rest eye distance, y points down and
 * positive z points toward the viewer. Devices are built from extruded rounded slabs with real
 * thickness, lit per vertex (an original procedural model; no image or 3D-model assets).
 */
export type Vec3 = [number, number, number];
export type Rect = { x: number; y: number; width: number; height: number };
export type Quad = [Vec3, Vec3, Vec3, Vec3];

/** Needs the WebGL stage: 3D, a device frame, or an animated background. */
export const needsStage = (project: Pick<Project, 'stage' | 'composition'>) =>
  project.stage.mode === '3d' ||
  project.stage.device !== 'none' ||
  project.composition.backgroundMotion.kind !== 'none';

export const fovDegrees = (perspective: number) => 15 + 30 * Math.min(1, Math.max(0, perspective));

/** Laptop lid opening: the base leaves the hinge this far below horizontal-toward-viewer. */
const BASE_DROP = (20 * Math.PI) / 180;

/**
 * Front-view device geometry around a screen of `sw × sh` pixels, in the same pixels. Sizes scale
 * with the screen's short side (a "frame unit"), so devices look the same at any aspect ratio.
 * Phones and tablets wrap the screen, so a landscape recording gives a landscape device.
 */
export function deviceLayout(device: DeviceKind, sw: number, sh: number) {
  const u = Math.min(sw, sh);
  // Bezel insets around the screen: left, top, right, bottom.
  const inset =
    device === 'laptop'
      ? [0.022, 0.03, 0.022, 0.03]
      : device === 'monitor'
        ? [0.022, 0.022, 0.022, 0.07]
        : device === 'tablet'
          ? [0.055, 0.055, 0.055, 0.055]
          : device === 'phone'
            ? [0.045, 0.045, 0.045, 0.045]
            : device === 'browser'
              ? [0, 0.075, 0, 0]
              : [0, 0, 0, 0];
  const [l, t, r, b] = inset.map((f) => f * u) as [number, number, number, number];
  const face = { width: sw + l + r, height: sh + t + b };
  const radius =
    device === 'phone'
      ? u * 0.11
      : device === 'tablet'
        ? u * 0.07
        : device === 'laptop'
          ? u * 0.03
          : device === 'monitor'
            ? u * 0.018
            : device === 'browser'
              ? u * 0.025
              : 0;
  const base =
    device === 'laptop'
      ? {
          width: face.width * 1.02,
          depth: face.height * 0.7,
          back: face.width * 0.016,
          front: face.width * 0.008,
          gap: face.width * 0.006,
        }
      : null;
  const stand =
    device === 'monitor'
      ? {
          neck: { width: face.width * 0.11, height: face.height * 0.24, depth: face.width * 0.012 },
          foot: { width: face.width * 0.34, depth: face.height * 0.3, height: face.width * 0.01 },
        }
      : null;
  return {
    face,
    screen: { x: l, y: t, width: sw, height: sh },
    radius,
    /** Lid / body thickness. */
    depth:
      device === 'none' || device === 'browser'
        ? u * 0.006
        : device === 'laptop'
          ? face.width * 0.009
          : device === 'monitor'
            ? face.width * 0.02
            : u * 0.03,
    base,
    stand,
    /** Extra front-view height below the face (base or stand), for fitting and centering. */
    below: base ? Math.sin(BASE_DROP) * base.depth + base.back : stand ? stand.neck.height : 0,
  };
}
export type DeviceGeometry = ReturnType<typeof deviceLayout>;

/** Surface materials: textures drawn per device, or a lit solid color. */
export type Material =
  | { kind: 'texture'; name: 'face' | 'deck' }
  | { kind: 'solid'; color: [number, number, number]; shine: number };
export type Vertex = { p: Vec3; n: Vec3; uv: [number, number] };
export type Mesh = { name: string; material: Material; tris: Vertex[] };

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** Rounded-rectangle outline in (u, v), counter-clockwise when v points down. */
function outline(u0: number, v0: number, u1: number, v1: number, r: number, steps = 8) {
  const rr = Math.max(0, Math.min(r, (u1 - u0) / 2, (v1 - v0) / 2));
  const corners: [number, number, number][] = [
    [u1 - rr, v0 + rr, -Math.PI / 2],
    [u1 - rr, v1 - rr, 0],
    [u0 + rr, v1 - rr, Math.PI / 2],
    [u0 + rr, v0 + rr, Math.PI],
  ];
  const points: { u: number; v: number; nu: number; nv: number }[] = [];
  for (const [cu, cv, start] of corners)
    for (let i = 0; i <= steps; i++) {
      const a = start + (i / steps) * (Math.PI / 2);
      points.push({
        u: cu + Math.cos(a) * rr,
        v: cv + Math.sin(a) * rr,
        nu: Math.cos(a),
        nv: Math.sin(a),
      });
    }
  return points;
}

/**
 * Extruded slab: an outline on the plane through `origin` spanned by U and V, with its top facing N
 * and its bottom at −N × thickness(v). The top maps texture coordinates across the outline bounds.
 */
function slab(
  name: string,
  origin: Vec3,
  U: Vec3,
  V: Vec3,
  N: Vec3,
  bounds: { u0: number; v0: number; u1: number; v1: number; r: number },
  thickness: (v: number) => number,
  top: Material,
  sides: Material,
  bottom: Material,
): Mesh[] {
  const pts = outline(bounds.u0, bounds.v0, bounds.u1, bounds.v1, bounds.r);
  const at = (u: number, v: number, down = 0): Vec3 =>
    add(add(add(origin, mul(U, u)), mul(V, v)), mul(N, -down));
  const uv = (u: number, v: number): [number, number] => [
    (u - bounds.u0) / (bounds.u1 - bounds.u0),
    (v - bounds.v0) / (bounds.v1 - bounds.v0),
  ];
  const cu = (bounds.u0 + bounds.u1) / 2,
    cv = (bounds.v0 + bounds.v1) / 2;
  const topTris: Vertex[] = [],
    bottomTris: Vertex[] = [],
    sideTris: Vertex[] = [];
  const back = mul(N, -1);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    topTris.push(
      { p: at(cu, cv), n: N, uv: uv(cu, cv) },
      { p: at(a.u, a.v), n: N, uv: uv(a.u, a.v) },
      { p: at(b.u, b.v), n: N, uv: uv(b.u, b.v) },
    );
    bottomTris.push(
      { p: at(cu, cv, thickness(cv)), n: back, uv: [0, 0] },
      { p: at(b.u, b.v, thickness(b.v)), n: back, uv: [0, 0] },
      { p: at(a.u, a.v, thickness(a.v)), n: back, uv: [0, 0] },
    );
    const na = add(mul(U, a.nu), mul(V, a.nv)),
      nb = add(mul(U, b.nu), mul(V, b.nv));
    const a0 = at(a.u, a.v),
      b0 = at(b.u, b.v),
      a1 = at(a.u, a.v, thickness(a.v)),
      b1 = at(b.u, b.v, thickness(b.v));
    sideTris.push(
      { p: a0, n: na, uv: [0, 0] },
      { p: a1, n: na, uv: [0, 0] },
      { p: b1, n: nb, uv: [0, 0] },
      { p: a0, n: na, uv: [0, 0] },
      { p: b1, n: nb, uv: [0, 0] },
      { p: b0, n: nb, uv: [0, 0] },
    );
  }
  return [
    { name: `${name}-bottom`, material: bottom, tris: bottomTris },
    { name: `${name}-sides`, material: sides, tris: sideTris },
    { name, material: top, tris: topTris },
  ];
}

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16) / 255,
  parseInt(c.slice(3, 5), 16) / 255,
  parseInt(c.slice(5, 7), 16) / 255,
];
/** Device finishes: "light" = silver aluminum, "dark" = space gray. */
export const FINISH = {
  light: { metal: '#cfd2d7', edge: '#e4e6e9', dark: '#9aa0a8' },
  dark: { metal: '#3d4046', edge: '#55595f', dark: '#26282c' },
};

/** Device meshes in local space (origin = face center, y down, z toward the viewer). */
export function buildDevice(
  device: DeviceKind,
  g: DeviceGeometry,
  theme: 'light' | 'dark',
  bareRadius: number,
) {
  const finish = FINISH[theme];
  const metal: Material = { kind: 'solid', color: hex(finish.metal), shine: 0.55 },
    edge: Material = { kind: 'solid', color: hex(finish.edge), shine: 0.8 },
    under: Material = { kind: 'solid', color: hex(finish.dark), shine: 0.2 },
    plainBack: Material = { kind: 'solid', color: hex('#121316'), shine: 0.1 };
  const hw = g.face.width / 2,
    hh = g.face.height / 2;
  const meshes: Mesh[] = [];
  const bare = device === 'none' || device === 'browser';
  // Lid / body: the face is its top, facing the viewer.
  meshes.push(
    ...slab(
      'face',
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      { u0: -hw, v0: -hh, u1: hw, v1: hh, r: device === 'none' ? bareRadius : g.radius },
      () => g.depth,
      { kind: 'texture', name: 'face' },
      bare ? plainBack : edge,
      bare ? plainBack : metal,
    ),
  );
  if (g.base) {
    const b = g.base,
      d: Vec3 = [0, Math.sin(BASE_DROP), Math.cos(BASE_DROP)],
      up: Vec3 = [0, -Math.cos(BASE_DROP), Math.sin(BASE_DROP)];
    meshes.push(
      ...slab(
        'deck',
        [0, hh + b.gap, -g.depth * 0.5],
        [1, 0, 0],
        d,
        up,
        { u0: -b.width / 2, v0: 0, u1: b.width / 2, v1: b.depth, r: b.width * 0.025 },
        (v) => b.back + ((b.front - b.back) * v) / b.depth,
        { kind: 'texture', name: 'deck' },
        edge,
        under,
      ),
    );
  }
  if (g.stand) {
    const n = g.stand.neck,
      f = g.stand.foot,
      backZ = -g.depth;
    meshes.push(
      ...slab(
        'neck',
        [0, hh - n.height * 0.2, backZ - n.depth * 0.2],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        { u0: -n.width / 2, v0: 0, u1: n.width / 2, v1: n.height * 1.2, r: n.width * 0.08 },
        () => n.depth,
        metal,
        edge,
        under,
      ),
      ...slab(
        'foot',
        [0, hh + n.height, backZ - n.depth * 0.7 - f.depth / 2],
        [1, 0, 0],
        [0, 0, 1],
        [0, -1, 0],
        { u0: -f.width / 2, v0: 0, u1: f.width / 2, v1: f.depth, r: f.width * 0.06 },
        () => f.height,
        edge,
        metal,
        under,
      ),
    );
  }
  return meshes;
}

/** Shadow margin around the face; larger than the blur reach so the quad edge never shows. */
export const SHADOW_MARGIN = 0.22;
/** Shadow quad behind the device (local space), textured with a pre-blurred silhouette. */
export function shadowQuad(g: DeviceGeometry): Quad {
  const hw = g.face.width / 2,
    hh = g.face.height / 2,
    grow = Math.min(g.face.width, g.face.height) * SHADOW_MARGIN,
    z = -g.depth - Math.min(g.face.width, g.face.height) * 0.08;
  return [
    [-hw - grow, -hh - grow * 0.6, z],
    [hw + grow, -hh - grow * 0.6, z],
    [hw + grow, hh + grow * 1.4 + g.below, z],
    [-hw - grow, hh + grow * 1.4 + g.below, z],
  ];
}

const rad = (d: number) => (d * Math.PI) / 180;
export function rotate(p: Vec3, yaw: number, pitch: number, roll: number): Vec3 {
  // Roll about z, then yaw about y, then pitch about x (radians). Positive yaw sends the right
  // edge (x > 0) away from the viewer (z < 0); positive pitch sends the bottom edge (y > 0) away.
  let [x, y, z] = p;
  [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
  [x, z] = [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
  [y, z] = [y * Math.cos(pitch) + z * Math.sin(pitch), -y * Math.sin(pitch) + z * Math.cos(pitch)];
  return [x, y, z];
}

export type StagePose = Pick<Camera, 'yaw' | 'pitch' | 'roll' | 'push'>;

/**
 * Places the device for a pose: rotation about the face center, a scale that fits every mesh in
 * `region` at the same pose without push, then the push that moves the eye closer. Returns
 * world-space meshes (normals rotated), the shadow quad, the eye and focal distances, and the
 * face's corner rectangle (for tests and texture sizing).
 */
export function placeDevice(
  g: DeviceGeometry,
  meshes: Mesh[],
  pose: StagePose,
  region: Rect,
  restScale: number,
  perspective: number,
) {
  const fov = rad(fovDegrees(perspective)),
    // Distance at which the z = 0 plane maps 1:1 onto the output (vertical FOV over the region).
    focal = region.height / 2 / Math.tan(fov / 2),
    eye = focal * (1 - pose.push),
    center = { x: region.x + region.width / 2, y: region.y + region.height / 2 };
  const turn = (p: Vec3): Vec3 => rotate(p, rad(pose.yaw), rad(pose.pitch), rad(pose.roll));
  // Center the device's front view (face plus base/stand below) in the region.
  const lift = -g.below / 2;
  const turned = meshes.map((m) => ({
    ...m,
    tris: m.tris.map((v) => ({ ...v, p: turn([v.p[0], v.p[1] + lift, v.p[2]]), n: turn(v.n) })),
  }));
  let scale = restScale;
  for (let i = 0; i < 6; i++) {
    let reach = { x: 0, y: 0 };
    for (const m of turned)
      for (const v of m.tris) {
        const k = focal / Math.max(1e-3, focal - v.p[2] * scale);
        reach = {
          x: Math.max(reach.x, Math.abs(v.p[0] * scale * k)),
          y: Math.max(reach.y, Math.abs(v.p[1] * scale * k)),
        };
      }
    const fit = Math.min(region.width / 2 / reach.x, region.height / 2 / reach.y);
    if (fit >= 0.999) break;
    scale *= fit;
  }
  const world = (p: Vec3): Vec3 => [center.x + p[0] * scale, center.y + p[1] * scale, p[2] * scale];
  const hw = g.face.width / 2,
    hh = g.face.height / 2;
  const corner = (x: number, y: number) => world(turn([x, y + lift, 0]));
  return {
    meshes: turned.map((m) => ({ ...m, tris: m.tris.map((v) => ({ ...v, p: world(v.p) })) })),
    shadow: shadowQuad(g).map((p) => world(turn([p[0], p[1] + lift, p[2]]))) as Quad,
    face: [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)] as Quad,
    eye,
    focal,
    center,
    scale,
  };
}

/**
 * World point → output pixel position and the perspective w. `focal` is the rest eye distance
 * (z = 0 maps 1:1 there); a closer `eye` magnifies everything (dolly).
 */
export function projectPoint(p: Vec3, eye: number, center: { x: number; y: number }, focal = eye) {
  const w = Math.max(1e-3, (eye - p[2]) / focal);
  return { x: center.x + (p[0] - center.x) / w, y: center.y + (p[1] - center.y) / w, w };
}

/** Light from the upper left, in front; returns rgb for a lit solid (or a texture multiplier). */
export function shade(n: Vec3, base: [number, number, number], shine: number) {
  const L: Vec3 = [-0.45, -0.6, 0.66],
    len = Math.hypot(...L);
  const l: Vec3 = [L[0] / len, L[1] / len, L[2] / len];
  const nl = Math.hypot(...n) || 1,
    nn: Vec3 = [n[0] / nl, n[1] / nl, n[2] / nl];
  const diffuse = Math.max(0, nn[0] * l[0] + nn[1] * l[1] + nn[2] * l[2]);
  // Blinn-Phong with the viewer along +z.
  const h: Vec3 = [l[0], l[1], l[2] + 1],
    hl = Math.hypot(...h);
  const spec = Math.pow(Math.max(0, (nn[0] * h[0] + nn[1] * h[1] + nn[2] * h[2]) / hl), 48) * shine;
  const k = 0.42 + 0.62 * diffuse;
  return base.map((c) => Math.min(1, c * k + spec * 0.55)) as [number, number, number];
}

/**
 * Rest scale: the device's front view (face plus base/stand) fits `region` minus padding.
 * `pad` is in pixels.
 */
export function restScale(g: DeviceGeometry, region: Rect, pad: number) {
  const w = Math.max(1, region.width - pad * 2),
    h = Math.max(1, region.height - pad * 2);
  const frontW = Math.max(g.face.width, g.base?.width ?? 0),
    frontH = g.face.height + g.below;
  return Math.min(w / frontW, h / frontH);
}
