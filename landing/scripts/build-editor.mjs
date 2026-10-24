// Builds the web editor from ../extension (vite.web.config.ts) and copies it to dist/editor/, so
// the site serves it at /editor/. Runs after `astro build`; installs the extension's dependencies
// first when they are missing (as on a fresh Vercel build).
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ext = resolve(import.meta.dirname, '../../extension');
const run = (cmd) => execSync(cmd, { cwd: ext, stdio: 'inherit' });

if (!existsSync(resolve(ext, 'node_modules/vite'))) run('npm ci --no-audit --no-fund');
// The extension's tsconfig extends WXT's generated .wxt/tsconfig.json (gitignored). A restored
// Vercel build cache can bring node_modules back without it, so generate it when missing.
if (!existsSync(resolve(ext, '.wxt/tsconfig.json'))) run('npx wxt prepare');
run('npm run build:web');

const out = resolve(import.meta.dirname, '../dist/editor');
rmSync(out, { recursive: true, force: true });
cpSync(resolve(ext, 'dist-web'), out, { recursive: true });
console.log('copied the web editor to dist/editor/');
