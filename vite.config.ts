import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Prod: server serves the built SPA from dist/client (single origin → no CORS).
// Dev: Vite on :5173 proxies /api + /ws to the daemon on :7878, so the client
// uses the same relative URLs in both modes.
export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7878',
      '/ws': { target: 'ws://localhost:7878', ws: true },
      '/health': 'http://localhost:7878',
    },
  },
});
