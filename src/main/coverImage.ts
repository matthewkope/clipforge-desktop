import { spawn } from 'node:child_process';
import path from 'node:path';
import { nativeImage } from 'electron';
import { isKnownDownloadFile } from './utils/pathSafety.js';

// Generates a small cover thumbnail (data URI) from a downloaded file so the
// Downloads history can show real previews. Images are decoded/resized with
// Electron's nativeImage; videos get a single frame grabbed via ffmpeg.

const coverHeight = 128;
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic']);
const videoExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);

const cache = new Map<string, string | null>();

export async function getDownloadCover(filePath: string): Promise<string | null> {
  if (!filePath) {
    return null;
  }
  // Only ever read back files this app downloaded. Without this, the renderer
  // could ask for any image/video on disk and receive its bytes as a data URI.
  if (!(await isKnownDownloadFile(filePath))) {
    return null;
  }
  if (cache.has(filePath)) {
    return cache.get(filePath) ?? null;
  }

  const cover = await buildCover(filePath);
  cache.set(filePath, cover);
  return cover;
}

async function buildCover(filePath: string): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (imageExtensions.has(ext)) {
      return imageCover(filePath);
    }
    if (videoExtensions.has(ext)) {
      return await videoCover(filePath);
    }
  } catch {
    return null;
  }
  return null;
}

function imageCover(filePath: string): string | null {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    return null;
  }
  return image.resize({ height: coverHeight, quality: 'good' }).toDataURL();
}

function videoCover(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    // Grab one frame ~1s in and stream a JPEG to stdout; keep it small.
    const child = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', filePath, '-frames:v', '1', '-vf', `scale=-1:${coverHeight}`, '-f', 'image2', 'pipe:1'],
      { shell: false, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve(null);
        return;
      }
      resolve(`data:image/jpeg;base64,${Buffer.concat(chunks).toString('base64')}`);
    });
  });
}
