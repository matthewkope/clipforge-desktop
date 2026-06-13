import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: '.',
  // Use relative asset paths for production builds so the renderer loads when
  // Electron serves dist/renderer/index.html over file:// (absolute "/assets"
  // paths resolve to the filesystem root there and break). Dev keeps "/" for
  // the Vite dev server.
  base: command === 'build' ? './' : '/',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: false
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false
  }
}));
