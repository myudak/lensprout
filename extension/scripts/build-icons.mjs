#!/usr/bin/env node
/**
 * Rasterizes the Lensprout extension icon (src/components/brand/mascot-shapes.ts) to
 * public/icon/{16,32,48,128}.png with resvg. Node strips the TypeScript types on import.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(import.meta.dirname, '..');
const { iconSvg } = await import(
  pathToFileURL(join(root, 'src/components/brand/mascot-shapes.ts')).href
);
const out = join(root, 'public/icon');
mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(iconSvg(size), { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(out, `${size}.png`), png);
}
console.log('icons: public/icon/{16,32,48,128}.png');
