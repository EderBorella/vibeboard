import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:4610';

// The UI is a Vite/React app rooted at web/. `vite build` emits to dist/web,
// which the Fastify process serves as static files in production (single port).
// In dev, this server proxies API + WS calls through to Fastify on 4610.
export default defineConfig({
  root: here,
  plugins: [react()],
  build: {
    outDir: resolve(here, '../dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
});
