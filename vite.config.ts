import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the static build works from any GitHub Pages sub-path
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: {
    fs: { allow: ['.'] },
  },
});
