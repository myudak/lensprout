import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

/**
 * The web editor: the same library and editor pages as the extension, built as a plain site for
 * lensprout.myudak.com/editor/ (the landing build copies dist-web/ there). No recorder, no
 * manifest and never the local wallpaper pack (publicDir is off).
 */
const here = import.meta.dirname;
export default defineConfig({
  root: resolve(here, 'web'),
  base: '/editor/',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': here, '~': here } },
  define: { __BUILD_VERSION__: JSON.stringify(pkg.version) },
  worker: { format: 'es' },
  build: { outDir: resolve(here, 'dist-web'), emptyOutDir: true, target: 'es2022' },
  server: { port: 5190 },
});
