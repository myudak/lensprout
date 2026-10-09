import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import extensionKey from './extension-key.json';
import pkg from './package.json';

/*
 * The local wallpaper pack (scripts/build-wallpapers.py) holds Apple and Microsoft images that may
 * not be redistributed: local builds include it, release zips never do. LENSPROUT_WALLPAPERS=0
 * leaves it out of a local build too.
 */
const pack = resolve(import.meta.dirname, 'local-assets/wallpapers');
const release = process.argv.includes('zip');
const withWallpapers = !release && process.env.LENSPROUT_WALLPAPERS !== '0' && existsSync(pack);

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      if (!withWallpapers) return;
      for (const name of readdirSync(pack))
        files.push({ absoluteSrc: resolve(pack, name), relativeDest: `wallpapers/${name}` });
    },
  },
  // Pages compare this with the manifest Chrome actually loaded to detect a rebuild without reload.
  vite: () => ({
    plugins: [tailwindcss()],
    define: { __BUILD_VERSION__: JSON.stringify(pkg.version) },
  }),
  manifest: {
    // Unpacked builds keep a fixed ID (storage and tests depend on it). The Chrome Web Store
    // rejects a manifest with "key" and assigns the ID itself, so release zips leave it out.
    ...(release ? {} : { key: extensionKey.key }),
    // Renamed to Lensprout in 0.7.0; the key (extension ID) and storage names are unchanged.
    name: 'Lensprout',
    description: 'Record your screen with automatic zoom, edit it and export, all on your device.',
    minimum_chrome_version: '116',
    permissions: [
      'tabCapture',
      'desktopCapture',
      'system.display',
      'activeTab',
      'scripting',
      'storage',
      'tabs',
      'webNavigation',
      'unlimitedStorage',
    ],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: 'Lensprout: start, stop or resume recording',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' },
    },
    commands: { _execute_action: { suggested_key: { default: 'Ctrl+Shift+Y' } } },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; worker-src 'self'",
    },
  },
});
