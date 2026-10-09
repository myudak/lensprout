import { build } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, writeFileSync } from 'node:fs';
export default async function setup() {
  await build({
    configFile: false,
    build: {
      lib: {
        entry: resolve('tests/browser/harness.ts'),
        formats: ['es'],
        fileName: () => 'test-harness.js',
      },
      outDir: '.output/chrome-mv3',
      emptyOutDir: false,
      minify: false,
    },
  });
  const worker = readdirSync('.output/chrome-mv3/assets').find((name) =>
    name.startsWith('job.worker-'),
  )!;
  writeFileSync(
    '.output/chrome-mv3/test-no-aac-worker.js',
    `import './assets/${worker}'; self.AudioEncoder = undefined;`,
  );
  // Imports evaluate in order, so the patch runs before the worker module.
  writeFileSync(
    '.output/chrome-mv3/test-no-webgl-patch.js',
    `const get = OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext = function (type, options) {
  return type === 'webgl2' ? null : get.call(this, type, options);
};`,
  );
  writeFileSync(
    '.output/chrome-mv3/test-no-webgl-worker.js',
    `import './test-no-webgl-patch.js'; import './assets/${worker}';`,
  );
  writeFileSync(
    '.output/chrome-mv3/test-no-avc-worker.js',
    `import './assets/${worker}'; self.VideoEncoder = undefined;`,
  );
}
