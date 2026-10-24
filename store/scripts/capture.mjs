// Records the landing site's fictional demo dashboard with the real Lensprout extension, then
// captures editor views for the Chrome Web Store images (store/raw/*.png, 2x pixel density).
// Needs: an unpacked build without the local wallpaper pack (LENSPROUT_WALLPAPERS=0 npm run build in
// extension/) and a landing build (npm run build in landing/). Uses the extension's Playwright and
// the browser tests' tab-capture plumbing (devCaptureMode). Usage: node store/scripts/capture.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const require = createRequire(join(root, 'extension', 'package.json'));
const { chromium } = require('@playwright/test');

const build = join(root, 'extension', '.output', 'chrome-mv3');
const dist = join(root, 'landing', 'dist');
const out = join(root, 'store', 'raw');
mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = normalize(join(dist, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(dist)) return res.writeHead(403).end();
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }).end(readFileSync(p));
}).listen(4190, '127.0.0.1');
const sourceUrl = 'http://127.0.0.1:4190/demo/dashboard/';

const manifest = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`, `--allowlisted-extension-id=${extensionId}`],
});
const shot = (page, name, opts = {}) => page.screenshot({ path: join(out, `${name}.png`), ...opts });
const wait = (page, ms) => page.waitForTimeout(ms);
const pick = async (page, label, option) => {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};
try {
  const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const source = await context.newPage();
  await source.goto(sourceUrl, { waitUntil: 'networkidle' });
  await source.waitForSelector('astro-island:not([ssr])', { state: 'attached', timeout: 60000 });
  const session = await background.evaluate(async ({ url, extensionId }) => {
    await chrome.storage.local.set({
      recorderPrefs: { audio: false, camera: '', mic: '', gain: 1, noiseSuppression: true, countdown: 0 },
      devCaptureMode: 'tab',
      theme: 'light',
    });
    await chrome.storage.local.remove('stylePresets');
    const [tab] = await chrome.tabs.query({ url });
    const id = crypto.randomUUID();
    const r = await chrome.tabs.create({ url: `chrome-extension://${extensionId}/recorder.html?session=${id}`, pinned: true });
    await chrome.storage.session.set({ session: { id, sourceTabId: tab.id, recorderTabId: r.id, sourceTitle: 'Acme dashboard', status: 'ready' } });
    return { id };
  }, { url: sourceUrl, extensionId });
  const recorder = context.pages().find((p) => p.url().includes(`session=${session.id}`)) ?? (await context.waitForEvent('page'));
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).waitFor();
  await wait(recorder, 600);
  await shot(recorder, 'recorder');
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await recorder.getByRole('button', { name: 'Pause recording', exact: true }).waitFor({ timeout: 20000 });

  // Use the dashboard like a person would: look around, change the chart range, add an invoice.
  await source.bringToFront();
  await source.mouse.move(300, 300);
  await wait(source, 1200);
  const glide = async (loc, steps = 25) => {
    const b = await loc.boundingBox();
    await source.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
    await wait(source, 250);
    await loc.click();
  };
  for (const name of ['30 days', '3 months', '7 days', '3 months']) {
    await glide(source.getByRole('tab', { name }), 12);
    await wait(source, 650);
  }
  await source.mouse.move(520, 470, { steps: 20 });
  // A long pause keeps the chart zoom and the typing zoom apart.
  await wait(source, 4500);
  await source.mouse.move(1100, 120, { steps: 25 });
  await wait(source, 2500);
  const add = source.getByRole('button', { name: 'New invoice' });
  const ab = await add.boundingBox();
  await source.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2, { steps: 30 });
  await add.click();
  await wait(source, 900);
  await source.getByLabel('Customer name').click();
  await source.getByLabel('Customer name').pressSequentially('Jane Cooper', { delay: 140 });
  await source.getByLabel('Email').click();
  await source.getByLabel('Email').pressSequentially('jane@acme.io', { delay: 120 });
  await wait(source, 2500);
  await source.keyboard.press('Escape');
  await source.mouse.move(640, 600, { steps: 20 });
  await wait(source, 1500);

  await recorder.bringToFront();
  await recorder.getByRole('button', { name: 'Stop & open editor', exact: true }).click();
  await recorder.waitForURL('**/editor.html?project=*', { timeout: 60000 });
  await recorder.getByLabel('Project name').waitFor();
  await recorder.getByLabel('Project name').fill('Acme dashboard walkthrough');
  await recorder.getByLabel('Project name').press('Enter');

  // Style: 16:9 on a Lensprout wallpaper.
  await recorder.getByRole('button', { name: 'Style', exact: true }).click();
  await pick(recorder, 'Aspect ratio', 'Wide 16:9');
  await recorder.getByRole('button', { name: 'Apricot wallpaper', exact: true }).click();
  await pick(recorder, 'Image blur', 'Light');
  await recorder.getByRole('switch', { name: 'Overlay cursor' }).click();
  await pick(recorder, 'Cursor highlight', 'Ring');
  await recorder.getByRole('button', { name: 'Apricot wallpaper', exact: true }).scrollIntoViewIfNeeded();
  await wait(recorder, 800);

  // Seek into a zoom so the preview shows the zoomed view.
  const zooms = recorder.getByRole('button', { name: /^Zoom at/ });
  console.log('zooms', await zooms.count(), await zooms.allTextContents());
  const seek = async (index, fraction) => {
    const zb = await zooms.nth(index).boundingBox();
    const tl = await recorder.locator('.timeline-scroll').boundingBox();
    await recorder.locator('.timeline-scroll').click({ position: { x: zb.x - tl.x + zb.width * fraction, y: 12 } });
    await wait(recorder, 1500);
  };
  await seek(0, 0.45);
  await recorder.getByRole('region', { name: 'Video preview' }).screenshot({ path: join(out, 'preview-zoom.png') });
  if ((await zooms.count()) > 1) {
    await seek(1, 0.8);
    await recorder.getByRole('region', { name: 'Video preview' }).screenshot({ path: join(out, 'preview-zoom-typing.png') });
  }
  await seek(0, 0.45);
  await shot(recorder, 'editor-style');

  await recorder.getByRole('button', { name: 'Zoom', exact: true }).click();
  await zooms.first().click();
  await wait(recorder, 1200);
  await shot(recorder, 'editor-zoom');

  // 3D stage with a laptop frame.
  await recorder.getByRole('button', { name: 'Style', exact: true }).click();
  await recorder.getByRole('button', { name: '3D', exact: true }).click();
  await recorder.getByRole('button', { name: 'Laptop', exact: true }).click();
  await wait(recorder, 2000);
  await shot(recorder, 'editor-3d');
  await recorder.getByRole('region', { name: 'Video preview' }).screenshot({ path: join(out, 'preview-3d.png') });
  await recorder.getByRole('button', { name: 'Flat', exact: true }).click();
  await wait(recorder, 800);

  // Export dialog.
  await recorder.getByRole('button', { name: 'Export video', exact: true }).click();
  await wait(recorder, 1000);
  await shot(recorder, 'export');
  await recorder.keyboard.press('Escape');

  // Dark theme.
  await recorder.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await wait(recorder, 1200);
  await shot(recorder, 'editor-dark');
  await recorder.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await wait(recorder, 800);

  // Library.
  await recorder.goto(`chrome-extension://${extensionId}/editor.html`);
  await wait(recorder, 2500);
  await shot(recorder, 'library');
  console.log('captured to', out);
} finally {
  await context.close();
  server.close();
}
