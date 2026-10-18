// Writes public/favicon.svg from the shared mascot geometry (the extension icon: mascot on a
// purple tile). Run with `npm run favicon`; Node strips the TypeScript types itself.
import { writeFileSync } from 'node:fs';
import { iconSvg } from '../src/brand/mascot-shapes.ts';

const out = new URL('../public/favicon.svg', import.meta.url);
writeFileSync(out, iconSvg(128) + '\n');
console.log(`wrote ${out.pathname}`);
