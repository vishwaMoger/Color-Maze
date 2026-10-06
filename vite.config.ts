import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 200000,
    chunkSizeWarningLimit: 1500,
    // One script file: simpler to host on game portals and to embed.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
