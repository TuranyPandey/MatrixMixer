import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use the shared code straight from source: no build step between packages.
    alias: { '@matrix-bridge/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
  },
  // Tauri expects a fixed port and shows its own errors.
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', outDir: 'dist' },
});
