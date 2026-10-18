// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { SITE_URL } from './src/site.ts';

export default defineConfig({
  site: SITE_URL,
  trailingSlash: 'always',
  integrations: [react(), sitemap({ filter: (page) => !page.includes('/demo/') })],
  server: { port: 5180 },
  vite: { plugins: [tailwindcss()] },
});
