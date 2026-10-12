import type { DeviceKind } from '../domain/model';
import { FINISH, type DeviceGeometry } from './stage';

/**
 * Device textures drawn procedurally (no image or model assets, no branding). The 3D shape comes
 * from the meshes in stage.ts; these draw the front glass (bezel + screen) and the keyboard deck.
 * `k` is canvas pixels per geometry pixel.
 */
type Ctx = OffscreenCanvasRenderingContext2D;
export type DeviceTheme = 'light' | 'dark';

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  const clamp = (n: number) => Math.max(0, Math.min(n, w / 2, h / 2));
  ctx.roundRect(x, y, w, h, Array.isArray(r) ? r.map(clamp) : clamp(r));
}

/** Front glass: black bezel, screen, camera notch or dot; browser windows get a title bar. */
export function drawFace(
  ctx: Ctx,
  device: DeviceKind,
  g: DeviceGeometry,
  theme: DeviceTheme,
  screen: CanvasImageSource,
  k: number,
  bareRadius: number,
) {
  const W = g.face.width * k,
    H = g.face.height * k,
    s = { x: g.screen.x * k, y: g.screen.y * k, w: g.screen.width * k, h: g.screen.height * k };
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (device === 'none') {
    ctx.save();
    rounded(ctx, 0, 0, W, H, bareRadius);
    ctx.clip();
    ctx.drawImage(screen, 0, 0, W, H);
    ctx.restore();
    return;
  }
  // The mesh outline is already rounded; fill the whole texture so edges never show through.
  if (device === 'browser') {
    const bar = s.y;
    ctx.fillStyle = theme === 'dark' ? '#202227' : '#eceef1';
    ctx.fillRect(0, 0, W, H);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bar * 0.6 + i * bar * 0.42, bar / 2, bar * 0.13, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = theme === 'dark' ? '#33363d' : '#ffffff';
    rounded(ctx, W * 0.3, bar * 0.22, W * 0.4, bar * 0.56, bar * 0.28);
    ctx.fill();
    ctx.drawImage(screen, s.x, s.y, s.w, s.h);
    return;
  }
  // Glossy black bezel with a faint vertical falloff.
  const glass = ctx.createLinearGradient(0, 0, 0, H);
  glass.addColorStop(0, '#16171a');
  glass.addColorStop(1, '#07080a');
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, W, H);
  const short = Math.min(s.w, s.h);
  const inner =
    device === 'phone' || device === 'tablet'
      ? Math.max(0, g.radius * k - Math.min(g.screen.x, g.screen.y) * k)
      : device === 'laptop'
        ? short * 0.012
        : 0;
  ctx.save();
  // Laptop screens have rounded top corners only, like the lid around them.
  rounded(ctx, s.x, s.y, s.w, s.h, device === 'laptop' ? [inner, inner, 0, 0] : inner);
  ctx.clip();
  ctx.drawImage(screen, s.x, s.y, s.w, s.h);
  ctx.restore();
  ctx.fillStyle = '#050506';
  if (device === 'laptop') {
    // Camera notch hanging from the top bezel, with a lens.
    const nw = W * 0.085,
      nh = s.y * 1.15;
    rounded(ctx, (W - nw) / 2, 0, nw, nh, [0, 0, nh * 0.45, nh * 0.45]);
    ctx.fill();
    ctx.fillStyle = '#1b2433';
    ctx.beginPath();
    ctx.arc(W / 2, nh * 0.48, nh * 0.17, 0, Math.PI * 2);
    ctx.fill();
  } else if (device === 'monitor') {
    // Aluminum chin below the panel.
    const chin = s.y + s.h + (H - s.y - s.h) * 0.3;
    const metal = ctx.createLinearGradient(0, chin, 0, H);
    metal.addColorStop(0, FINISH[theme].edge);
    metal.addColorStop(1, FINISH[theme].metal);
    ctx.fillStyle = metal;
    ctx.fillRect(0, chin, W, H - chin);
  } else {
    const landscape = s.w > s.h,
      r = Math.max(1.5, Math.min(g.screen.x, g.screen.y) * k * 0.2);
    ctx.fillStyle = '#1b2433';
    ctx.beginPath();
    if (landscape) ctx.arc(s.x / 2, H / 2, r, 0, Math.PI * 2);
    else ctx.arc(W / 2, s.y / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Keyboard deck: brushed aluminum, black keys, a large trackpad (rows run hinge → front). */
export function drawDeck(ctx: Ctx, g: DeviceGeometry, theme: DeviceTheme, k: number) {
  if (!g.base) return;
  const f = FINISH[theme],
    W = g.base.width * k,
    H = g.base.depth * k;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const metal = ctx.createLinearGradient(0, 0, 0, H);
  metal.addColorStop(0, f.metal);
  metal.addColorStop(1, f.edge);
  ctx.fillStyle = metal;
  ctx.fillRect(0, 0, W, H);
  // Hinge shadow along the back edge.
  const hinge = ctx.createLinearGradient(0, 0, 0, H * 0.06);
  hinge.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
  hinge.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = hinge;
  ctx.fillRect(0, 0, W, H * 0.06);
  // Keyboard well and keys: six rows; the top row is half height.
  const kx = W * 0.085,
    kw = W * 0.83,
    ky = H * 0.09,
    kh = H * 0.46;
  ctx.fillStyle = theme === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.12)';
  rounded(ctx, kx - W * 0.008, ky - H * 0.012, kw + W * 0.016, kh + H * 0.024, W * 0.008);
  ctx.fill();
  const heights = [0.5, 1, 1, 1, 1, 1],
    total = heights.reduce((a, b) => a + b, 0);
  let y = ky;
  heights.forEach((rh, row) => {
    const h = (kh * rh) / total,
      cols = row === 5 ? 9 : 14,
      gap = Math.min(kw / 14, kh / total) * 0.16;
    for (let col = 0; col < cols; col++) {
      // The space bar is the wide fifth key of the last row.
      const span = row === 5 ? (col === 4 ? 5.5 : 1.0625) : 1,
        offset =
          row === 5 ? (col <= 4 ? col * 1.0625 : 4 * 1.0625 + 5.5 + (col - 5) * 1.0625) : col;
      const x = kx + (offset * kw) / 14;
      ctx.fillStyle = '#0d0d10';
      rounded(ctx, x + gap / 2, y + gap / 2, (span * kw) / 14 - gap, h - gap, gap * 1.2);
      ctx.fill();
    }
    y += h;
  });
  // Trackpad.
  ctx.fillStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)';
  rounded(ctx, W * 0.31, H * 0.6, W * 0.38, H * 0.34, Math.min(W, H) * 0.025);
  ctx.fill();
  ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
  ctx.lineWidth = Math.max(1, W * 0.0012);
  ctx.stroke();
}

/** Soft shadow: a blurred rounded rectangle drawn with canvas shadows (works in workers). */
export function drawShadow(
  ctx: Ctx,
  w: number,
  h: number,
  inner: { x: number; y: number; w: number; h: number; r: number },
) {
  ctx.clearRect(0, 0, w, h);
  const blur = Math.min(inner.w, inner.h) * 0.1;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 1)';
  ctx.shadowBlur = blur;
  // Draw the shape off-canvas and cast only its shadow into view.
  ctx.shadowOffsetX = w * 4;
  ctx.fillStyle = '#000';
  rounded(ctx, inner.x - w * 4, inner.y, inner.w, inner.h, inner.r);
  ctx.fill();
  ctx.restore();
}
