// Captures the demo dashboard (/demo/dashboard/) at 1280×800, 2× density, as the screen used by
// the scroll story stage: src/assets/screens/dashboard-demo.png. Needs a build first.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 5184;
const server = spawn('npx', ['astro', 'preview', '--force', '--port', String(PORT)], {
  shell: true,
  stdio: 'ignore',
});
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  await page.goto(`http://localhost:${PORT}/demo/dashboard/`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve('src/assets/screens/dashboard-demo.png') });
  await browser.close();
  console.log('wrote src/assets/screens/dashboard-demo.png');
} finally {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/t', '/f']);
  else server.kill();
}
