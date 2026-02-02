// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.rpym.net',
  output: 'static', // SSG por defecto, endpoints con prerender=false son dinámicos
  adapter: cloudflare(), // Necesario para los endpoints dinámicos

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [react(), sitemap()],

  // Comprimir HTML
  compressHTML: true,

  build: {
    // Inline pequeños assets
    inlineStylesheets: 'auto',
  },
});