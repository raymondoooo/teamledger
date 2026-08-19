import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The version on screen comes from the workspace root package.json, which is
// the same number the release tag carries — CI refuses to publish a v* tag that
// disagrees with it, so the footer cannot quietly describe a different build.
// Read here rather than imported from the app: an import would bundle the whole
// manifest and, being outside the vite root, trip the dev server's fs guard.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  server: {
    port: 5173,
    // `npm run dev:web` talks to the API running on the host from
    // `npm run dev:server`, so the browser sees one origin either way.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
