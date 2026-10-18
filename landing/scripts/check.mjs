// Verifies the built site (run `npm run build` first). Serves dist/ with `astro preview`, then:
//  1. pages × light/dark × 1440/360 px: full-page screenshot, axe (WCAG 2.0–2.2 A/AA + best
//     practice), horizontal overflow, console errors;
//  2. home sections: per-section screenshots for visual review;
//  3. static SEO checks on every built HTML file, internal links, sitemap and RSS;
//  4. motion: nothing runs under reduced motion; mascot sways, gets watered and jumps when poked;
//  5. theme toggle persistence and FAQ keyboard disclosure.
// Usage: npm run build && npm run check [-- <output dir>]   (default: ./screenshots)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const outDir = resolve(process.argv[2] ?? 'screenshots');
mkdirSync(join(outDir, 'sections'), { recursive: true });
const PORT = 5181;
const ORIGIN = `http://localhost:${PORT}`;
const DIST = resolve('dist');
const SITE_URL = /SITE_URL = '([^']+)'/.exec(readFileSync('src/site.ts', 'utf8'))[1];

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'blog', path: '/blog/' },
  { name: 'post-comparison', path: '/blog/lensprout-vs-cursorful/' },
  { name: 'post-guide', path: '/blog/record-screen-chrome-automatic-zoom/' },
  { name: '404', path: '/does-not-exist/', expect404: true },
];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 360, height: 780 } };

const server = spawn('npx', ['astro', 'preview', '--force', '--port', String(PORT)], {
  shell: true,
  stdio: 'ignore',
});
const stop = () => {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/t', '/f']);
  else server.kill();
};
async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(ORIGIN + '/')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

/** Scrolls through the page so every reveal fires, then back to the top. */
async function revealAll(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
}

const results = { pages: [], sections: [], seo: [], links: {}, feeds: {}, motion: {}, interaction: {} };
const failures = [];
const fail = (msg) => failures.push(msg);

try {
  await waitForServer();
  const browser = await chromium.launch();

  // 1. Pages.
  for (const pg of PAGES) {
    for (const scheme of ['light', 'dark']) {
      for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
        const context = await browser.newContext({ viewport, colorScheme: scheme });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          if (pg.expect404 && /404/.test(m.text())) return;
          errors.push(m.text());
        });
        await page.goto(ORIGIN + pg.path, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await revealAll(page);
        await page.$$eval('details', (ds) => ds.forEach((d) => (d.open = true)));
        const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
          .analyze();
        const file = `${pg.name}-${scheme}-${vp}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: true, animations: 'disabled' });
        const r = {
          page: pg.path,
          scheme,
          viewport: `${viewport.width}x${viewport.height}`,
          darkClass: isDark,
          horizontalOverflowPx: overflow,
          axeViolations: axe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target.join(' ')),
          })),
          consoleErrors: errors,
          screenshot: file,
        };
        results.pages.push(r);
        const tag = `${pg.path} ${scheme} ${vp}`;
        if (isDark !== (scheme === 'dark')) fail(`${tag}: theme class wrong`);
        if (overflow > 0) fail(`${tag}: horizontal overflow ${overflow}px`);
        if (axe.violations.length) fail(`${tag}: ${axe.violations.length} axe violation(s)`);
        if (errors.length) fail(`${tag}: console errors ${errors.join(' | ')}`);
        console.log(
          `${tag.padEnd(52)} overflow=${overflow}px axe=${axe.violations.length} errors=${errors.length}`,
        );
        for (const v of r.axeViolations) console.log(`   axe ${v.id} (${v.impact}): ${v.nodes.join(', ')}`);
        await context.close();
      }
    }
  }

  // 2. Home sections for visual review.
  for (const [scheme, vp] of [
    ['light', 'desktop'],
    ['dark', 'desktop'],
    ['light', 'mobile'],
  ]) {
    const context = await browser.newContext({ viewport: VIEWPORTS[vp], colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
    await revealAll(page);
    for (const id of ['top', 'features', 'how', 'pricing', 'privacy', 'faq', 'get']) {
      const el = page.locator(`#${id}`);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      const file = `sections/${id}-${scheme}-${vp}.png`;
      await el.screenshot({ path: join(outDir, file) });
      results.sections.push(file);
    }
    await context.close();
  }

  // 3. Static SEO checks, links, feeds.
  const htmlFiles = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.html')) htmlFiles.push(p);
    }
  };
  walk(DIST);
  const broken = new Set();
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    const rel = file.slice(DIST.length).replace(/\\/g, '/');
    // The demo dashboard is unlisted recording material, not a site page.
    if (rel.startsWith('/demo/') || rel.startsWith('/editor/')) continue;
    const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
    const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? '';
    let jsonLdOk = true;
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        JSON.parse(m[1]);
      } catch {
        jsonLdOk = false;
      }
    }
    const descLen = desc.replace(/&#39;|&amp;|&quot;/g, 'x').length;
    const row = { file: rel, h1, titleLength: title.length, descriptionLength: descLen, canonical, jsonLdOk };
    results.seo.push(row);
    if (h1 !== 1) fail(`${rel}: ${h1} h1 elements`);
    if (!title) fail(`${rel}: no title`);
    if (descLen < 50 || descLen > 160) fail(`${rel}: description length ${descLen}`);
    if (!canonical.startsWith(SITE_URL)) fail(`${rel}: canonical ${canonical}`);
    if (!jsonLdOk) fail(`${rel}: invalid JSON-LD`);
    for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
      const href = m[1];
      if (href.startsWith('//') || href.startsWith('/_astro/')) continue;
      const target = href.endsWith('/') ? join(DIST, href, 'index.html') : join(DIST, href);
      if (!existsSync(target)) broken.add(`${rel} -> ${href}`);
    }
  }
  results.links = { htmlFiles: htmlFiles.length, broken: [...broken] };
  if (broken.size) fail(`broken internal links: ${[...broken].join(', ')}`);
  const posts = readdirSync('src/content/blog').filter((f) => f.endsWith('.md'));
  const sitemap = readdirSync(DIST)
    .filter((f) => /^sitemap-\d+\.xml$/.test(f))
    .map((f) => readFileSync(join(DIST, f), 'utf8'))
    .join('');
  const missingInSitemap = posts
    .map((f) => `${SITE_URL}/blog/${f.replace(/\.md$/, '')}/`)
    .filter((u) => !sitemap.includes(`<loc>${u}</loc>`));
  const rss = readFileSync(join(DIST, 'rss.xml'), 'utf8');
  const rssItems = (rss.match(/<item>/g) ?? []).length;
  results.feeds = { posts: posts.length, missingInSitemap, rssItems };
  if (missingInSitemap.length) fail(`sitemap misses ${missingInSitemap.join(', ')}`);
  if (rssItems !== posts.length) fail(`rss has ${rssItems} items for ${posts.length} posts`);
  console.log('seo', `${htmlFiles.length} html files, broken links ${broken.size}`, results.feeds);

  // 4. Motion.
  {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
    await revealAll(page);
    await page.waitForTimeout(2500);
    results.motion.reducedRunning = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    );
    results.motion.reducedDrops = await page.locator('.mascot-drop').count();
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
    const page = await context.newPage();
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);
    results.motion.swayRunning = await page.evaluate(() =>
      document.getAnimations().some(
        (a) => a.playState === 'running' && a.effect?.target?.classList?.contains('mascot-sway'),
      ),
    );
    results.motion.dropsSeen = await page.locator('#top .mascot-drop').count();
    await page.getByRole('button', { name: 'Poke the Lensprout mascot' }).first().click();
    await page.waitForTimeout(80);
    results.motion.jumpOnPoke = await page.evaluate(() =>
      document
        .querySelector('#top .mascot-jump')
        .getAnimations()
        .some((a) => a.playState === 'running'),
    );
    await page.locator('#features').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    results.motion.demosRunning = await page.evaluate(
      () =>
        document.querySelectorAll('.demo.is-playing').length > 0 &&
        document.getAnimations().filter((a) => a.playState === 'running').length > 0,
    );
    await context.close();
  }
  const m = results.motion;
  console.log('motion', m);
  if (m.reducedRunning !== 0) fail(`reduced motion: ${m.reducedRunning} running animations`);
  if (m.reducedDrops !== 0) fail('reduced motion: droplets rendered');
  if (!m.swayRunning) fail('mascot sway not running');
  if (!m.dropsSeen) fail('no droplets seen on the hero mascot');
  if (!m.jumpOnPoke) fail('poke did not start a jump');
  if (!m.demosRunning) fail('demos not running');

  // 4b. Scroll story: steps advance with scroll, step 5 tilts with progress.
  for (const [scheme, vp] of [
    ['light', 'desktop'],
    ['dark', 'desktop'],
    ['light', 'mobile'],
  ]) {
    const context = await browser.newContext({ viewport: VIEWPORTS[vp], colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
    const seen = [];
    const story = {};
    for (const n of [1, 3, 5, 7]) {
      await page.evaluate((n) => {
        const el = document.getElementById('story-step-' + n);
        const line = window.innerHeight * (window.innerWidth >= 1024 ? 0.5 : 0.72);
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - line + 40);
      }, n);
      await page.waitForTimeout(1300);
      const step = await page.evaluate(() => document.getElementById('story').dataset.step);
      seen.push(Number(step));
      await page
        .locator('#story .stage-col')
        .screenshot({ path: join(outDir, `sections/story-step${n}-${scheme}-${vp}.png`) });
      if (n === 5) {
        story.pAtStart = await page.evaluate(() => getComputedStyle(document.getElementById('story')).getPropertyValue('--p'));
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(400);
        story.pLater = await page.evaluate(() => getComputedStyle(document.getElementById('story')).getPropertyValue('--p'));
      }
    }
    story.steps = seen;
    results.motion[`story-${scheme}-${vp}`] = story;
    if (seen.join() !== '1,3,5,7') fail(`story ${scheme} ${vp}: steps seen ${seen.join()}`);
    if (!(Number(story.pLater) > Number(story.pAtStart))) fail(`story ${scheme} ${vp}: --p did not grow in step 5`);
    await context.close();
  }

  // 4c. Web editor: import a video, open it in the editor, export an MP4 and check the file.
  {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(ORIGIN + '/editor/', { waitUntil: 'networkidle' });
    const libraryAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    await page.locator('input[type=file]').setInputFiles(resolve('scripts/fixtures/sample.mp4'));
    await page.waitForURL(/\?project=/, { timeout: 30000 });
    await page.getByRole('button', { name: 'Export video' }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(outDir, 'editor-web.png') });
    await page.getByRole('button', { name: 'Export video' }).first().click();
    await page.getByRole('button', { name: 'Start export' }).click();
    const link = page.getByRole('link', { name: 'Download MP4' });
    await link.waitFor({ timeout: 120000 });
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const saved = join(outDir, 'editor-web-export.mp4');
    await download.saveAs(saved);
    const size = statSync(saved).size;
    results.webEditor = {
      libraryAxeViolations: libraryAxe.violations.map((v) => v.id),
      exportedBytes: size,
      pageErrors: errors,
    };
    console.log('web editor', results.webEditor);
    if (libraryAxe.violations.length) fail(`web editor library: axe ${libraryAxe.violations.map((v) => v.id)}`);
    if (size < 10_000) fail(`web editor export too small (${size} bytes)`);
    if (errors.length) fail(`web editor page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  // 5. Theme toggle and FAQ.
  {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    const afterClick = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await page.goto(ORIGIN + '/blog/', { waitUntil: 'networkidle' });
    const persistsAcrossPages = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    const relabelled = (await page.getByRole('button', { name: 'Switch to light theme' }).count()) === 1;
    await page.goto(ORIGIN + '/#faq', { waitUntil: 'networkidle' });
    await page.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    const faqOpen = await page.locator('details').first().evaluate((d) => d.open);
    results.interaction = { afterClick, persistsAcrossPages, relabelled, faqOpen };
    console.log('interaction', results.interaction);
    for (const [k, v] of Object.entries(results.interaction)) if (!v) fail(`interaction ${k} failed`);
    await context.close();
  }
  await browser.close();
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  stop();
}
results.failures = failures;
writeFileSync(join(outDir, 'check-results.json'), JSON.stringify(results, null, 2) + '\n');
for (const f of failures) console.log('FAIL', f);
console.log(failures.length ? `FAILED (${failures.length})` : 'OK', `→ ${outDir}`);
process.exit(failures.length ? 1 : 0);
