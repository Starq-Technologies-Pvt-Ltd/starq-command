import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observationBoundaryPlugin } from './http-boundary.mjs';

const profileRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(profileRoot);
const DATA_SERVICE = process.env.COMMAND_DATA_SERVICE || 'http://127.0.0.1:5177';
const BUILDING_SERVICE = process.env.BUILDING_SERVICE || 'http://127.0.0.1:5178';

// Deliberately no Herdr or Command-control proxy, WebSocket proxy, or Vite HMR
// channel. Unlisted /api paths fall through to the data service's explicit
// observation allowlist and are refused there.
const proxy = {
  '/api/building': { target: BUILDING_SERVICE, changeOrigin: true },
  '/api': { target: DATA_SERVICE, changeOrigin: true },
};

export default defineConfig({
  root: profileRoot,
  // Do not load .env files or expose inherited VITE_* values to the observer UI.
  envDir: false,
  envPrefix: [],
  plugins: [react(), observationBoundaryPlugin()],
  resolve: { alias: { '@': path.join(packageRoot, 'src') } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, hmr: false, proxy },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  build: { outDir: '../dist-observation', emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 900 },
});
