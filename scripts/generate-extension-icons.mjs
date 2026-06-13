import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIcon } from './lib/icon-art.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'extension', 'icons');
mkdirSync(outputDirectory, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  writeFileSync(path.join(outputDirectory, `icon-${size}.png`), createIcon(size));
}
