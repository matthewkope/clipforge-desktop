import type { GalleryDownloadRequest } from '../../shared/media.js';

export function buildInstaloaderDownloadArgs(request: GalleryDownloadRequest): string[] {
  const shortcode = instagramShortcode(request.url);
  return shortcode ? ['--dirname-pattern', request.outputPath, '--', `-${shortcode}`] : ['--dirname-pattern', request.outputPath, request.url];
}

function instagramShortcode(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const marker = parts.findIndex((part) => ['p', 'reel', 'tv'].includes(part));
    return marker >= 0 ? (parts[marker + 1] ?? null) : null;
  } catch {
    return null;
  }
}
