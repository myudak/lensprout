// Composes the Chrome Web Store images (screenshots 1280x800, marquee 1400x560, small tile 440x280)
// from the captures in store/raw (see capture.mjs), the real mascot and the brand fonts.
// Usage: node store/scripts/compose.mjs   (run capture.mjs first; writes store/*.png)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const ext = join(root, 'extension');
const require = createRequire(join(ext, 'package.json'));
const { chromium } = require('@playwright/test');
const { mascotShapes, shapesToMarkup, MASCOT_VIEWBOX, BRAND } = await import(
  pathToFileURL(join(ext, 'src/components/brand/mascot-shapes.ts')).href
);

const store = join(root, 'store');
const build = join(store, 'build');
mkdirSync(join(store, 'screenshots'), { recursive: true });
const font = (pkg, file) =>
  'data:font/woff2;base64,' + readFileSync(join(ext, 'node_modules/@fontsource', pkg, 'files', file)).toString('base64');
const img = (p) => pathToFileURL(join(store, p)).href;
const mascot = (size, pose = 'idle') =>
  `<svg viewBox="${MASCOT_VIEWBOX}" width="${size}" height="${size}">${shapesToMarkup(mascotShapes(pose))}</svg>`;

const css = `
@font-face{font-family:Fredoka;font-weight:600;src:url(${font('fredoka', 'fredoka-latin-600-normal.woff2')})}
@font-face{font-family:Nunito;font-weight:700;src:url(${font('nunito', 'nunito-latin-700-normal.woff2')})}
*{box-sizing:border-box}
html,body{margin:0;overflow:hidden}
body{font-family:Nunito;color:${BRAND.purple};position:relative;
  background:
    radial-gradient(circle at 8% 0%, ${BRAND.apricot}66, transparent 38%),
    radial-gradient(circle at 100% 100%, ${BRAND.coral}40, transparent 45%),
    ${BRAND.cream}}
h1{font:600 54px/1.08 Fredoka;margin:0;letter-spacing:-.5px}
h1 em{font-style:normal;color:${BRAND.coralShade}}
p{font:700 21px/1.4 Nunito;margin:12px 0 0;opacity:.82}
.brand{display:flex;align-items:center;gap:10px;font:600 26px Fredoka}
.shot{border-radius:22px;overflow:hidden;box-shadow:0 30px 60px -20px #453d7055,0 0 0 1px #453d7018;background:#fff}
.shot img{display:block;width:100%}
.chip{display:inline-block;font:700 15px Nunito;letter-spacing:.06em;text-transform:uppercase;
  color:${BRAND.coralShade};background:#fff;border-radius:999px;padding:7px 14px;box-shadow:0 0 0 1px #e86a4733}
`;

// One 1280x800 screenshot: headline block on top, the product image bleeding off the bottom.
const screenshot = ({ chip, title, sub, image, width = 1000, top = 250 }) => `
<style>${css}
body{width:1280px;height:800px}
header{position:absolute;left:0;right:0;top:46px;text-align:center;padding:0 80px}
.brand{position:absolute;left:36px;top:30px;font-size:22px}
.shot{position:absolute;left:${(1280 - width) / 2}px;top:${top}px;width:${width}px}
.chip{margin-bottom:14px}
</style>
<div class="brand">${mascot(34)}Lensprout</div>
<header><span class="chip">${chip}</span><h1>${title}</h1><p>${sub}</p></header>
<div class="shot"><img src="${image}"></div>`;

const pages = [
  {
    out: 'screenshots/1-auto-zoom.png', size: [1280, 800],
    html: screenshot({
      chip: 'Automatic zoom', title: 'Screen recordings that <em>zoom where you click</em>',
      sub: 'Record any page in Chrome. Lensprout turns your clicks into smooth camera moves.',
      image: img('build/preview-zoom-canvas.png'), width: 920, top: 268,
    }),
  },
  {
    out: 'screenshots/2-editor.png', size: [1280, 800],
    html: screenshot({
      chip: 'Built-in editor', title: 'Fine-tune <em>every zoom</em> on a timeline',
      sub: 'Move, resize or add zooms, plus trim, speed, text, blur and camera segments.',
      image: img('raw/editor-zoom.png'), width: 1060, top: 262,
    }),
  },
  {
    out: 'screenshots/3-typing.png', size: [1280, 800],
    html: screenshot({
      chip: 'Clicks and typing', title: 'Typing? It <em>zooms in</em> on that too',
      sub: 'Forms, search boxes and code stay readable, framed automatically.',
      image: img('build/preview-zoom-typing-canvas.png'), width: 920, top: 268,
    }),
  },
  {
    out: 'screenshots/4-3d-stage.png', size: [1280, 800],
    html: screenshot({
      chip: 'Style', title: 'A <em>3D stage</em>, device frames and wallpapers',
      sub: 'Tilt, orbit and dolly moves, overlay cursors, click sounds and presets.',
      image: img('build/preview-3d-canvas.png'), width: 920, top: 268,
    }),
  },
  {
    out: 'screenshots/5-export.png', size: [1280, 800],
    html: screenshot({
      chip: 'Private by design', title: 'Export MP4 or GIF. <em>Nothing leaves</em> your device.',
      sub: 'Up to 4K at 60 fps, rendered locally. No account, no upload, no watermark.',
      image: img('raw/export.png'), width: 1060, top: 262,
    }),
  },
  {
    out: 'marquee-1400x560.png', size: [1400, 560],
    html: `<style>${css}
body{width:1400px;height:560px}
.text{position:absolute;left:70px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center}
.brand{font-size:44px;gap:14px;margin-bottom:22px}
h1{font-size:50px}
.stage{position:absolute;left:640px;top:70px;width:820px;perspective:1600px}
.shot{transform:rotateY(-14deg) rotateX(4deg);transform-origin:left center}
.chip{margin-top:26px;align-self:flex-start}
</style>
<div class="text"><div class="brand">${mascot(70)}Lensprout</div>
<h1>Screen recordings that <em>zoom where you click</em></h1>
<span class="chip">Free Chrome extension</span></div>
<div class="stage"><div class="shot"><img src="${img('build/preview-zoom-canvas.png')}"></div></div>`,
  },
  {
    out: 'promo-tile-440x280.png', size: [440, 280],
    html: `<style>${css}
body{width:440px;height:280px}
.shot{position:absolute;left:214px;top:118px;width:300px;border-radius:14px;transform:rotate(-4deg)}
.text{position:absolute;left:26px;top:26px}
.brand{font-size:36px;gap:10px}
p{font-size:17px;margin-top:8px;max-width:178px;line-height:1.25}
p em{font-style:normal;color:${BRAND.coralShade}}
</style>
<div class="shot"><img src="${img('build/preview-zoom-canvas.png')}"></div>
<div class="text"><div class="brand">${mascot(58)}Lensprout</div>
<p>Screen recordings that <em>zoom where you click</em></p></div>`,
  },
];

const browser = await chromium.launch();
try {
  for (const { out, size, html } of pages) {
    const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
    const file = join(build, 'page.html');
    writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('load');
    await page.screenshot({ path: join(store, out), type: 'png', omitBackground: false });
    await page.close();
    console.log(out);
  }
} finally {
  await browser.close();
}
