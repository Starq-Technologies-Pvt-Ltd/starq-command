import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const DATA_SERVICE = process.env.COMMAND_DATA_SERVICE || 'http://127.0.0.1:5177';

// Phase 7 (Room seq 8361): Hoadha is projected by a SEPARATE read-only
// Building origin, not by the frozen data service. The proxy routes only the
// Building namespace there; every other /api path keeps going to the frozen
// data service, which is not modified.
const BUILDING_SERVICE = process.env.BUILDING_SERVICE || 'http://127.0.0.1:5178';
const HERDR_SERVICE = process.env.HERDR_SERVICE || 'http://127.0.0.1:5179';

const proxy = {
  '/api/command': { target: HERDR_SERVICE, changeOrigin: true },
  '/api/herdr': { target: HERDR_SERVICE, changeOrigin: true },
  '/api/building': { target: BUILDING_SERVICE, changeOrigin: true },
  '/api': { target: DATA_SERVICE, changeOrigin: true },
};

export default defineConfig({
  root: packageRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.join(packageRoot, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
