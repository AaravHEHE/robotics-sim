import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** The commit this build is from: shown in the app so a stale page is easy to tell from a new one. */
function buildId(): string {
  const sha = process.env.GITHUB_SHA ?? (() => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  })();
  if (!sha) return 'dev';
  // a local build with uncommitted changes says so (read once, when the dev server starts)
  const dirty = !process.env.GITHUB_SHA && (() => {
    try {
      return execSync('git status --porcelain', { encoding: 'utf8' }).trim() !== '';
    } catch {
      return false;
    }
  })();
  return sha.slice(0, 7) + (dirty ? '+dirty' : '');
}

export default defineConfig({
  // relative base so the static build works from any GitHub Pages sub-path
  base: './',
  define: { __BUILD_ID__: JSON.stringify(buildId()), __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: {
    fs: { allow: ['.'] },
  },
});
