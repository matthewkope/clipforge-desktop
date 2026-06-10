import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'extension', 'icons');
mkdirSync(outputDirectory, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  writeFileSync(path.join(outputDirectory, `icon-${size}.png`), createIcon(size));
}

function createIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size * 0.46;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const distance = Math.hypot(x - center, y - center);
      const edge = Math.max(0, Math.min(1, radius + 0.7 - distance));
      if (edge === 0) {
        continue;
      }

      const progress = (x + y) / Math.max(1, (size - 1) * 2);
      pixels[offset] = Math.round(37 + (6 - 37) * progress);
      pixels[offset + 1] = Math.round(99 + (166 - 99) * progress);
      pixels[offset + 2] = Math.round(235 + (166 - 235) * progress);
      pixels[offset + 3] = Math.round(255 * edge);
    }
  }

  drawLine(pixels, size, 0.31, 0.33, 0.69, 0.33);
  drawLine(pixels, size, 0.31, 0.5, 0.69, 0.5);
  drawLine(pixels, size, 0.31, 0.67, 0.57, 0.67);
  return encodePng(size, pixels);
}

function drawLine(pixels, size, x1, y1, x2, y2) {
  const startX = Math.round(size * x1);
  const endX = Math.round(size * x2);
  const centerY = Math.round(size * y1);
  const thickness = Math.max(1, Math.round(size * 0.055));

  for (let y = centerY - thickness; y <= centerY + thickness; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) {
        continue;
      }
      const offset = (y * size + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }
}

function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
