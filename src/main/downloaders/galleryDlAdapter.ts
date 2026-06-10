import { spawn } from 'node:child_process';
import path from 'node:path';
import type {
  CookieSource,
  DownloadOption,
  GalleryDownloadRequest,
  MediaAnalyzerResult,
  MediaIntent,
  MediaItem,
  NormalizedMediaType,
  Platform
} from '../../shared/media.js';
import { detectMediaIntent, detectPlatform } from '../urlRouter.js';
import { buildRange } from '../utils/rangeBuilder.js';

interface CommandResult {
  stdout: string;
  stderr: string;
}

export class GalleryDlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GalleryDlError';
  }
}

export async function analyzeWithGalleryDl(url: string, cookieSource: CookieSource = 'none', cookieFilePath?: string): Promise<MediaAnalyzerResult> {
  const args = [...galleryCookieArgs(cookieSource, cookieFilePath), '-J', url];
  const result = await runGalleryDl(args, 90_000);
  const rawJson = parseGalleryJson(result.stdout);
  const extractionError = findExtractionError(rawJson);
  if (extractionError) {
    throw new GalleryDlError(classifyGalleryDlError(extractionError));
  }
  const platform = detectPlatform(url);
  const intent = refineIntent(detectMediaIntent(url), rawJson);
  const items = extractItems(rawJson);
  const title = stringValue(findFirst(rawJson, ['title', 'album_title', 'board', 'name', 'description'])) || titleFromUrl(url);
  const creator = stringValue(findFirst(rawJson, ['user', 'username', 'owner', 'author', 'profile', 'account']));
  const description = stringValue(findFirst(rawJson, ['description', 'caption', 'text']));
  // Prefer the first item's image so carousels preview with their first photo.
  const firstItem = items[0];
  const thumbnail =
    firstItem?.thumbnail ||
    (firstItem?.type === 'image' ? firstItem.url : undefined) ||
    items.find((item) => item.thumbnail)?.thumbnail ||
    stringValue(findFirst(rawJson, ['thumbnail', 'thumb', 'display_url', 'image']));
  const mediaType = inferMediaType(platform, intent, items);

  return {
    platform,
    intent,
    sourceUrl: url,
    title,
    creator,
    description,
    thumbnail,
    mediaType,
    items,
    availableOutputs: galleryOptions(platform, mediaType, url),
    requiresCookies: looksCookieBlocked(result.stderr || result.stdout),
    rawTool: 'gallery-dl',
    rawJson
  };
}

export function buildGalleryDlDownloadArgs(request: GalleryDownloadRequest): string[] {
  const args = [...galleryCookieArgs(request.cookieSource, request.cookieFilePath)];
  if (request.selectedItems?.length) {
    args.push('--range', buildRange(request.selectedItems));
  }
  args.push('-d', request.outputPath, request.url);
  return args;
}

export function classifyGalleryDlError(output: string): string {
  const normalized = output.toLowerCase();
  if (normalized.includes('login') || normalized.includes('cookies') || normalized.includes('private') || normalized.includes('forbidden')) {
    return 'This link looks private or requires login/cookies. Import a cookies.txt file or use browser cookies for content you are permitted to save.';
  }
  if (normalized.includes('rate') || normalized.includes('too many requests') || normalized.includes('429')) {
    return 'The platform is rate limiting downloads. Try again later, or use cookies for an account that can access the content.';
  }
  if (normalized.includes('unsupported') || normalized.includes('no suitable extractor')) {
    return 'This platform may have changed and the downloader could not parse it. Try updating gallery-dl.';
  }
  if (normalized.includes('not found') || normalized.includes('unavailable')) {
    return 'No downloadable media was detected, or the media is unavailable.';
  }
  return output.trim() || 'gallery-dl failed without a detailed error message.';
}

function galleryCookieArgs(cookieSource: CookieSource = 'none', cookieFilePath?: string): string[] {
  if (cookieFilePath) {
    return ['--cookies', cookieFilePath];
  }
  if (cookieSource === 'none') {
    return [];
  }
  return ['--cookies-from-browser', cookieSource];
}

function runGalleryDl(args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('gallery-dl', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGTERM');
      reject(new GalleryDlError('gallery-dl took too long to respond. This link may require cookies or the site may be rate limiting requests.'));
    }, timeoutMs);

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish(() => reject(new GalleryDlError(classifyGalleryDlError(error.message))));
    });
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new GalleryDlError(classifyGalleryDlError(stderr || stdout)));
      });
    });
  });
}

// gallery-dl can exit 0 while reporting extraction failures inline, e.g.
// [[-1, {"error": "AbortExtraction", "message": "HTTP redirect to login page"}]]
function findExtractionError(raw: unknown): string | undefined {
  let found: string | undefined;
  visitObjects(raw, (object) => {
    if (!found && object.error !== undefined) {
      found = stringValue(object.message) || stringValue(object.error) || 'gallery-dl could not extract this link.';
    }
  });
  return found;
}

function parseGalleryJson(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new GalleryDlError('No downloadable media was detected.');
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const values = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter((value): value is unknown => value !== null);

    if (values.length > 0) {
      return values;
    }
    throw new GalleryDlError('gallery-dl returned metadata that could not be read.');
  }
}

function extractItems(raw: unknown): MediaItem[] {
  const candidates: Record<string, unknown>[] = [];
  visitObjects(raw, (object) => {
    const mediaUrl = firstString(object, ['url', 'file_url', 'image_url', 'display_url', 'video_url', 'contentUrl', 'src', 'original']);
    const thumbnail = firstString(object, ['thumbnail', 'thumb', 'preview', 'display_url', 'image']);
    const extension = firstString(object, ['extension', 'ext', 'format']);
    const filename = firstString(object, ['filename', 'name', 'title']);
    if (mediaUrl || thumbnail || extension || filename) {
      candidates.push(object);
    }
  });

  const seen = new Set<string>();
  const items = candidates
    .map((object) => itemFromObject(object))
    .filter((item) => {
      const key = item.url || item.thumbnail || item.filename || item.id;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return Boolean(item.url || item.thumbnail || item.filename);
    })
    .map((item, index) => ({ ...item, index: index + 1, selected: true }));

  return items.length > 0
    ? items
    : [
        {
          id: '1',
          index: 1,
          type: 'unknown',
          selected: true
        }
      ];
}

function itemFromObject(object: Record<string, unknown>): MediaItem {
  const url = firstString(object, ['url', 'file_url', 'image_url', 'display_url', 'video_url', 'contentUrl', 'src', 'original']);
  const thumbnail = firstString(object, ['thumbnail', 'thumb', 'preview', 'display_url', 'image']);
  const filename = firstString(object, ['filename', 'name', 'title']);
  const extension = firstString(object, ['extension', 'ext', 'format']) || extensionFromUrl(url || filename);
  const type = inferItemType(url, extension, object);
  return {
    id: firstString(object, ['id', 'media_id', 'shortcode', 'pin_id']) || `${filename || url || thumbnail || 'item'}`,
    index: Number(firstString(object, ['num', 'index'])) || 1,
    type,
    url,
    thumbnail,
    filename,
    extension,
    width: numberValue(object.width) ?? numberValue(object.image_width),
    height: numberValue(object.height) ?? numberValue(object.image_height),
    duration: numberValue(object.duration),
    selected: true
  };
}

function inferItemType(url?: string, extension?: string, object?: Record<string, unknown>): MediaItem['type'] {
  const value = `${url ?? ''} ${extension ?? ''} ${String(object?.type ?? '')} ${String(object?.media_type ?? '')}`.toLowerCase();
  if (/\.(?:jpg|jpeg|png|webp|gif|heic)(?:[?#]|$)/u.test(value) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].some((ext) => value.includes(ext))) {
    return 'image';
  }
  if (/\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/u.test(value) || ['video', 'mp4', 'webm', 'mov'].some((token) => value.includes(token))) {
    return 'video';
  }
  return 'unknown';
}

function inferMediaType(platform: Platform, intent: MediaIntent, items: MediaItem[]): NormalizedMediaType {
  if (intent === 'pinterest-board' || intent === 'pinterest-section') {
    return 'board';
  }
  if (intent === 'facebook-album') {
    return 'album';
  }
  if (intent === 'instagram-carousel' || items.length > 1) {
    return platform === 'pinterest' ? 'board' : 'carousel';
  }
  if (items.some((item) => item.type === 'video')) {
    return 'video';
  }
  if (items.some((item) => item.type === 'image')) {
    return 'image';
  }
  return 'unknown';
}

function refineIntent(intent: MediaIntent, raw: unknown): MediaIntent {
  if (intent === 'instagram-image' && extractItems(raw).length > 1) {
    return 'instagram-carousel';
  }
  return intent;
}

function galleryOptions(platform: Platform, mediaType: NormalizedMediaType, url: string): DownloadOption[] {
  return [
    {
      id: 'gallery-all',
      label: mediaType === 'board' ? 'Download full board' : 'Download all media',
      type: mediaType,
      tool: 'gallery-dl',
      commandArgs: ['gallery-dl', '-d', 'OUTPUT_PATH', url]
    },
    {
      id: 'gallery-selected',
      label: platform === 'pinterest' ? 'Download selected pins' : 'Download selected items',
      type: mediaType,
      tool: 'gallery-dl',
      commandArgs: ['gallery-dl', '--range', 'SELECTED_RANGE', '-d', 'OUTPUT_PATH', url]
    }
  ];
}

function visitObjects(value: unknown, visitor: (object: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitObjects(item, visitor));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const object = value as Record<string, unknown>;
  visitor(object);
  Object.values(object).forEach((child) => visitObjects(child, visitor));
}

function findFirst(value: unknown, keys: string[]): unknown {
  let found: unknown;
  visitObjects(value, (object) => {
    if (found !== undefined) {
      return;
    }
    for (const key of keys) {
      if (object[key] !== undefined) {
        found = object[key];
        return;
      }
    }
  });
  return found;
}

function firstString(object: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(object[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extensionFromUrl(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const ext = path.extname(value.split('?')[0] ?? '').replace('.', '').toLowerCase();
  return ext || undefined;
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).at(-1) || parsed.hostname;
  } catch {
    return 'Gallery media';
  }
}

function looksCookieBlocked(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes('login') || normalized.includes('cookies') || normalized.includes('private') || normalized.includes('forbidden');
}
