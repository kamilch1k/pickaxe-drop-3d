import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5177,
    host: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
