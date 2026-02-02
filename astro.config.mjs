// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.rpym.net',
  output: 'static', // SSG para máximo rendimiento

  vite: {
    plugins: [tailwindcss()],
    build: {
      // Optimizar chunks
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          // Mejores nombres para cache
          assetFileNames: 'assets/[name].[hash][extname]',
          chunkFileNames: 'chunks/[name].[hash].js',
          entryFileNames: 'entry/[name].[hash].js',
        },
      },
    },
  },

  integrations: [react(), sitemap()],

  // Comprimir HTML
  compressHTML: true,

  build: {
    // Inline pequeños assets
    inlineStylesheets: 'auto',
  },
});