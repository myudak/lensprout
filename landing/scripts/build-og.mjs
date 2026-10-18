// Renders src/assets/og.png (1200×630 social card) from the mascot geometry and brand fonts with
// Playwright. Run with `npm run og` after changing the brand or tagline.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { mascotShapes, shapesToMarkup } from '../src/brand/mascot-shapes.ts';

// Inline the fonts: a page set with setContent cannot load file: URLs.
const font = (pkg, file) =>
  'data:font/woff2;base64,' +
  readFileSync(resolve(`node_modules/@fontsource/${pkg}/files/${file}`)).toString('base64');
const mascot = `<svg viewBox="-3 -2 108 106" width="330" height="322">${shapesToMarkup(mascotShapes('idle'))}</svg>`;

const html = `<!doctype html><html><head><style>
@font-face{font-family:Fredoka;font-weight:600;src:url(${font('fredoka', 'fredoka-latin-600-normal.woff2')})}
@font-face{font-family:Nunito;font-weight:700;src:url(${font('nunito', 'nunito-latin-700-normal.woff2')})}
html,body{margin:0}
body{width:1200px;height:630px;background:#FFF4E5;font-family:Nunito;color:#453D70;display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box;position:relative;overflow:hidden}
.blob{position:absolute;border-radius:50%;filter:blur(60px)}
h1{font-family:Fredoka;font-weight:600;font-size:76px;line-height:1.02;margin:0 0 22px;letter-spacing:-1px}
h1 span{color:#B94025}
p{font-size:30px;margin:0;color:#6C6182}
.word{font-family:Fredoka;font-weight:600;font-size:40px;margin-bottom:26px}
.word b{color:#B94025;font-weight:600}
.pill{display:inline-block;margin-top:28px;background:#453D70;color:#FFF4E5;border-radius:999px;padding:10px 24px;font-size:24px}
</style></head><body>
<div class="blob" style="width:420px;height:420px;background:#FABD6255;right:-120px;top:-140px"></div>
<div class="blob" style="width:360px;height:360px;background:#A6BFA055;left:-120px;bottom:-160px"></div>
<div style="position:relative">${mascot}</div>
<div style="position:relative">
<div class="word">Lens<b>prout</b></div>
<h1>Screen recordings that <span>zoom where you click</span></h1>
<p>Free, open source, and it stays on your device.</p>
<div class="pill">Auto zoom · Local editor · MP4 &amp; GIF</div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve('src/assets/og.png') });
await browser.close();
console.log('wrote src/assets/og.png');
