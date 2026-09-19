import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: true },
  build: {
    // the GLB is 2.3 MB and the base colour map 0.8 MB; both are meant to be
    // emitted as files, never inlined back into the bundle
    assetsInlineLimit: 0,
    target: 'es2022',
    // one entry, one three.js; splitting it out buys nothing here
    chunkSizeWarningLimit: 1200,
  },
  assetsInclude: ['**/*.glb'],
});
