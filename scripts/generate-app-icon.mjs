import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIcon } from './lib/icon-art.mjs';

// Renders the ClipForge icon (same art as the browser extension) at 1024x1024
// into build/icon.png. electron-builder uses this as the source for the macOS
// .icns and Windows .ico at package time.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
mkdirSync(buildDir, { recursive: true });

writeFileSync(path.join(buildDir, 'icon.png'), createIcon(1024));
console.log(`Wrote ${path.join(buildDir, 'icon.png')} (1024x1024)`);
