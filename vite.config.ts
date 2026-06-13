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
    strictPort: false,
    // Don't watch build-output folders. They live in the project root, and Vite
    // churning on them (the packaged app, downloaded binaries, compiled output)
    // triggers spurious dev-server page reloads that can blank the window.
    watch: {
      ignored: ['**/dist/**', '**/release/**', '**/resources/bin/**']
    }
  }
}));
