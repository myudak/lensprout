import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type * as Harness from './harness';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Fails on serious/critical WCAG A/AA violations; records every finding in test-results. */
async function accessibility(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    `test-results/axe-${name}.json`,
    JSON.stringify(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
      null,
      2,
    ),
  );
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
}
/** Chooses an option in a shadcn Select (Base UI): open the named combobox, click the option. */
async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
const buildPath = resolve('.output/chrome-mv3');
const manifest = JSON.parse(readFileSync(resolve(buildPath, 'manifest.json'), 'utf8'));
const extensionId = createHash('sha256')
  .update(Buffer.from(manifest.key, 'base64'))
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
let context: BrowserContext, background: Worker;
test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    ignoreDefaultArgs: ['--mute-audio'],
    args: [
      `--disable-extensions-except=${buildPath}`,
      `--load-extension=${buildPath}`,
      `--allowlisted-extension-id=${extensionId}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
});
test.afterAll(async () => {
  await context?.close();
});
type Prefs = {
  audio: boolean;
  camera: string;
  mic: string;
  gain: number;
  noiseSuppression: boolean;
  countdown: number;
};
/** Recorder choices persist in storage; each scenario starts from known ones (no countdown). */
const NO_DEVICES: Prefs = {
  audio: true,
  camera: '',
  mic: '',
  gain: 1,
  noiseSuppression: true,
  countdown: 0,
};
/**
 * Synthetic camera and microphone for the recorder page. Chromium's --use-fake-device-for-media-stream
 * also replaces tab capture ("Requested device not found"), so devices are faked in the page instead:
 * a magenta canvas with a moving square and a 660 Hz tone. Tab capture (mandatory constraints) is real.
 */
function fakeDevices() {
  const devices = [
    { deviceId: 'fake-cam', kind: 'videoinput', label: 'Synthetic camera', groupId: 'fake' },
    { deviceId: 'fake-mic', kind: 'audioinput', label: 'Synthetic microphone', groupId: 'fake' },
  ];
  const media = navigator.mediaDevices,
    real = media.getUserMedia.bind(media);
  media.enumerateDevices = async () =>
    devices.map((d) => ({ ...d, toJSON: () => d })) as unknown as MediaDeviceInfo[];
  media.getUserMedia = async (c?: MediaStreamConstraints) => {
    const mandatory = (x: unknown) => !!x && typeof x === 'object' && 'mandatory' in x;
    if (mandatory(c?.video) || mandatory(c?.audio)) return real(c);
    const tracks: MediaStreamTrack[] = [];
    if (c?.video) {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      let n = 0;
      const paint = () => {
        ctx.fillStyle = '#d946ef';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect((n++ * 16) % 520, 180, 120, 120);
      };
      paint();
      setInterval(paint, 33);
      tracks.push(...canvas.captureStream(30).getVideoTracks());
    }
    if (c?.audio) {
      const ac = new AudioContext(),
        tone = ac.createOscillator(),
        gain = ac.createGain(),
        out = ac.createMediaStreamDestination();
      tone.frequency.value = 660;
      gain.gain.value = 0.3;
      tone.connect(gain).connect(out);
      tone.start();
      tracks.push(...out.stream.getAudioTracks());
    }
    return new MediaStream(tracks);
  };
}
let fakesInstalled = false;
async function prepare(
  sourceUrl: string,
  prefs: Prefs = NO_DEVICES,
  options: { keepPresets?: boolean } = {},
) {
  const source = await context.newPage();
  await source.goto(sourceUrl);
  const session = await background.evaluate(
    async ({ url, extensionId, prefs, keepPresets }) => {
      // Tab capture is test plumbing now (the product records screens and windows only).
      await chrome.storage.local.set({ recorderPrefs: prefs, devCaptureMode: 'tab' });
      // Style presets persist across scenarios; a default one would restyle new recordings.
      if (!keepPresets) await chrome.storage.local.remove('stylePresets');
      const [tab] = await chrome.tabs.query({ url });
      if (!tab?.id) throw new Error('Fixture tab missing');
      const id = crypto.randomUUID();
      const r = await chrome.tabs.create({
        url: `chrome-extension://${extensionId}/recorder.html?session=${id}`,
        pinned: true,
      });
      const s = {
        id,
        sourceTabId: tab.id,
        recorderTabId: r.id!,
        sourceTitle: tab.title ?? 'Fixture',
        status: 'ready',
      };
      await chrome.storage.session.set({ session: s });
      return s;
    },
    { url: sourceUrl, extensionId, prefs, keepPresets: !!options.keepPresets },
  );
  const recorder =
    context.pages().find((p) => p.url().includes(`session=${session.id}`)) ??
    (await context.waitForEvent('page'));
  await expect(
    recorder.getByRole('button', { name: 'Start recording', exact: true }),
  ).toBeEnabled();
  return { source, recorder, session };
}
test('record tab/audio, pause, resize, navigate, edit/reopen, cancel, and export composed MP4', async () => {
  const { source, recorder, session } = await prepare('http://127.0.0.1:4178/');
  const errors: string[] = [];
  recorder.on('pageerror', (e) => errors.push(e.message));
  await source.getByRole('button', { name: 'Start test tone' }).click();
  await recorder.screenshot({ path: 'test-results/recorder.png' });
  await accessibility(recorder, 'recorder-light');
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(
    recorder.getByRole('button', { name: 'Pause recording', exact: true }),
  ).toBeVisible();
  await source.waitForTimeout(600);
  await source.locator('#target-a').click();
  await source.waitForTimeout(550);
  await source.locator('#target-a').click();
  await source.waitForTimeout(250); // Allow the final pre-pause click to reach a captured frame.
  await recorder.getByRole('button', { name: 'Pause recording', exact: true }).click();
  const pausedTime = await recorder.locator('.time').innerText();
  await source.locator('#target-b').click();
  await source.waitForTimeout(1200);
  expect(await recorder.locator('.time').innerText()).toBe(pausedTime);
  await recorder.getByRole('button', { name: 'Resume recording', exact: true }).click();
  await source.setViewportSize({ width: 1100, height: 700 });
  await source.locator('#target-b').click();
  await source.waitForTimeout(550);
  await source.locator('#target-b').click();
  await source.goto('http://127.0.0.1:4178/navigated');
  await source.waitForTimeout(400);
  await source.locator('#target-a').click();
  await source.waitForTimeout(550);
  await source.locator('#target-a').click();
  await source.getByRole('button', { name: 'Start test tone' }).click();
  await source.locator('#secret').click();
  await source.locator('#secret').pressSequentially('hunter2', { delay: 40 });
  await source.locator('#typing').click();
  await source.locator('#typing').pressSequentially('typing zoom', { delay: 120 });
  await source.keyboard.press('Control+K');
  await source.waitForTimeout(1800);
  await recorder.getByRole('button', { name: 'Stop & open editor', exact: true }).click();
  await recorder.waitForURL(`**/editor.html?project=${session.id}`);
  await expect(recorder.getByLabel('Project name')).toBeVisible();
  const captured = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    const d = await h.loadProject(id);
    const raw = await h.mediaFile(d.recording.mediaRef);
    const input = new h.Input({ source: new h.BlobSource(raw), formats: h.ALL_FORMATS });
    try {
      return {
        ...d,
        size: raw.size,
        mediaDuration: await input.computeDuration(),
        audio: !!(await input.getPrimaryAudioTrack()),
        firstTimestamp: await input.getFirstTimestamp(),
        videoDuration: await (await input.getPrimaryVideoTrack())!.computeDuration(),
      };
    } finally {
      input.dispose();
    }
  }, session.id);
  expect(captured.size).toBeGreaterThan(10000);
  expect(captured.recording.durationUs).toBeGreaterThan(5e6);
  // Typing steps lengthen the fixture; slow machines stretch it further.
  expect(captured.recording.durationUs).toBeLessThan(25e6);
  expect(captured.audio).toBe(true);
  expect(captured.events.filter((e) => e.kind === 'pointer-down').length).toBeGreaterThanOrEqual(6);
  expect(captured.recording.geometry.length).toBeGreaterThanOrEqual(2);
  expect(captured.project.zooms.length).toBeGreaterThan(0);
  expect(captured.events.every((e) => e.point.x >= 0 && e.point.x <= 1 && e.atUs >= 0)).toBe(true);
  // Typing in the text field yields caret events; the password field yields none.
  const carets = captured.events.filter((e) => e.kind === 'caret');
  expect(carets.length).toBeGreaterThanOrEqual(3);
  expect(captured.events.filter((e) => e.kind === 'chord').map((e) => e.keys)).toContain('Ctrl+K');
  expect(captured.recording.mediaRef).toMatch(/-seekable\.webm$/);
  expect(captured.recording.source).toBe('tab');
  const a = captured.events.find((e) => e.kind === 'pointer-down')!;
  expect(a.point.x).toBeLessThan(0.5);
  expect(a.point.y).toBeLessThan(0.6);
  const alignment = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness,
      d = await h.loadProject(id);
    const input = new h.Input({
      source: new h.BlobSource(await h.mediaFile(d.recording.mediaRef)),
      formats: h.ALL_FORMATS,
    });
    try {
      const video = (await input.getPrimaryVideoTrack())!,
        sink = new h.CanvasSink(video),
        audio = await input.getPrimaryAudioTrack();
      const pause = d.recording.pauses[0]!,
        midpoint = h.seconds((pause.startUs + pause.endUs) / 2),
        sample = (await sink.getCanvas(midpoint))!;
      const p =
        sample?.canvas.getContext('2d')!.getImageData(10, 10, 200, 200).data ??
        new Uint8Array(200 * 200 * 4);
      let mean = 0;
      for (let i = 0; i < p.length; i += 4) mean += p[i]! + p[i + 1]! + p[i + 2]!;
      let rms = 0;
      if (audio) {
        const s = await new h.AudioSampleSink(audio).getSample(midpoint);
        if (s) {
          const b = s.toAudioBuffer().getChannelData(0);
          rms = Math.sqrt(b.reduce((sum, x) => sum + x * x, 0) / b.length);
          s.close();
        }
      }
      const markers: { at: number; x: number; y: number }[] = [],
        probe = new OffscreenCanvas(320, 200),
        probeCtx = probe.getContext('2d')!;
      for await (const frame of new h.VideoSampleSink(video).samples()) {
        frame.draw(probeCtx, 0, 0, 320, 200);
        const pix = probeCtx.getImageData(0, 0, 320, 200).data;
        let count = 0,
          x = 0,
          y = 0;
        for (let i = 0; i < pix.length; i += 4)
          if (pix[i]! > 200 && pix[i + 1]! < 60 && pix[i + 2]! > 200) {
            count++;
            x += (i / 4) % 320;
            y += Math.floor(i / 4 / 320);
          }
        if (count) markers.push({ at: frame.timestamp, x: x / count / 320, y: y / count / 200 });
        frame.close();
      }
      const checks = d.events
        .filter((e) => e.kind === 'pointer-down')
        .slice(0, 6)
        .map((e) => {
          const rawAt = h.seconds(h.logicalToRaw(d.recording, e.atUs));
          const match = markers.find(
            (m) =>
              m.at >= rawAt - 0.02 &&
              m.at < rawAt + 0.15 &&
              Math.hypot(m.x - e.point.x, m.y - e.point.y) < 0.02,
          );
          return {
            atUs: e.atUs,
            geometry: e.geometryId,
            markerFound: !!match,
            delayMs: match ? (match.at - rawAt) * 1000 : null,
            pointError: match ? Math.hypot(match.x - e.point.x, match.y - e.point.y) : null,
          };
        });
      return {
        checks,
        markers,
        pauses: d.recording.pauses,
        pausedMean: mean / ((p.length / 4) * 3),
        pausedAudioRms: rms,
        firstTimestamp: await input.getFirstTimestamp(),
        firstVideoTimestamp: await video.getFirstTimestamp(),
        videoDuration: await video.computeDuration(),
        pauseHasFrame: !!sample,
        duration: await input.computeDuration(),
        rawDuration: h.seconds(d.recording.rawDurationUs),
      };
    } finally {
      input.dispose();
    }
  }, session.id);
  writeFileSync('test-results/alignment.json', JSON.stringify(alignment, null, 2));
  expect(alignment.checks.every((c) => c.markerFound)).toBe(true);
  expect(alignment.pausedMean).toBeLessThan(4);
  expect(alignment.pausedAudioRms).toBeLessThan(0.005);
  expect(Math.abs(alignment.duration - alignment.rawDuration)).toBeLessThan(0.15);
  // The preview canvas must show decoded source pixels (the fixture page is light), not an empty frame.
  await expect
    .poll(
      () =>
        recorder.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>(
            'canvas[aria-label="Composition preview"]',
          )!;
          const d = c
            .getContext('2d')!
            .getImageData(c.width / 2 - 20, c.height / 2 - 20, 40, 40).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
          return sum / (d.length / 4) / 3;
        }),
      { timeout: 10000 },
    )
    .toBeGreaterThan(120);
  // Playback advances the shared clock and pausing holds it.
  const clockBefore = await recorder.locator('.clock').innerText();
  await recorder.getByRole('button', { name: 'Play preview', exact: true }).click();
  await recorder.waitForTimeout(900);
  await recorder.getByRole('button', { name: 'Pause preview', exact: true }).click();
  const clockPaused = await recorder.locator('.clock').innerText();
  expect(clockPaused).not.toBe(clockBefore);
  await recorder.waitForTimeout(300);
  expect(await recorder.locator('.clock').innerText()).toBe(clockPaused);
  // Keyboard selection + manual edit + persistence. Numeric times provide accessible resize.
  const zoomsBefore = await recorder.getByRole('button', { name: /^Zoom at/ }).count();
  await recorder
    .getByRole('button', { name: /^Zoom at/ })
    .first()
    .focus();
  await recorder.keyboard.press('Enter');
  await recorder.getByLabel('Magnification', { exact: true }).fill('2');
  await recorder.getByLabel('Magnification', { exact: true }).press('Enter');
  await expect(recorder.getByLabel('Magnification', { exact: true })).toHaveValue('2');
  await recorder.getByRole('button', { name: 'Fixed', exact: true }).click();
  await recorder.waitForTimeout(300);
  await recorder.screenshot({ path: 'test-results/editor-zoom-panel.png' });
  await recorder.getByLabel('Focus X (0–1)', { exact: true }).fill('0.25');
  await recorder.getByLabel('Focus X (0–1)', { exact: true }).press('Enter');
  const zoomEnd = recorder.getByLabel('Zoom end (s)', { exact: true });
  await zoomEnd.fill(String(Number(await zoomEnd.inputValue()) + 0.1));
  await zoomEnd.press('Enter');
  await recorder.getByRole('button', { name: 'Regenerate auto zoom', exact: true }).first().click();
  // Regeneration keeps the edited (now manual) zoom.
  await expect(recorder.getByRole('button', { name: /, 2 times$/ })).toHaveCount(1);
  const afterRegenerate = await recorder.getByRole('button', { name: /^Zoom at/ }).count();
  expect(afterRegenerate).toBeGreaterThanOrEqual(1);
  expect(afterRegenerate).toBeLessThanOrEqual(zoomsBefore);
  const playhead = recorder.getByLabel('Playhead', { exact: true });
  await playhead.focus();
  // The clip start precedes the first automatic zoom (anticipation starts 0.5 s before a click).
  await playhead.press('Home');
  await recorder.getByRole('button', { name: 'Add zoom', exact: true }).click();
  await expect(recorder.getByRole('button', { name: /^Zoom at/ })).toHaveCount(afterRegenerate + 1);
  const handle = await recorder
    .locator('[data-item][aria-pressed="true"] [data-handle="end"]')
    .boundingBox();
  if (!handle) throw new Error('Resize handle missing');
  await recorder.mouse.move(handle.x + 4, handle.y + 10);
  await recorder.mouse.down();
  await recorder.mouse.move(handle.x - 25, handle.y + 10, { steps: 4 });
  await recorder.mouse.up();
  // Drag the selected segment body; it moves (or clamps) without overlap errors.
  const body = await recorder.locator('[data-item][aria-pressed="true"]').boundingBox();
  if (!body) throw new Error('Segment missing');
  await recorder.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await recorder.mouse.down();
  await recorder.mouse.move(body.x + body.width / 2 - 30, body.y + body.height / 2, { steps: 4 });
  await recorder.mouse.up();
  await expect(recorder.getByRole('alert')).toHaveCount(0);
  await recorder.getByRole('button', { name: 'Delete zoom', exact: true }).click();
  await expect(recorder.getByRole('button', { name: /^Zoom at/ })).toHaveCount(afterRegenerate);
  await recorder.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(recorder.getByRole('button', { name: /^Zoom at/ })).toHaveCount(afterRegenerate + 1);
  await recorder.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(recorder.getByRole('button', { name: /^Zoom at/ })).toHaveCount(afterRegenerate);
  await recorder.getByLabel('Project name').fill('Fixture edited locally');
  await recorder.getByRole('button', { name: 'Style', exact: true }).click();
  await pick(recorder, 'Aspect ratio', 'Wide 16:9');
  // Local builds carry the wallpaper pack (release zips do not): pick one and keep it, so the
  // export below proves the worker loads it (parity plus a non-fallback corner color).
  if (existsSync(resolve(buildPath, 'wallpapers/index.json'))) {
    const packed = recorder.getByRole('button', { name: 'Big Sur light wallpaper', exact: true });
    await packed.click();
    await expect(packed).toHaveAttribute('aria-pressed', 'true');
    await expect(recorder.locator('.save-status')).toHaveText('Saved');
    const withWallpaper = await recorder.evaluate(async (id) => {
      const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
      return (await h.loadProject(id)).project.composition.background;
    }, session.id);
    expect(withWallpaper).toEqual({ type: 'wallpaper', id: 'big-sur-light', blur: 'none' });
    await recorder.waitForTimeout(600);
    await recorder.screenshot({ path: 'test-results/style-wallpaper.png' });
    await accessibility(recorder, 'style-wallpaper');
  }
  await recorder.getByRole('button', { name: 'Clip', exact: true }).click();
  await recorder.getByLabel('Trim start (s)', { exact: true }).fill('0.5');
  await recorder.getByLabel('Trim start (s)', { exact: true }).press('Enter');
  await expect(recorder.locator('.save-status')).toHaveText('Saved');
  await recorder.reload();
  await expect(recorder.getByLabel('Project name')).toHaveValue('Fixture edited locally');
  await recorder.getByRole('button', { name: 'Clip', exact: true }).click();
  await expect(recorder.getByLabel('Trim start (s)', { exact: true })).toHaveValue('0.5');
  // Timeline filmstrip thumbnails decode from the seekable source.
  await expect
    .poll(
      () => recorder.locator('.filmstrip').evaluate((el) => getComputedStyle(el).backgroundImage),
      {
        timeout: 15000,
      },
    )
    .toContain('data:image');
  // Ctrl + wheel and Ctrl + = zoom the timeline (not the page); Ctrl + 0 fits it again.
  const timelineZoom = recorder.getByLabel('Timeline zoom', { exact: true });
  await recorder.locator('.timeline-scroll').hover();
  await recorder.keyboard.down('Control');
  await recorder.mouse.wheel(0, -240);
  await recorder.keyboard.up('Control');
  await expect.poll(async () => Number(await timelineZoom.inputValue())).toBeGreaterThan(0.2);
  await recorder.keyboard.press('Control+0');
  await expect(timelineZoom).toHaveValue('0');
  await recorder.getByRole('region', { name: 'Video preview' }).click({ position: { x: 5, y: 5 } });
  await recorder.keyboard.press('Control+Equal');
  await expect.poll(async () => Number(await timelineZoom.inputValue())).toBeGreaterThan(0);
  await recorder.keyboard.press('Control+0');
  // Add segments of several types from the Add segment menu.
  await recorder.keyboard.press('Escape');
  await recorder.keyboard.press('Home');
  await recorder.getByRole('button', { name: 'Add segment', exact: true }).click();
  await recorder.getByRole('menuitem', { name: 'Text' }).click();
  await recorder.getByLabel('Text content').fill('Hello export');
  await recorder.getByRole('button', { name: 'Box', exact: true }).click();
  await expect(
    recorder.getByRole('button', { name: /^Text segment at .*Hello export/ }),
  ).toHaveCount(1);
  await recorder.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await recorder.keyboard.press('Shift+ArrowRight');
  await recorder.getByRole('button', { name: 'Add segment', exact: true }).click();
  await recorder.getByRole('menuitem', { name: 'Speed' }).click();
  await recorder.getByRole('button', { name: '1.5×', exact: true }).click();
  await recorder.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await recorder.keyboard.press('Shift+ArrowRight');
  await recorder.getByRole('button', { name: 'Add segment', exact: true }).click();
  await recorder.getByRole('menuitem', { name: 'Trim' }).click();
  await expect(recorder.getByRole('button', { name: /^Trim segment at/ })).toHaveCount(1);
  await expect(recorder.getByRole('button', { name: /^Speed segment at .*1\.5×/ })).toHaveCount(1);
  // Text and speed overlap in time on separate tracks.
  // Two used tracks plus the empty lane for new segments.
  expect(await recorder.locator('[data-track]').count()).toBeGreaterThanOrEqual(3);
  // Crop: tab recordings have no browser bars to auto-crop; a manual crop persists.
  await recorder.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(recorder.getByRole('button', { name: /Crop browser bars/ })).toBeDisabled();
  await recorder.getByLabel('Crop top (%)', { exact: true }).fill('5');
  await recorder.getByLabel('Crop top (%)', { exact: true }).press('Enter');
  await expect(recorder.locator('.save-status')).toHaveText('Saved');
  await recorder.screenshot({ path: 'test-results/editor-segments.png' });
  // Ctrl+K palette adds a blur segment.
  await recorder.keyboard.press('Escape');
  await recorder.keyboard.press('Control+k');
  await recorder.getByLabel('Search commands').fill('add blur');
  await recorder.keyboard.press('Enter');
  await expect(recorder.getByRole('button', { name: /^Blur segment at/ })).toHaveCount(1);
  // Right-click: duplicate the text segment (it lands on the next free track), then move it to the empty track 4.
  await recorder
    .getByRole('button', { name: /^Text segment at .*Hello export/ })
    .click({ button: 'right' });
  await recorder.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(
    recorder.getByRole('button', { name: /^Text segment at .*Hello export/ }),
  ).toHaveCount(2);
  const copy = recorder.getByRole('button', { name: /^Text segment at .*Hello export/ }).nth(1);
  await copy.click({ button: 'right' });
  await recorder.getByRole('menuitem', { name: 'Move to track' }).hover();
  await recorder.getByRole('menuitem', { name: 'Track 4', exact: true }).click();
  await expect
    .poll(() => copy.evaluate((el) => el.closest('[data-track]')?.getAttribute('data-track')))
    .toBe('3');
  // Dark theme: tokens switch and the preview still renders the source.
  await recorder.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(recorder.locator('html')).toHaveClass(/dark/);
  await recorder.keyboard.press('Escape');
  // Let color transitions finish so axe measures final colors.
  await recorder.waitForTimeout(500);
  await recorder.screenshot({ path: 'test-results/editor-dark.png' });
  await accessibility(recorder, 'editor-dark');
  await recorder.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await expect(recorder.locator('html')).not.toHaveClass(/dark/);
  await recorder.waitForTimeout(500);
  await accessibility(recorder, 'editor-light');
  // Resizing the inspector persists across reloads.
  const inspector = recorder.getByRole('complementary');
  const before = (await inspector.boundingBox())!.width;
  const separator = recorder
    .locator('[data-slot="resizable-handle"][aria-orientation="vertical"]')
    .first();
  const grip = (await separator.boundingBox())!;
  await recorder.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await recorder.mouse.down();
  await recorder.mouse.move(grip.x - 80, grip.y + grip.height / 2, { steps: 6 });
  await recorder.mouse.up();
  const resized = (await inspector.boundingBox())!.width;
  expect(resized).toBeGreaterThan(before + 40);
  await expect(recorder.locator('.save-status')).toHaveText('Saved');
  await recorder.reload();
  await expect(recorder.getByLabel('Project name')).toBeVisible();
  await expect
    .poll(async () => (await recorder.getByRole('complementary').boundingBox())!.width)
    .toBeGreaterThan(before + 40);
  await recorder.screenshot({ path: 'test-results/editor.png', fullPage: true });
  await context.setOffline(true);
  await recorder.getByRole('button', { name: 'Export video', exact: true }).click();
  await recorder.getByRole('button', { name: '720p', exact: true }).click();
  await recorder.getByRole('button', { name: '30 fps', exact: true }).click();
  await expect(recorder.locator('.export-summary')).toContainText('1280 × 720');
  await recorder.screenshot({ path: 'test-results/export-dialog.png' });
  await recorder.getByRole('button', { name: 'Start export', exact: true }).click();
  await expect
    .poll(
      async () =>
        Number(
          await recorder
            .getByRole('progressbar', { name: 'Export progress' })
            .getAttribute('aria-valuenow'),
        ),
      { intervals: [50], timeout: 15000 },
    )
    .toBeGreaterThan(0);
  await recorder.getByRole('button', { name: 'Cancel export', exact: true }).click();
  await expect(recorder.getByRole('button', { name: 'Start export', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  await expect(recorder.getByRole('link', { name: 'Download MP4' })).toHaveCount(0);
  expect(
    await recorder.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names = [];
      for await (const [name] of root as unknown as AsyncIterable<[string, FileSystemHandle]>)
        if (name.startsWith('export-')) names.push(name);
      return names;
    }),
  ).toEqual([]);
  await recorder.getByRole('button', { name: 'Start export', exact: true }).click();
  await expect(recorder.getByRole('link', { name: 'Download MP4' })).toBeVisible({
    timeout: 90000,
  });
  const downloadPromise = recorder.waitForEvent('download');
  await recorder.getByRole('link', { name: 'Download MP4' }).click();
  const download = await downloadPromise;
  await download.saveAs('test-results/fixture-export.mp4');
  const inspected = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness,
      d = await h.loadProject(id);
    const root = await navigator.storage.getDirectory();
    let outputName = '';
    for await (const [name] of root as unknown as AsyncIterable<[string, FileSystemHandle]>)
      if (name.startsWith('export-')) outputName = name;
    const output = new h.Input({
      source: new h.BlobSource(await h.mediaFile(outputName)),
      formats: h.ALL_FORMATS,
    });
    const raw = new h.Input({
      source: new h.BlobSource(await h.mediaFile(d.recording.mediaRef)),
      formats: h.ALL_FORMATS,
    });
    try {
      const v = (await output.getPrimaryVideoTrack())!,
        a = await output.getPrimaryAudioTrack();
      const edit = h.createEditMap(d.project);
      const sampleTime =
          h.seconds(edit.toOutput(d.events.filter((e) => e.kind === 'pointer-down')[4]!.atUs)) +
          0.1,
        encoded = (await new h.CanvasSink(v).getCanvas(sampleTime))!;
      // Output time → logical time through the same cut/speed map the exporter uses.
      const logicalTime = Math.round(edit.toLogical(h.us(encoded.timestamp))),
        rawTime = h.seconds(h.logicalToRaw(d.recording, logicalTime));
      const src = new OffscreenCanvas(d.recording.width, d.recording.height);
      const sourceCtx = src.getContext('2d')!;
      for await (const frame of new h.VideoSampleSink(
        (await raw.getPrimaryVideoTrack())!,
      ).samples()) {
        if (frame.timestamp > rawTime) {
          frame.close();
          break;
        }
        if (src.width !== frame.displayWidth || src.height !== frame.displayHeight) {
          src.width = frame.displayWidth;
          src.height = frame.displayHeight;
        }
        frame.draw(sourceCtx, 0, 0, src.width, src.height);
        frame.close();
      }
      const size = h.outputSize(d.project, d.recording),
        expected = new OffscreenCanvas(size.width, size.height),
        ctx = expected.getContext('2d')!;
      h.renderFrame(ctx, {
        source: src,
        sourceWidth: src.width,
        sourceHeight: src.height,
        cameras: h.motionSamples(
          h.createCamera(d.project, d.events),
          logicalTime,
          d.project.output.fps,
          d.project.effects.motionBlur,
        ),
        project: d.project,
        width: size.width,
        height: size.height,
        background: h.paintBackground(
          d.project.composition.background,
          size.width,
          size.height,
          await h.loadBackgroundSource(d.project.composition.background),
        ),
        overlays: h.createOverlays(d.events),
        atUs: logicalTime,
      });
      const actualCtx = encoded!.canvas.getContext('2d')!,
        pixels = actualCtx.getImageData(0, 0, expected.width, expected.height).data,
        expectedPixels = ctx.getImageData(0, 0, expected.width, expected.height).data;
      let diff = 0;
      for (let i = 0; i < pixels.length; i += 4)
        diff +=
          Math.abs(pixels[i]! - expectedPixels[i]!) +
          Math.abs(pixels[i + 1]! - expectedPixels[i + 1]!) +
          Math.abs(pixels[i + 2]! - expectedPixels[i + 2]!);
      let rms = 0;
      if (a) {
        const sample = await new h.AudioSampleSink(a).getSample(0.6);
        if (sample) {
          const buffer = sample.toAudioBuffer().getChannelData(0);
          rms = Math.sqrt(buffer.reduce((sum, x) => sum + x * x, 0) / buffer.length);
          sample.close();
        }
      }
      return {
        duration: await output.computeDuration(),
        width: v.displayWidth,
        height: v.displayHeight,
        audioCodec: await a?.getCodec(),
        videoCodec: await v.getCodec(),
        rms,
        sampledLogicalTime: h.seconds(logicalTime),
        sampledCamera: h.createCamera(d.project, d.events).at(logicalTime),
        mae: diff / ((pixels.length / 4) * 3),
        backgroundType: d.project.composition.background.type,
        corner: [...pixels.slice(0, 3)],
        expectedDuration: h.seconds(edit.durationUs),
        segments: d.project.segments.map((x) => x.kind),
        rawGeometry: d.recording.geometry,
      };
    } finally {
      output.dispose();
      raw.dispose();
    }
  }, session.id);
  expect(inspected.width).toBe(1280);
  expect(inspected.height).toBe(720);
  expect(inspected.videoCodec).toBe('avc');
  expect(inspected.audioCodec).toBe('aac');
  expect(inspected.rms).toBeGreaterThan(0.01);
  expect(Math.abs(inspected.duration - inspected.expectedDuration)).toBeLessThan(0.12);
  expect(inspected.mae).toBeLessThan(12);
  if (inspected.backgroundType === 'wallpaper') {
    // The exported corner shows the wallpaper, not the gray painted when the image fails to load.
    const [r, g, b] = inspected.corner as [number, number, number];
    expect(Math.abs(r - 0xd9) + Math.abs(g - 0xde) + Math.abs(b - 0xe7)).toBeGreaterThan(40);
  }
  expect(errors).toEqual([]);
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/capture-and-export.json',
    JSON.stringify(
      {
        browser: context.browser()?.version(),
        extensionId,
        captured: {
          recording: captured.recording,
          size: captured.size,
          mediaDuration: captured.mediaDuration,
          inputEvents: captured.events.length,
          clicks: captured.events.filter((e) => e.kind === 'pointer-down'),
          zooms: captured.project.zooms,
        },
        inspected,
        errors,
      },
      null,
      2,
    ),
  );
  await context.setOffline(false);
});
test('countdown, webcam and microphone capture; cursor, offset and camera editing; webcam export', async () => {
  // Registered before the recorder opens: a failed real-device preview would clear the saved choice.
  // It stays for later scenarios, which select no devices and so never reach it.
  if (!fakesInstalled) await context.addInitScript(fakeDevices);
  fakesInstalled = true;
  const { source, recorder, session } = await prepare('http://127.0.0.1:4178/devices', {
    ...NO_DEVICES,
    audio: false,
    camera: 'fake-cam',
    mic: 'fake-mic',
    countdown: 3,
  });
  const errors: string[] = [];
  recorder.on('pageerror', (e) => errors.push(e.message));
  // Device previews start after the (auto-accepted) permission grant.
  await expect(recorder.getByLabel('Camera preview')).toBeVisible();
  await expect
    .poll(() =>
      recorder.getByLabel('Camera preview').evaluate((v: HTMLVideoElement) => v.videoWidth),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      Number(
        await recorder
          .getByRole('meter', { name: 'Microphone level' })
          .getAttribute('aria-valuenow'),
      ),
    )
    .toBeGreaterThan(20);
  await expect(recorder.getByRole('combobox', { name: 'Camera', exact: true })).toHaveText(
    /Synthetic camera/,
  );
  await recorder.screenshot({ path: 'test-results/recorder-devices.png' });
  await accessibility(recorder, 'recorder-devices');
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  // The countdown is drawn on the recorded page, then removed before recording starts.
  await expect(source.locator('#lensprout-countdown')).toHaveCount(1, { timeout: 8000 });
  const shown = await source.evaluate(() =>
    document
      .getElementById('lensprout-countdown')
      ?.shadowRoot?.querySelector('.n')
      ?.textContent?.trim(),
  );
  expect(['3', '2', '1']).toContain(shown);
  await source.screenshot({ path: 'test-results/countdown.png' });
  await expect(recorder.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(source.locator('#lensprout-countdown')).toHaveCount(0);
  await source.mouse.move(200, 300);
  await source.mouse.move(420, 360, { steps: 12 });
  await source.locator('#target-a').hover();
  await source.waitForTimeout(400);
  await source.locator('#target-a').click();
  await source.waitForTimeout(500);
  await source.locator('#target-a').click();
  await source.locator('#typing').hover();
  await source.mouse.move(640, 500, { steps: 10 });
  await source.waitForTimeout(1500);
  await recorder.getByRole('button', { name: 'Stop & open editor', exact: true }).click();
  await recorder.waitForURL(`**/editor.html?project=${session.id}`);
  await expect(recorder.getByLabel('Project name')).toBeVisible();
  const captured = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    const d = await h.loadProject(id);
    const main = new h.Input({
      source: new h.BlobSource(await h.mediaFile(d.recording.mediaRef)),
      formats: h.ALL_FORMATS,
    });
    const cam = new h.Input({
      source: new h.BlobSource(await h.mediaFile(d.recording.camera!.mediaRef)),
      formats: h.ALL_FORMATS,
    });
    try {
      const audio = await main.getPrimaryAudioTrack();
      // Peak RMS over the recording (the synthetic microphone is a steady tone).
      let peak = 0;
      if (audio)
        for await (const sample of new h.AudioSampleSink(audio).samples()) {
          const b = sample.toAudioBuffer().getChannelData(0);
          peak = Math.max(peak, Math.sqrt(b.reduce((sum, x) => sum + x * x, 0) / b.length));
          sample.close();
        }
      // Mean brightness of the first frames: a captured countdown veil would darken them.
      const means: { at: number; mean: number }[] = [],
        probe = new OffscreenCanvas(160, 100),
        pctx = probe.getContext('2d')!;
      for await (const frame of new h.VideoSampleSink(
        (await main.getPrimaryVideoTrack())!,
      ).samples()) {
        frame.draw(pctx, 0, 0, 160, 100);
        const px = pctx.getImageData(0, 0, 160, 100).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += px[i]! + px[i + 1]! + px[i + 2]!;
        means.push({ at: frame.timestamp, mean: sum / (px.length / 4) / 3 });
        frame.close();
        if (means.length > 40) break;
      }
      return {
        recording: d.recording,
        project: d.project,
        events: d.events,
        audio: !!audio,
        peak,
        means,
        camDuration: await cam.computeDuration(),
      };
    } finally {
      main.dispose();
      cam.dispose();
    }
  }, session.id);
  writeFileSync(
    'test-results/devices-capture.json',
    JSON.stringify({ ...captured, events: captured.events.length }, null, 2),
  );
  expect(captured.recording.camera).toBeTruthy();
  expect(captured.recording.camera!.mediaRef).toMatch(/^webcam-.*-seekable\.webm$/);
  expect(captured.recording.camera!.width).toBeGreaterThan(0);
  expect(Math.abs(captured.recording.camera!.offsetUs)).toBeLessThan(500_000);
  expect(captured.camDuration).toBeGreaterThan(captured.recording.rawDurationUs / 1_000_000 - 1);
  // Tab audio is off, so any audio comes from the microphone mix.
  expect(captured.recording.hasAudio).toBe(true);
  expect(captured.audio).toBe(true);
  expect(captured.peak).toBeGreaterThan(0.005);
  const first = captured.means[0]!.mean,
    later = captured.means.at(-1)!.mean;
  expect(Math.abs(first - later)).toBeLessThan(12);
  expect(captured.events.some((e) => e.kind === 'pointer-move' && e.cursor)).toBe(true);
  // Chrome's UA style gives buttons the arrow; text inputs show the I-beam.
  const downs = captured.events.filter((e) => e.kind === 'pointer-down');
  expect(downs.length).toBeGreaterThanOrEqual(2);
  expect(downs.every((e) => e.cursor === 'arrow')).toBe(true);
  expect(captured.events.some((e) => e.cursor === 'text')).toBe(true);
  // Editor: camera panel, a camera segment, cursor overlay/highlight and a cursor offset.
  await expect(recorder.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  await recorder.getByLabel('Playhead', { exact: true }).focus();
  await recorder.keyboard.press('Home');
  await recorder.getByRole('button', { name: 'Camera', exact: true }).click();
  await recorder.getByRole('button', { name: 'Top left', exact: true }).click();
  await recorder.getByRole('button', { name: 'Rounded', exact: true }).click();
  await recorder.getByRole('button', { name: 'Add camera segment', exact: true }).click();
  await expect(recorder.getByRole('button', { name: /^Camera segment at/ })).toHaveCount(1);
  await pick(recorder, 'Camera layout', 'Full frame');
  await expect(
    recorder.getByRole('button', { name: /^Camera segment at .*full frame/ }),
  ).toHaveCount(1);
  await recorder.getByRole('button', { name: /^Camera segment at/ }).click({ button: 'right' });
  await recorder.getByRole('menuitem', { name: 'Camera layout' }).hover();
  await recorder.getByRole('menuitem', { name: 'Small', exact: true }).click();
  await expect(recorder.getByRole('button', { name: /^Camera segment at .*small/ })).toHaveCount(1);
  await recorder.getByRole('button', { name: 'Style', exact: true }).click();
  await recorder.getByRole('switch', { name: 'Overlay cursor' }).click();
  await pick(recorder, 'Cursor highlight', 'Ring');
  await recorder.getByRole('button', { name: 'Zoom', exact: true }).click();
  await recorder.getByRole('button', { name: 'Global', exact: true }).click();
  await recorder.screenshot({ path: 'test-results/editor-zoom-global.png' });
  await recorder.getByLabel('Offset X (%)', { exact: true }).fill('-20');
  await recorder.getByLabel('Offset X (%)', { exact: true }).press('Enter');
  await recorder.getByLabel('Offset Y (%)', { exact: true }).fill('15');
  await recorder.getByLabel('Offset Y (%)', { exact: true }).press('Enter');
  await recorder.getByRole('button', { name: 'Apply to all follow zooms', exact: true }).click();
  await expect(recorder.locator('.save-status')).toHaveText('Saved');
  await recorder.screenshot({ path: 'test-results/editor-camera-cursor.png' });
  await accessibility(recorder, 'editor-offset');
  await recorder.getByRole('button', { name: 'Camera', exact: true }).click();
  await accessibility(recorder, 'editor-camera');
  const saved = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    return (await h.loadProject(id)).project;
  }, session.id);
  expect(saved.webcam.corner).toBe('tl');
  expect(saved.webcam.shape).toBe('rounded');
  expect(saved.cursor.overlay.enabled).toBe(true);
  expect(saved.cursor.highlight.style).toBe('ring');
  expect(saved.autoZoom.offset).toEqual({ x: -0.2, y: 0.15 });
  expect(
    saved.zooms
      .filter((z) => z.focus.mode === 'follow-pointer')
      .every((z) => z.focus.mode === 'follow-pointer' && z.focus.offset?.x === -0.2),
  ).toBe(true);
  // Export composes the webcam; compare against the shared renderer with the decoded webcam frame.
  await recorder.getByRole('button', { name: 'Export video', exact: true }).click();
  await recorder.getByRole('button', { name: '720p', exact: true }).click();
  await recorder.getByRole('button', { name: '30 fps', exact: true }).click();
  await expect(recorder.locator('.export-summary')).toContainText('webcam');
  await recorder.getByRole('button', { name: 'Start export', exact: true }).click();
  await expect(recorder.getByRole('link', { name: 'Download MP4' })).toBeVisible({
    timeout: 90000,
  });
  const exported = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness,
      d = await h.loadProject(id);
    const root = await navigator.storage.getDirectory();
    // Earlier scenarios leave their exports; take the newest.
    let outputName = '',
      newest = 0;
    for await (const [name, handle] of root as unknown as AsyncIterable<
      [string, FileSystemFileHandle]
    >)
      if (name.startsWith('export-')) {
        const modified = (await handle.getFile()).lastModified;
        if (modified >= newest) [outputName, newest] = [name, modified];
      }
    const output = new h.Input({
      source: new h.BlobSource(await h.mediaFile(outputName)),
      formats: h.ALL_FORMATS,
    });
    const raw = new h.Input({
      source: new h.BlobSource(await h.mediaFile(d.recording.mediaRef)),
      formats: h.ALL_FORMATS,
    });
    const cam = new h.Input({
      source: new h.BlobSource(await h.mediaFile(d.recording.camera!.mediaRef)),
      formats: h.ALL_FORMATS,
    });
    try {
      const v = (await output.getPrimaryVideoTrack())!;
      const edit = h.createEditMap(d.project);
      const results = [];
      // Inside the small camera segment (eased in) and after it (global corner style).
      for (const outputTime of [1.5, Math.min(4.2, h.seconds(edit.durationUs) - 0.3)]) {
        const encoded = (await new h.CanvasSink(v).getCanvas(outputTime))!;
        const logicalTime = Math.round(edit.toLogical(h.us(encoded.timestamp))),
          rawUs = h.logicalToRaw(d.recording, logicalTime);
        const src = new OffscreenCanvas(d.recording.width, d.recording.height),
          sctx = src.getContext('2d')!;
        for await (const frame of new h.VideoSampleSink(
          (await raw.getPrimaryVideoTrack())!,
        ).samples()) {
          if (frame.timestamp > h.seconds(rawUs)) {
            frame.close();
            break;
          }
          frame.draw(sctx, 0, 0, src.width, src.height);
          frame.close();
        }
        const face = new OffscreenCanvas(d.recording.camera!.width, d.recording.camera!.height),
          fctx = face.getContext('2d')!;
        const camSample = await new h.VideoSampleSink(
          (await cam.getPrimaryVideoTrack())!,
        ).getSample(Math.max(0, h.seconds(rawUs - d.recording.camera!.offsetUs)));
        camSample?.draw(fctx, 0, 0, face.width, face.height);
        camSample?.close();
        const size = h.outputSize(d.project, d.recording);
        const render = (webcam: boolean) => {
          const c = new OffscreenCanvas(size.width, size.height),
            ctx = c.getContext('2d')!;
          h.renderFrame(ctx, {
            source: src,
            sourceWidth: src.width,
            sourceHeight: src.height,
            cameras: h.motionSamples(
              h.createCamera(d.project, d.events),
              logicalTime,
              d.project.output.fps,
              d.project.effects.motionBlur,
            ),
            project: d.project,
            width: size.width,
            height: size.height,
            background: h.paintBackground(
              d.project.composition.background,
              size.width,
              size.height,
            ),
            overlays: h.createOverlays(d.events, d.project.composition.crop, d.recording.geometry),
            atUs: logicalTime,
            webcam: webcam ? { source: face, width: face.width, height: face.height } : null,
          });
          return ctx.getImageData(0, 0, size.width, size.height).data;
        };
        const actual = encoded.canvas
            .getContext('2d')!
            .getImageData(0, 0, size.width, size.height).data,
          withCam = render(true),
          withoutCam = render(false);
        const box = h.webcamLayout(d.project, logicalTime, size.width, size.height)!;
        const mae = (a: Uint8ClampedArray, b: Uint8ClampedArray, inBox: boolean) => {
          let diff = 0,
            n = 0;
          for (let y = 0; y < size.height; y++)
            for (let x = 0; x < size.width; x++) {
              const inside =
                x >= box.x + 4 &&
                x < box.x + box.width - 4 &&
                y >= box.y + 4 &&
                y < box.y + box.height - 4;
              if (inBox !== inside) continue;
              const i = (y * size.width + x) * 4;
              diff +=
                Math.abs(a[i]! - b[i]!) +
                Math.abs(a[i + 1]! - b[i + 1]!) +
                Math.abs(a[i + 2]! - b[i + 2]!);
              n++;
            }
          return diff / (n * 3);
        };
        results.push({
          outputTime,
          logicalTime,
          box,
          maeAll: (() => {
            let diff = 0;
            for (let i = 0; i < actual.length; i += 4)
              diff +=
                Math.abs(actual[i]! - withCam[i]!) +
                Math.abs(actual[i + 1]! - withCam[i + 1]!) +
                Math.abs(actual[i + 2]! - withCam[i + 2]!);
            return diff / ((actual.length / 4) * 3);
          })(),
          maeBox: mae(actual, withCam, true),
          boxVsNoCam: mae(actual, withoutCam, true),
        });
      }
      return {
        results,
        duration: await output.computeDuration(),
        expected: h.seconds(edit.durationUs),
      };
    } finally {
      output.dispose();
      raw.dispose();
      cam.dispose();
    }
  }, session.id);
  writeFileSync('test-results/devices-export.json', JSON.stringify(exported, null, 2));
  expect(Math.abs(exported.duration - exported.expected)).toBeLessThan(0.12);
  for (const r of exported.results) {
    expect(r.box.x).toBeLessThan(r.box.width); // Top-left corner.
    expect(r.maeAll).toBeLessThan(12);
    expect(r.maeBox).toBeLessThan(20);
    // The webcam visibly changed those pixels compared with a render without it.
    expect(r.boxVsNoCam).toBeGreaterThan(r.maeBox + 5);
  }
  expect(errors).toEqual([]);
});
test('3D stage: laptop frame, orbit and tilt moves, waves background, cursor pack, side-by-side webcam; export parity and WebGL fallback', async () => {
  if (!fakesInstalled) await context.addInitScript(fakeDevices);
  fakesInstalled = true;
  const { source, recorder, session } = await prepare('http://127.0.0.1:4178/stage', {
    ...NO_DEVICES,
    audio: false,
    camera: 'fake-cam',
  });
  // Screen or window only: the source picker is gone from the recorder.
  await expect(recorder.getByText('This tab', { exact: true })).toHaveCount(0);
  await expect(recorder.getByRole('radiogroup')).toHaveCount(0);
  await expect(recorder.getByLabel('Camera preview')).toBeVisible();
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(recorder.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await source.waitForTimeout(500);
  await source.locator('#target-a').click();
  await source.waitForTimeout(500);
  await source.locator('#target-a').click();
  await source.mouse.move(900, 300, { steps: 8 });
  await source.waitForTimeout(500);
  await source.locator('#target-b').click();
  await source.waitForTimeout(450);
  await source.locator('#target-b').click();
  await source.waitForTimeout(1600);
  await recorder.getByRole('button', { name: 'Stop & open editor', exact: true }).click();
  await recorder.waitForURL(`**/editor.html?project=${session.id}`);
  await expect(recorder.getByLabel('Project name')).toBeVisible();
  const errors: string[] = [];
  recorder.on('pageerror', (e) => errors.push(e.message));
  // A distinct name keeps later library scenarios unambiguous.
  await recorder.getByLabel('Project name').fill('3D stage fixture');
  // Style: 3D laptop, waves background, Glass cursor pack.
  await recorder.getByRole('button', { name: 'Style', exact: true }).click();
  await recorder.getByRole('button', { name: '3D', exact: true }).click();
  await recorder.getByRole('button', { name: 'Laptop', exact: true }).click();
  await recorder.getByRole('button', { name: 'Left', exact: true }).click();
  await pick(recorder, 'Background motion', 'Waves');
  await recorder.getByRole('switch', { name: 'Overlay cursor' }).click();
  await recorder.getByRole('button', { name: 'Glass', exact: true }).click();
  await expect(recorder.getByText('need WebGL2')).toHaveCount(0);
  await accessibility(recorder, 'editor-stage');
  // Zoom: default move Tilt for every zoom, then Orbit on the first.
  await recorder.getByRole('button', { name: 'Zoom', exact: true }).click();
  await recorder.getByRole('button', { name: 'Global', exact: true }).click();
  await recorder.getByRole('button', { name: 'Tilt', exact: true }).click();
  await recorder.getByRole('button', { name: 'Apply move to all zooms', exact: true }).click();
  await recorder
    .getByRole('button', { name: /^Zoom at/ })
    .first()
    .focus();
  await recorder.keyboard.press('Enter');
  await recorder.getByRole('button', { name: 'Orbit', exact: true }).click();
  await accessibility(recorder, 'editor-move');
  // Camera: a side-by-side camera segment from the start.
  await recorder.getByLabel('Playhead', { exact: true }).focus();
  await recorder.keyboard.press('Home');
  await recorder.getByRole('button', { name: 'Camera', exact: true }).click();
  await recorder.getByRole('button', { name: 'Side by side', exact: true }).click();
  await accessibility(recorder, 'editor-camera-layout');
  await recorder.getByRole('button', { name: 'Bubble', exact: true }).click();
  await recorder.getByRole('button', { name: 'Add camera segment', exact: true }).click();
  await pick(recorder, 'Camera layout', 'Side by side');
  await expect(
    recorder.getByRole('button', { name: /^Camera segment at .*side by side/ }),
  ).toHaveCount(1);
  await expect(recorder.locator('.save-status')).toHaveText('Saved');
  // Let the preview draw a stage frame mid-zoom.
  const saved = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    return (await h.loadProject(id)).project;
  }, session.id);
  expect(saved.stage).toMatchObject({ mode: '3d', device: 'laptop', tilt: { yaw: 14, pitch: -6 } });
  expect(saved.composition.backgroundMotion.kind).toBe('waves');
  expect(saved.cursor.overlay.pack).toBe('glass');
  expect(saved.zooms[0]!.move?.kind).toBe('orbit');
  expect(saved.zooms.slice(1).every((z) => z.move?.kind === 'tilt')).toBe(true);
  const mid = (saved.zooms[0]!.startUs + saved.zooms[0]!.endUs) / 2;
  await recorder.evaluate((t) => {
    const v = document.querySelector('video')!;
    v.currentTime = t / 1_000_000;
  }, mid);
  await recorder.waitForTimeout(600);
  await recorder.screenshot({ path: 'test-results/editor-3d.png' });
  // Export and compare two frames with the shared renderer through the same WebGL stage.
  await recorder.getByRole('button', { name: 'Export video', exact: true }).click();
  await recorder.getByRole('button', { name: '720p', exact: true }).click();
  await recorder.getByRole('button', { name: '30 fps', exact: true }).click();
  await expect(recorder.locator('.export-summary')).toContainText('3D');
  const started = Date.now();
  await recorder.getByRole('button', { name: 'Start export', exact: true }).click();
  await expect(recorder.getByRole('link', { name: 'Download MP4' })).toBeVisible({
    timeout: 120000,
  });
  const exportMs = Date.now() - started;
  const compare = async (stageWanted: boolean) =>
    recorder.evaluate(
      async ({ id, stageWanted }) => {
        const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness,
          d = await h.loadProject(id);
        const root = await navigator.storage.getDirectory();
        let outputName = '',
          newest = 0;
        for await (const [name, handle] of root as unknown as AsyncIterable<
          [string, FileSystemFileHandle]
        >)
          if (name.startsWith('export-')) {
            const modified = (await handle.getFile()).lastModified;
            if (modified >= newest) [outputName, newest] = [name, modified];
          }
        const output = new h.Input({
          source: new h.BlobSource(await h.mediaFile(outputName)),
          formats: h.ALL_FORMATS,
        });
        const raw = new h.Input({
          source: new h.BlobSource(await h.mediaFile(d.recording.mediaRef)),
          formats: h.ALL_FORMATS,
        });
        const cam = new h.Input({
          source: new h.BlobSource(await h.mediaFile(d.recording.camera!.mediaRef)),
          formats: h.ALL_FORMATS,
        });
        const stage = stageWanted ? h.createStage() : null;
        try {
          const v = (await output.getPrimaryVideoTrack())!,
            edit = h.createEditMap(d.project),
            size = h.outputSize(d.project, d.recording),
            camera = h.createCamera(d.project, d.events),
            overlays = h.createOverlays(d.events, d.project.composition.crop, d.recording.geometry),
            background = h.paintBackground(
              d.project.composition.background,
              size.width,
              size.height,
            );
          const z = d.project.zooms[0]!;
          const results = [];
          for (const logicalWanted of [(z.startUs + z.endUs) / 2, z.startUs + 250_000]) {
            const encoded = (await new h.CanvasSink(v).getCanvas(
              h.seconds(edit.toOutput(logicalWanted)),
            ))!;
            const logicalTime = Math.round(edit.toLogical(h.us(encoded.timestamp))),
              rawUs = h.logicalToRaw(d.recording, logicalTime);
            const src = new OffscreenCanvas(d.recording.width, d.recording.height),
              sctx = src.getContext('2d')!;
            for await (const frame of new h.VideoSampleSink(
              (await raw.getPrimaryVideoTrack())!,
            ).samples()) {
              if (frame.timestamp > h.seconds(rawUs)) {
                frame.close();
                break;
              }
              frame.draw(sctx, 0, 0, src.width, src.height);
              frame.close();
            }
            const face = new OffscreenCanvas(d.recording.camera!.width, d.recording.camera!.height);
            const sample = await new h.VideoSampleSink(
              (await cam.getPrimaryVideoTrack())!,
            ).getSample(Math.max(0, h.seconds(rawUs - d.recording.camera!.offsetUs)));
            sample?.draw(face.getContext('2d')!, 0, 0, face.width, face.height);
            sample?.close();
            const expected = new OffscreenCanvas(size.width, size.height),
              ctx = expected.getContext('2d')!;
            h.renderFrame(ctx, {
              source: src,
              sourceWidth: src.width,
              sourceHeight: src.height,
              cameras: h.motionSamples(
                camera,
                logicalTime,
                d.project.output.fps,
                d.project.effects.motionBlur,
              ),
              project: d.project,
              width: size.width,
              height: size.height,
              background,
              overlays,
              atUs: logicalTime,
              webcam: { source: face, width: face.width, height: face.height },
              hasWebcam: true,
              stage,
            });
            const a = encoded.canvas
                .getContext('2d')!
                .getImageData(0, 0, size.width, size.height).data,
              b = ctx.getImageData(0, 0, size.width, size.height).data;
            let diff = 0;
            for (let i = 0; i < a.length; i += 4)
              diff +=
                Math.abs(a[i]! - b[i]!) +
                Math.abs(a[i + 1]! - b[i + 1]!) +
                Math.abs(a[i + 2]! - b[i + 2]!);
            // The exported frame itself (CanvasSink yields a DOM canvas here).
            const png = stageWanted
              ? (encoded.canvas as HTMLCanvasElement).toDataURL('image/png')
              : '';
            results.push({
              logicalTime,
              pose: camera.at(logicalTime),
              mae: diff / ((a.length / 4) * 3),
              png,
            });
          }
          return {
            results,
            duration: await output.computeDuration(),
            expected: h.seconds(edit.durationUs),
            size,
          };
        } finally {
          stage?.gl.dispose();
          output.dispose();
          raw.dispose();
          cam.dispose();
        }
      },
      { id: session.id, stageWanted },
    );
  const staged = await compare(true),
    flat = await compare(false);
  staged.results.forEach((r, i) =>
    writeFileSync(
      `test-results/stage-export-frame-${i}.png`,
      Buffer.from(r.png.split(',')[1]!, 'base64'),
    ),
  );
  const strip = (x: typeof staged) => ({
    ...x,
    results: x.results.map(({ png: _png, ...r }) => r),
  });
  writeFileSync(
    'test-results/stage-export.json',
    JSON.stringify({ exportMs, staged: strip(staged), flat: strip(flat) }, null, 2),
  );
  expect(Math.abs(staged.duration - staged.expected)).toBeLessThan(0.12);
  for (const r of staged.results) expect(r.mae).toBeLessThan(12);
  // The flat renderer does not explain the export: the WebGL stage really drew it.
  flat.results.forEach((r, i) => expect(r.mae).toBeGreaterThan(staged.results[i]!.mae + 10));
  expect(Math.abs(staged.results[0]!.pose.yaw)).toBeGreaterThan(1);
  await recorder.getByRole('button', { name: 'Close export', exact: true }).click();
  // Without WebGL2 the preview shows a notice and export still completes (flat).
  await recorder.addInitScript(() => {
    const get = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (
      this: OffscreenCanvas,
      type: string,
      options?: unknown,
    ) {
      return type === 'webgl2' ? null : get.call(this, type as '2d', options as never);
    } as typeof OffscreenCanvas.prototype.getContext;
  });
  await recorder.reload();
  await expect(recorder.getByLabel('Project name')).toBeVisible();
  await recorder.getByRole('button', { name: 'Style', exact: true }).click();
  await expect(recorder.getByText(/need WebGL2/)).toBeVisible();
  await recorder.evaluate(() => {
    const Original = globalThis.Worker;
    globalThis.Worker = class extends Original {
      constructor(_url: string | URL, options?: WorkerOptions) {
        super(chrome.runtime.getURL('test-no-webgl-worker.js'), options);
      }
    };
  });
  await recorder.getByRole('button', { name: 'Export video', exact: true }).click();
  await recorder.getByRole('button', { name: 'Start export', exact: true }).click();
  await expect(recorder.getByRole('link', { name: 'Download MP4' })).toBeVisible({
    timeout: 120000,
  });
  await recorder.screenshot({ path: 'test-results/editor-no-webgl.png' });
  expect(errors).toEqual([]);
});
test('quick wins: smart trim, click sounds, vertical fill, presets and GIF export', async () => {
  const { source, recorder, session } = await prepare('http://127.0.0.1:4178/quick');
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(recorder.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await source.waitForTimeout(500);
  await source.locator('#target-a').click();
  await source.waitForTimeout(500);
  await source.locator('#target-a').click();
  // A still, silent stretch with no input (smart trim should cut it).
  await source.waitForTimeout(4200);
  await source.locator('#typing').click();
  await source.locator('#typing').pressSequentially('smart trim typing test', { delay: 130 });
  await source.waitForTimeout(800);
  await recorder.getByRole('button', { name: 'Stop & open editor', exact: true }).click();
  await recorder.waitForURL(`**/editor.html?project=${session.id}`);
  await expect(recorder.getByLabel('Project name')).toBeVisible();
  await recorder.getByLabel('Project name').fill('Quick wins fixture');
  const errors: string[] = [];
  recorder.on('pageerror', (e) => errors.push(e.message));
  // Style: vertical fill and sounds.
  await recorder.getByRole('button', { name: 'Style', exact: true }).click();
  await pick(recorder, 'Aspect ratio', 'Vertical 9:16');
  await recorder.getByRole('button', { name: 'Fill and follow', exact: true }).click();
  await recorder.getByRole('switch', { name: 'Click sounds' }).click();
  await recorder.getByRole('switch', { name: 'Keyboard sounds' }).click();
  // Presets: save this look and make it the default for new recordings.
  await recorder.getByLabel('New preset name').fill('Vertical demo');
  await recorder.getByRole('button', { name: 'Save current style', exact: true }).click();
  await expect(recorder.getByLabel('Style preset')).toBeVisible();
  await recorder.getByRole('switch', { name: 'Use for new recordings' }).click();
  await accessibility(recorder, 'editor-quick-style');
  // Smart trim.
  await recorder.getByRole('button', { name: 'Smart trim', exact: true }).first().click();
  await recorder.getByRole('button', { name: 'Analyse recording', exact: true }).click();
  const apply = recorder.getByRole('button', { name: /^Apply \d+ · saves/ });
  await expect(apply).toBeVisible({ timeout: 60000 });
  await recorder.screenshot({ path: 'test-results/smart-trim.png' });
  await accessibility(recorder, 'smart-trim');
  await apply.click();
  await expect(recorder.locator('[data-sonner-toast]').first()).toContainText('Smart trim applied');
  await expect(recorder.locator('.save-status')).toHaveText('Saved');
  const trimmed = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    const d = await h.loadProject(id);
    return {
      project: d.project,
      recording: d.recording,
      outputUs: h.createEditMap(d.project).durationUs,
      cues: h.soundCues(d.project, d.events, h.createEditMap(d.project)),
    };
  }, session.id);
  writeFileSync('test-results/quick-trim.json', JSON.stringify(trimmed, null, 2));
  // The longest cut is the deliberate still, silent gap (the quiet lead-in may be cut too).
  const cut = trimmed.project.segments
    .filter((s) => s.kind === 'cut')
    .sort((a, b) => b.endUs - b.startUs - (a.endUs - a.startUs))[0];
  const typing = trimmed.project.segments.find((s) => s.kind === 'speed' && s.speed === 2);
  expect(cut).toBeTruthy();
  expect(cut!.endUs - cut!.startUs).toBeGreaterThan(2_500_000);
  expect(typing).toBeTruthy();
  expect(trimmed.outputUs).toBeLessThan(trimmed.recording.durationUs - 3_000_000);
  // Two clicks on the target plus the click into the text field.
  expect(trimmed.cues.filter((c) => c.kind === 'click')).toHaveLength(3);
  expect(trimmed.cues.filter((c) => c.kind === 'key').length).toBeGreaterThan(5);
  // MP4: 9:16 fill matches the renderer and the click sounds are in the audio.
  await recorder.getByRole('button', { name: 'Export video', exact: true }).click();
  await recorder.getByRole('button', { name: '720p', exact: true }).click();
  await recorder.getByRole('button', { name: '30 fps', exact: true }).click();
  await recorder.getByRole('button', { name: 'Start export', exact: true }).click();
  await expect(recorder.getByRole('link', { name: 'Download MP4' })).toBeVisible({
    timeout: 120000,
  });
  const mp4 = await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness,
      d = await h.loadProject(id);
    const root = await navigator.storage.getDirectory();
    let name = '',
      newest = 0;
    for await (const [n, handle] of root as unknown as AsyncIterable<
      [string, FileSystemFileHandle]
    >)
      if (n.startsWith('export-') && n.endsWith('.mp4')) {
        const t = (await handle.getFile()).lastModified;
        if (t >= newest) [name, newest] = [n, t];
      }
    const output = new h.Input({
      source: new h.BlobSource(await h.mediaFile(name)),
      formats: h.ALL_FORMATS,
    });
    const raw = new h.Input({
      source: new h.BlobSource(await h.mediaFile(d.recording.mediaRef)),
      formats: h.ALL_FORMATS,
    });
    try {
      const v = (await output.getPrimaryVideoTrack())!,
        a = (await output.getPrimaryAudioTrack())!;
      const edit = h.createEditMap(d.project),
        cues = h.soundCues(d.project, d.events, edit);
      // Audio energy right after the first click cue vs a quiet stretch before it.
      const sink = new h.AudioSampleSink(a);
      const energy = async (fromS: number, toS: number) => {
        let sum = 0,
          n = 0;
        for await (const s of sink.samples(fromS, toS)) {
          const b = s.toAudioBuffer().getChannelData(0);
          const start = Math.max(0, Math.floor((fromS - s.timestamp) * s.sampleRate)),
            end = Math.min(b.length, Math.ceil((toS - s.timestamp) * s.sampleRate));
          for (let i = start; i < end; i++) sum += b[i]! * b[i]!;
          n += Math.max(0, end - start);
          s.close();
        }
        return Math.sqrt(sum / Math.max(1, n));
      };
      const click = h.seconds(cues.find((c) => c.kind === 'click')!.atUs);
      const atClick = await energy(click, click + 0.04),
        before = await energy(Math.max(0, click - 0.35), click - 0.15);
      // A frame inside the first zoom, compared with the renderer (fill extents).
      const sampleOut = 0.9;
      const encoded = (await new h.CanvasSink(v).getCanvas(sampleOut))!;
      const logical = Math.round(edit.toLogical(h.us(encoded.timestamp))),
        rawUs = h.logicalToRaw(d.recording, logical);
      const src = new OffscreenCanvas(d.recording.width, d.recording.height),
        sctx = src.getContext('2d')!;
      for await (const f of new h.VideoSampleSink((await raw.getPrimaryVideoTrack())!).samples()) {
        if (f.timestamp > h.seconds(rawUs)) {
          f.close();
          break;
        }
        f.draw(sctx, 0, 0, src.width, src.height);
        f.close();
      }
      const size = h.outputSize(d.project, d.recording),
        expected = new OffscreenCanvas(size.width, size.height),
        ctx = expected.getContext('2d')!,
        extents = h.viewExtents(d.project, d.recording.width, d.recording.height);
      h.renderFrame(ctx, {
        source: src,
        sourceWidth: src.width,
        sourceHeight: src.height,
        cameras: h.motionSamples(
          h.createCamera(d.project, d.events, undefined, extents),
          logical,
          d.project.output.fps,
          d.project.effects.motionBlur,
        ),
        project: d.project,
        width: size.width,
        height: size.height,
        background: h.paintBackground(d.project.composition.background, size.width, size.height),
        overlays: h.createOverlays(d.events, d.project.composition.crop, d.recording.geometry),
        atUs: logical,
      });
      const p = encoded.canvas.getContext('2d')!.getImageData(0, 0, size.width, size.height).data,
        q = ctx.getImageData(0, 0, size.width, size.height).data;
      let diff = 0;
      for (let i = 0; i < p.length; i += 4)
        diff +=
          Math.abs(p[i]! - q[i]!) +
          Math.abs(p[i + 1]! - q[i + 1]!) +
          Math.abs(p[i + 2]! - q[i + 2]!);
      // Fill: no background bars at the left/right edges (the frame covers the output).
      const edgeBackground = q[(Math.round(size.height / 2) * size.width + 1) * 4]!;
      return {
        width: v.displayWidth,
        height: v.displayHeight,
        duration: await output.computeDuration(),
        expected: h.seconds(edit.durationUs),
        atClick,
        before,
        mae: diff / ((p.length / 4) * 3),
        extents,
        edgeBackground,
      };
    } finally {
      output.dispose();
      raw.dispose();
    }
  }, session.id);
  writeFileSync('test-results/quick-mp4.json', JSON.stringify(mp4, null, 2));
  expect(mp4.width).toBe(720);
  expect(mp4.height).toBe(1280);
  expect(mp4.extents.fx).toBeLessThan(1);
  expect(Math.abs(mp4.duration - mp4.expected)).toBeLessThan(0.12);
  expect(mp4.mae).toBeLessThan(12);
  expect(mp4.atClick).toBeGreaterThan(0.02);
  expect(mp4.atClick).toBeGreaterThan(mp4.before * 4);
  // GIF.
  await recorder.getByRole('button', { name: 'GIF', exact: true }).click();
  // Real theme switch (the provider follows the stored choice), so toasts follow too.
  await recorder.evaluate(() => chrome.storage.local.set({ theme: 'dark' }));
  await expect(recorder.locator('html')).toHaveClass(/dark/);
  await recorder.waitForTimeout(500);
  await recorder.screenshot({ path: 'test-results/export-dialog-dark.png' });
  await accessibility(recorder, 'export-dialog-dark');
  await recorder.evaluate(() => chrome.storage.local.set({ theme: 'light' }));
  await expect(recorder.locator('html')).not.toHaveClass(/dark/);
  await recorder.getByRole('button', { name: '480 px', exact: true }).click();
  await recorder.getByRole('button', { name: '10 fps', exact: true }).click();
  await recorder.getByRole('button', { name: 'Export again', exact: true }).click();
  await expect(recorder.getByRole('link', { name: 'Download GIF' })).toBeVisible({
    timeout: 120000,
  });
  const gif = await recorder.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let file: File | undefined;
    for await (const [n, handle] of root as unknown as AsyncIterable<
      [string, FileSystemFileHandle]
    >)
      if (n.startsWith('export-') && n.endsWith('.gif')) file = await handle.getFile();
    const bytes = new Uint8Array(await file!.arrayBuffer());
    let frames = 0;
    for (let i = 0; i + 2 < bytes.length; i++)
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
    return {
      header: String.fromCharCode(...bytes.slice(0, 6)),
      width: bytes[6]! | (bytes[7]! << 8),
      height: bytes[8]! | (bytes[9]! << 8),
      frames,
      size: bytes.length,
    };
  });
  writeFileSync('test-results/quick-gif.json', JSON.stringify(gif, null, 2));
  expect(gif.header).toBe('GIF89a');
  expect(gif.width).toBe(480);
  expect(gif.height).toBe(854);
  expect(Math.abs(gif.frames - Math.ceil(mp4.expected * 10))).toBeLessThanOrEqual(1);
  await recorder.getByRole('button', { name: 'Close export', exact: true }).click();
  // Menubar: keyboard opens File, Insert adds a text segment, Edit undoes it.
  const menubar = recorder.getByRole('menubar', { name: 'Editor menu' });
  await menubar.getByRole('menuitem', { name: 'File', exact: true }).focus();
  await recorder.keyboard.press('Enter');
  await expect(recorder.getByRole('menuitem', { name: /Export GIF/ })).toBeVisible();
  await accessibility(recorder, 'editor-menubar');
  await recorder.keyboard.press('Escape');
  const textCount = await recorder.getByRole('button', { name: /^Text segment at/ }).count();
  await menubar.getByRole('menuitem', { name: 'Insert', exact: true }).click();
  await recorder.getByRole('menuitem', { name: 'Text', exact: true }).click();
  await expect(recorder.getByRole('button', { name: /^Text segment at/ })).toHaveCount(
    textCount + 1,
  );
  await menubar.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await recorder.getByRole('menuitem', { name: /^Undo/ }).click();
  await expect(recorder.getByRole('button', { name: /^Text segment at/ })).toHaveCount(textCount);
  // Font candidates: one screenshot each, light and dark, so the user can choose.
  for (const [id, label] of [
    ['fredoka', 'Fredoka + Nunito'],
    ['nunito', 'Nunito'],
    ['baloo', 'Baloo 2 + Nunito Sans'],
    ['quicksand', 'Quicksand + Nunito Sans'],
    ['lexend', 'Lexend'],
    ['system', 'System (Segoe UI)'],
  ] as const) {
    await menubar.getByRole('menuitem', { name: 'View', exact: true }).click();
    await recorder.getByRole('menuitem', { name: 'Font', exact: true }).click();
    await recorder.getByRole('menuitemradio', { name: label, exact: true }).click();
    // Radio items keep the menu open: close the submenu, then the menu.
    await recorder.keyboard.press('Escape');
    await recorder.keyboard.press('Escape');
    await expect(recorder.locator('html')).toHaveAttribute('data-font', id);
    await recorder.waitForTimeout(250);
    await recorder.screenshot({ path: `test-results/font-${id}.png` });
  }
  await menubar.getByRole('menuitem', { name: 'View', exact: true }).click();
  await recorder.getByRole('menuitem', { name: 'Font', exact: true }).click();
  await recorder.getByRole('menuitemradio', { name: 'Fredoka + Nunito', exact: true }).click();
  await recorder.keyboard.press('Escape');
  await recorder.keyboard.press('Escape');
  // The default preset shapes the next recording.
  const second = await prepare('http://127.0.0.1:4178/quick-two', NO_DEVICES, {
    keepPresets: true,
  });
  await second.recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(
    second.recorder.getByRole('button', { name: 'Pause recording', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await second.source.waitForTimeout(1200);
  await second.recorder.getByRole('button', { name: 'Stop & open editor', exact: true }).click();
  await second.recorder.waitForURL(`**/editor.html?project=${second.session.id}`);
  const styled = await second.recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    return (await h.loadProject(id)).project;
  }, second.session.id);
  expect(styled.composition).toMatchObject({ aspect: '9:16', fit: 'fill' });
  expect(styled.effects.sounds.clicks).toBe(true);
  expect(errors).toEqual([]);
  await second.recorder.close();
  await second.source.close();
  await source.close();
});
test('Esc cancels the countdown, releases the capture, and recording can start again', async () => {
  const { source, recorder, session } = await prepare('http://127.0.0.1:4178/countdown', {
    ...NO_DEVICES,
    countdown: 3,
  });
  const start = recorder.getByRole('button', { name: 'Start recording', exact: true });
  await start.click();
  await expect(source.locator('#lensprout-countdown')).toHaveCount(1, { timeout: 8000 });
  await source.keyboard.press('Escape');
  await expect(source.locator('#lensprout-countdown')).toHaveCount(0);
  await expect(start).toBeEnabled();
  const after = await background.evaluate(async () => ({
    session: (await chrome.storage.session.get('session')).session as { mode?: string },
    captured: (await chrome.tabCapture.getCapturedTabs()).filter((t) => t.status === 'active'),
    badge: await chrome.action.getBadgeText({}),
  }));
  expect(after.session).toMatchObject({ id: session.id, status: 'ready' });
  expect(after.session.mode).toBeUndefined();
  expect(after.captured).toEqual([]);
  expect(after.badge).toBe('');
  await expect(recorder.getByRole('alert')).toHaveCount(0);
  // The released session captures again; this time the countdown runs out and recording starts.
  await start.click();
  await expect(recorder.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await source.locator('#target-a').click();
  await source.waitForTimeout(800);
  await recorder.getByRole('button', { name: 'Stop & open editor', exact: true }).click();
  await recorder.waitForURL(`**/editor.html?project=${session.id}`);
  await expect(recorder.getByLabel('Project name')).toBeVisible();
});
test('closing source finalizes media, stale messages fail, and interrupted rows are removable', async () => {
  const { source, recorder, session } = await prepare('http://127.0.0.1:4178/closure');
  await recorder.getByRole('switch', { name: 'Include tab audio' }).click();
  await expect(recorder.getByRole('switch', { name: 'Include tab audio' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(
    recorder.getByRole('button', { name: 'Pause recording', exact: true }),
  ).toBeVisible();
  await source.waitForTimeout(1800);
  await source.close();
  await recorder.waitForURL(`**/editor.html?project=${session.id}`);
  const stale = await recorder.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'capture', sessionId: 'stale', audio: false }),
  );
  expect(stale.ok).toBe(false);
  await recorder.evaluate(async () => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    await h.saveRecording({
      id: 'incomplete-fixture',
      schemaVersion: 2,
      name: 'Interrupted fixture',
      createdAt: new Date().toISOString(),
      durationUs: 0,
      rawDurationUs: 0,
      pauses: [],
      width: 1280,
      height: 800,
      mediaRef: 'incomplete-fixture.webm',
      mimeType: 'video/webm',
      hasAudio: false,
      status: 'incomplete',
      geometry: [],
      source: 'tab',
    });
  });
  await recorder.goto(`chrome-extension://${extensionId}/editor.html`);
  await expect(recorder.getByText('Interrupted recording')).toBeVisible();
  await recorder.waitForTimeout(800);
  await recorder.screenshot({ path: 'test-results/library.png' });
  await accessibility(recorder, 'library-light');
  // Dark library: cards and toggles keep AA contrast.
  await recorder.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await recorder.keyboard.press('Escape');
  await recorder.waitForTimeout(500);
  await recorder.screenshot({ path: 'test-results/library-dark.png' });
  await accessibility(recorder, 'library-dark');
  await recorder.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await recorder.keyboard.press('Escape');
  // Search, sort and rename from the card menu.
  await recorder.getByLabel('Search recordings').fill('interrupted');
  await expect(recorder.getByRole('heading', { level: 2 })).toHaveCount(1);
  await recorder.getByLabel('Search recordings').fill('');
  await pick(recorder, 'Sort recordings', 'Name');
  const ready = recorder
    .getByRole('heading', { level: 2 })
    .filter({ hasNotText: 'Interrupted fixture' })
    .first();
  const readyName = await ready.innerText();
  await recorder.getByRole('button', { name: `Actions for ${readyName}` }).click();
  await recorder.getByRole('menuitem', { name: 'Rename' }).click();
  await recorder.getByLabel('Project name').fill('Renamed in library');
  await recorder.getByLabel('Project name').press('Enter');
  await expect(recorder.getByRole('heading', { name: 'Renamed in library' })).toBeVisible();
  // Delete through the card menu and the confirmation dialog.
  await recorder.getByRole('button', { name: 'Actions for Interrupted fixture' }).click();
  await recorder.getByRole('menuitem', { name: 'Delete Interrupted fixture' }).click();
  await recorder.getByRole('button', { name: 'Delete recording', exact: true }).click();
  await expect(
    recorder.getByRole('heading', { name: 'Interrupted fixture', exact: true }),
  ).toHaveCount(0);
});
test('save failure/retry, concurrent edits, unavailable codecs, and temporary file cleanup', async () => {
  const { source, recorder, session } = await prepare('http://127.0.0.1:4178/failures');
  await context.setOffline(true);
  await source.getByRole('button', { name: 'Start test tone' }).click();
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(
    recorder.getByRole('button', { name: 'Pause recording', exact: true }),
  ).toBeVisible();
  await source.waitForTimeout(1500);
  // The toolbar action sends this control while recording (see background open()).
  await background.evaluate(async () => {
    const s = (await chrome.storage.session.get('session')).session as {
      id: string;
      recorderTabId: number;
      status: string;
    };
    if (s.status !== 'recording') throw new Error(`Unexpected status ${s.status}`);
    await chrome.tabs.sendMessage(s.recorderTabId, {
      type: 'control',
      sessionId: s.id,
      command: 'stop',
    });
  });
  await recorder.waitForURL(`**/editor.html?project=${session.id}`);
  await expect(recorder.getByLabel('Project name')).toBeVisible();
  await recorder.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'projects')
        throw new DOMException('Synthetic full disk', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  await recorder.getByLabel('Project name').fill('Retain this unsaved edit');
  await expect(recorder.locator('.save-status')).toHaveText('Save failed');
  await expect(recorder.getByRole('alert')).toContainText('Synthetic full disk');
  await expect(recorder.getByLabel('Project name')).toHaveValue('Retain this unsaved edit');
  await recorder.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await recorder.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(recorder.locator('.save-status')).toHaveText('Saved');
  // An external revision must not be silently overwritten by this tab.
  await recorder.evaluate(async (id) => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    const d = await h.loadProject(id);
    await h.saveProject(
      { ...d.project, name: 'External revision', revision: d.project.revision + 1 },
      d.project.revision,
    );
  }, session.id);
  await recorder.getByLabel('Project name').fill('Conflicting local revision');
  await expect(recorder.locator('.save-status')).toHaveText('Save failed');
  await expect(recorder.getByRole('alert')).toContainText('another editor');
  recorder.once('dialog', (d) => d.accept());
  await recorder.reload();
  await expect(recorder.getByLabel('Project name')).toHaveValue('External revision');
  for (const [file, codec] of [
    ['test-no-aac-worker.js', 'AAC'],
    ['test-no-avc-worker.js', 'H.264'],
  ]) {
    await recorder.evaluate((file) => {
      const Original = globalThis.Worker;
      (window as unknown as { restoreWorker: () => void }).restoreWorker = () => {
        globalThis.Worker = Original;
      };
      globalThis.Worker = class extends Original {
        constructor(_url: string | URL, options?: WorkerOptions) {
          super(chrome.runtime.getURL(file), options);
        }
      };
    }, file!);
    await recorder.getByRole('button', { name: 'Export video', exact: true }).click();
    await recorder.getByRole('button', { name: 'Start export', exact: true }).click();
    await expect(recorder.getByRole('alert')).toContainText(codec!);
    await expect(recorder.getByRole('button', { name: 'Start export', exact: true })).toBeEnabled();
    await expect(recorder.getByRole('link', { name: 'Download MP4' })).toHaveCount(0);
    await recorder.getByRole('button', { name: 'Close export', exact: true }).click();
    await recorder.evaluate(() =>
      (window as unknown as { restoreWorker: () => void }).restoreWorker(),
    );
  }
  await recorder.evaluate(async () => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    const writer = await h.mediaWriter('export-00000000-0000-0000-0000-000000000000.mp4');
    await writer.write(new Uint8Array([1, 2, 3]));
    await writer.close();
  });
  await recorder.goto(`chrome-extension://${extensionId}/editor.html`);
  await recorder.getByRole('button', { name: 'Clear temporary exports', exact: true }).click();
  await recorder.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(recorder.locator('[data-sonner-toast]')).toContainText('temporary exports removed');
  const remaining = await recorder.evaluate(async () => {
    const h = (await import(chrome.runtime.getURL('/test-harness.js'))) as typeof Harness;
    return (await h.listRecordings()).length;
  });
  expect(remaining).toBeGreaterThan(0);
  await source.close();
  await context.setOffline(false);
});
test('failed media writer releases the source capture and controller session', async () => {
  const { source, recorder } = await prepare('http://127.0.0.1:4178/storage-failure');
  await recorder.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = async () => {
      throw new DOMException('Synthetic media write denial', 'NotAllowedError');
    };
  });
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(recorder.getByRole('alert')).toContainText('Synthetic media write denial');
  const s = await background.evaluate(async () => ({
    session: (await chrome.storage.session.get('session')).session,
    captured: await chrome.tabCapture.getCapturedTabs(),
  }));
  expect(s.session).toBeUndefined();
  expect(s.captured.filter((t) => t.status === 'active')).toHaveLength(0);
  await source.close();
});

test('theme toggle switches, persists across reloads, and works with reduced motion', async () => {
  const page = await context.newPage();
  await background.evaluate(() => chrome.storage.local.set({ theme: 'light' }));
  await page.goto(`chrome-extension://${extensionId}/editor.html`);
  const html = page.locator('html');
  const theme = () =>
    background.evaluate(async () => (await chrome.storage.local.get('theme')).theme);
  await expect(html).not.toHaveClass(/dark/);
  // Animated path (View Transitions): the class flips and the choice is stored.
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(html).toHaveClass(/dark/);
  await expect.poll(theme).toBe('dark');
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await expect(
    page.getByRole('button', { name: 'Switch to light theme', exact: true }),
  ).toBeVisible();
  // Reduced motion skips the reveal but still switches.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect.poll(theme).toBe('light');
  await page.close();
});
