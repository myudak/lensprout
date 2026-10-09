import type { Background, Blur } from '../domain/model';
import type { Context2D } from './render';

/** Procedural, newly designed presets. No third-party images are bundled. */
export const GRADIENTS: { id: string; name: string; angle: number; stops: string[] }[] = [
  { id: 'mint', name: 'Mint', angle: 135, stops: ['#d4fc79', '#96e6a1'] },
  { id: 'lagoon', name: 'Lagoon', angle: 135, stops: ['#43e97b', '#38f9d7'] },
  { id: 'sky', name: 'Sky', angle: 160, stops: ['#a1c4fd', '#c2e9fb'] },
  { id: 'ocean', name: 'Ocean', angle: 135, stops: ['#2e3192', '#1bffff'] },
  { id: 'peach', name: 'Peach', angle: 120, stops: ['#ffecd2', '#fcb69f'] },
  { id: 'sunset', name: 'Sunset', angle: 135, stops: ['#f83600', '#f9d423'] },
  { id: 'rose', name: 'Rose', angle: 135, stops: ['#ee9ca7', '#ffdde1'] },
  { id: 'berry', name: 'Berry', angle: 135, stops: ['#8e2de2', '#4a00e0'] },
  { id: 'flamingo', name: 'Flamingo', angle: 120, stops: ['#ff6a88', '#ff99ac', '#fcb69f'] },
  { id: 'nebula', name: 'Nebula', angle: 150, stops: ['#3a1c71', '#d76d77', '#ffaf7b'] },
  { id: 'graphite', name: 'Graphite', angle: 160, stops: ['#434343', '#000000'] },
  { id: 'paper', name: 'Paper', angle: 160, stops: ['#fdfbfb', '#ebedee'] },
];

type Blob = [x: number, y: number, r: number, color: string];
export const WALLPAPERS: { id: string; name: string; base: [string, string]; blobs: Blob[] }[] = [
  {
    id: 'meadow',
    name: 'Meadow',
    base: ['#3d4fd8', '#1f8f4a'],
    blobs: [
      [0.15, 0.85, 0.7, '#4fd16b'],
      [0.85, 0.15, 0.6, '#5b3fd4'],
      [0.6, 0.65, 0.45, '#2bb673'],
      [0.3, 0.25, 0.4, '#6d7cf2'],
    ],
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    base: ['#0c3b5e', '#11998e'],
    blobs: [
      [0.2, 0.2, 0.6, '#1fa2ff'],
      [0.8, 0.8, 0.6, '#38ef7d'],
      [0.6, 0.3, 0.35, '#12d8fa'],
    ],
  },
  {
    id: 'dune',
    name: 'Dune',
    base: ['#ff9a3c', '#ffd56b'],
    blobs: [
      [0.2, 0.8, 0.6, '#ff6f3c'],
      [0.85, 0.2, 0.55, '#ffc93c'],
      [0.5, 0.5, 0.35, '#ffb26b'],
    ],
  },
  {
    id: 'ember',
    name: 'Ember',
    base: ['#3a0b0b', '#c2410c'],
    blobs: [
      [0.75, 0.3, 0.55, '#f97316'],
      [0.25, 0.75, 0.55, '#7f1d1d'],
      [0.55, 0.55, 0.3, '#fb923c'],
    ],
  },
  {
    id: 'apricot',
    name: 'Apricot',
    base: ['#ff9472', '#6a82fb'],
    blobs: [
      [0.2, 0.3, 0.55, '#ffb88c'],
      [0.8, 0.75, 0.55, '#5f72f6'],
      [0.6, 0.2, 0.3, '#ff8a65'],
    ],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    base: ['#0f2027', '#203a43'],
    blobs: [
      [0.3, 0.35, 0.55, '#00d2a8'],
      [0.75, 0.6, 0.5, '#4f46e5'],
      [0.5, 0.9, 0.4, '#06b6d4'],
    ],
  },
  {
    id: 'orchid',
    name: 'Orchid',
    base: ['#c471f5', '#fa71cd'],
    blobs: [
      [0.2, 0.8, 0.6, '#f093fb'],
      [0.8, 0.2, 0.55, '#a855f7'],
      [0.5, 0.45, 0.3, '#f5576c'],
    ],
  },
  {
    id: 'twilight',
    name: 'Twilight',
    base: ['#1e1b4b', '#6d28d9'],
    blobs: [
      [0.8, 0.8, 0.55, '#a21caf'],
      [0.2, 0.25, 0.5, '#312e81'],
      [0.55, 0.5, 0.3, '#7c3aed'],
    ],
  },
  {
    id: 'coast',
    name: 'Coast',
    base: ['#0ea5e9', '#f43f5e'],
    blobs: [
      [0.15, 0.2, 0.6, '#38bdf8'],
      [0.85, 0.85, 0.6, '#fb7185'],
      [0.6, 0.4, 0.3, '#818cf8'],
    ],
  },
  {
    id: 'crimson',
    name: 'Crimson',
    base: ['#1a0b2e', '#9f1239'],
    blobs: [
      [0.7, 0.7, 0.55, '#e11d48'],
      [0.25, 0.3, 0.5, '#4c1d95'],
    ],
  },
  {
    id: 'deepsea',
    name: 'Deep sea',
    base: ['#020617', '#1e3a8a'],
    blobs: [
      [0.3, 0.6, 0.55, '#2563eb'],
      [0.75, 0.3, 0.45, '#0ea5e9'],
      [0.6, 0.85, 0.3, '#1d4ed8'],
    ],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    base: ['#000428', '#004e92'],
    blobs: [
      [0.5, 0.5, 0.45, '#1e40af'],
      [0.85, 0.15, 0.4, '#0b1d51'],
    ],
  },
];

export const BLUR_PX: Record<Blur, number> = { none: 0, light: 8, moderate: 22, strong: 48 };

function linear(ctx: Context2D, width: number, height: number, angle: number, stops: string[]) {
  const a = ((angle - 90) * Math.PI) / 180,
    r = Math.abs(width * Math.cos(a)) / 2 + Math.abs(height * Math.sin(a)) / 2;
  const g = ctx.createLinearGradient(
    width / 2 - Math.cos(a) * r,
    height / 2 - Math.sin(a) * r,
    width / 2 + Math.cos(a) * r,
    height / 2 + Math.sin(a) * r,
  );
  stops.forEach((s, i) => g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), s));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

function wallpaper(ctx: Context2D, width: number, height: number, id: string) {
  const w = WALLPAPERS.find((p) => p.id === id) ?? WALLPAPERS[0]!;
  linear(ctx, width, height, 135, w.base);
  const size = Math.max(width, height);
  for (const [x, y, r, color] of w.blobs) {
    const g = ctx.createRadialGradient(x * width, y * height, 0, x * width, y * height, r * size);
    g.addColorStop(0, color);
    g.addColorStop(1, `${color}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  // Soft diagonal bands give the layered look of a desktop wallpaper.
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(
      width * (0.2 + i * 0.35),
      height * (1.05 - i * 0.2),
      size * 0.7,
      size * 0.22,
      -0.5,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = i % 2 ? '#ffffff33' : '#00000022';
    ctx.fill();
  }
  ctx.restore();
}

function blurred(
  target: Context2D,
  width: number,
  height: number,
  px: number,
  draw: (ctx: Context2D) => void,
) {
  if (!px) return draw(target);
  const layer = new OffscreenCanvas(width, height),
    ctx = layer.getContext('2d')!;
  draw(ctx);
  // Overscan hides the transparent fringe that a blur creates at the edges.
  const pad = px * 2;
  target.save();
  target.filter = `blur(${px}px)`;
  target.drawImage(layer, -pad, -pad, width + pad * 2, height + pad * 2);
  target.restore();
}

function cover(
  ctx: Context2D,
  image: CanvasImageSource & { width: number; height: number },
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height),
    w = image.width * scale,
    h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/** Paints a background once per size; frames reuse the returned canvas. Hidden returns null. */
export function paintBackground(
  background: Background,
  width: number,
  height: number,
  image?: (CanvasImageSource & { width: number; height: number }) | null,
): OffscreenCanvas | null {
  if (background.type === 'hidden') return null;
  const canvas = new OffscreenCanvas(width, height),
    ctx = canvas.getContext('2d')!,
    unit = Math.min(width, height) / 1080;
  switch (background.type) {
    case 'color':
      ctx.fillStyle = background.color;
      ctx.fillRect(0, 0, width, height);
      break;
    case 'gradient': {
      const g = GRADIENTS.find((p) => p.id === background.preset) ?? GRADIENTS[0]!;
      linear(ctx, width, height, g.angle, g.stops);
      break;
    }
    case 'image':
      blurred(ctx, width, height, BLUR_PX[background.blur] * unit, (c) =>
        wallpaper(c, width, height, background.preset),
      );
      break;
    case 'custom':
    case 'wallpaper':
      ctx.fillStyle = '#d9dee7';
      ctx.fillRect(0, 0, width, height);
      if (image)
        blurred(ctx, width, height, BLUR_PX[background.blur] * unit, (c) =>
          cover(c, image, width, height),
        );
      break;
  }
  return canvas;
}
