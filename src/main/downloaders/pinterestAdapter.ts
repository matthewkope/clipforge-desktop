import { spawn, spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CookieSource, DownloadOption, MediaAnalyzerResult, MediaItem, PinterestSafeModeSettings } from '../../shared/media.js';
import { dedupeMediaItems } from '../utils/dedupeMediaItems.js';
import { createPinterestManifest, pinterestArchivePath } from '../utils/mediaManifest.js';
import { logPinterestDebug } from '../utils/pinterestDebug.js';
import {
  extractPinterestPinId,
  normalizeMediaUrl,
  normalizePinterestUrl,
  slugifyPinterestValue,
  type PinterestTarget
} from '../utils/pinterestNormalize.js';
import { getOrExtractBraveCookiesPath } from '../utils/braveCookieExtractor.js';
import { classifyGalleryDlError } from './galleryDlAdapter.js';

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface PinterestCandidate {
  item?: MediaItem;
  filteredReason?: string;
  failedParse?: boolean;
}

export async function analyzeWithPinterest(
  url: string,
  cookieSource: CookieSource = 'none',
  cookieFilePath?: string,
  settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()
): Promise<MediaAnalyzerResult> {
  const target = await normalizedPinterestTarget(url);
  const effectiveCookieSource = effectivePinterestCookieSource(cookieSource, cookieFilePath, settings);
  const resolvedCookieArgs = await resolvePinterestCookieArgs(effectiveCookieSource, cookieFilePath, settings);
  const args = pinterestModuleArgs([...resolvedCookieArgs, '-J', target.normalizedUrl]);
  await unlockBravePinterestCookiesIfNeeded(effectiveCookieSource, cookieFilePath, settings);
  await logPinterestDebug('analysis:start', {
    inputUrl: url,
    normalizedUrl: target.normalizedUrl,
    type: target.type,
    args: redactArgs(args),
    equivalentCommand: equivalentPinterestCommand(pinterestPythonExecutable(settings), args),
    cookieMode: cookieMode(effectiveCookieSource, cookieFilePath),
    safeMode: settings
  });

  const result = await runGalleryDl(args, 90_000, settings);
  const rawJson = parseGalleryJson(result.stdout);
  const candidates = pinterestCandidates(rawJson, target);
  const parsedItems = candidates.flatMap((candidate) => (candidate.item ? [candidate.item] : []));
  const filteredOutCount = candidates.filter((candidate) => candidate.filteredReason).length;
  const failedParseCount = candidates.filter((candidate) => candidate.failedParse).length;
  const { items: deduped, duplicateCount } = dedupeMediaItems(parsedItems);

  const manifestItems = deduped.map((item, index) => ({
    ...item,
    index: index + 1,
    visibleIndex: index + 1,
    appItemId: item.appItemId || `${item.pinId || 'pin'}-${index + 1}`,
    selected: true
  }));
  const archivePath = pinterestArchivePath(url);

  const manifest = await createPinterestManifest({
    sourceUrl: url,
    normalizedSourceUrl: target.normalizedUrl,
    cookieMode: { cookieSource: effectiveCookieSource, cookieFilePath },
    itemCountRaw: parsedItems.length + filteredOutCount,
    itemCountFiltered: parsedItems.length,
    itemCountDeduped: manifestItems.length,
    duplicateCount,
    filteredOutCount,
    archivePath,
    items: manifestItems
  });

  await logPinterestDebug('analysis:complete', {
    manifestId: manifest.manifestId,
    rawItemCount: manifest.itemCountRaw,
    filteredOutCount,
    duplicateCount,
    displayedCount: manifestItems.length,
    failedParseCount
  });

  const title = pinterestTitle(target, manifestItems);
  const creator = target.owner || manifestItems.find((item) => item.boardOwner)?.boardOwner;
  const thumbnail = manifestItems.find((item) => item.thumbnail)?.thumbnail || manifestItems.find((item) => item.mediaUrl)?.mediaUrl;

  return {
    manifestId: manifest.manifestId,
    archivePath,
    platform: 'pinterest',
    intent: target.type === 'pin' ? 'pinterest-pin' : target.type === 'section' ? 'pinterest-section' : 'pinterest-board',
    sourceUrl: url,
    normalizedSourceUrl: target.normalizedUrl,
    title,
    creator,
    thumbnail,
    mediaType: target.type === 'pin' ? 'image' : 'board',
    items: manifestItems,
    availableOutputs: pinterestOptions(target.normalizedUrl),
    requiresCookies: looksCookieBlocked(result.stderr || result.stdout),
    rawTool: 'gallery-dl',
    rawJson: {
      manifestId: manifest.manifestId,
      normalizedSourceUrl: target.normalizedUrl,
      stats: manifest
    },
    stats: {
      rawCount: manifest.itemCountRaw,
      filteredCount: filteredOutCount,
      duplicateCount,
      displayedCount: manifestItems.length,
      failedParseCount
    }
  };
}

export async function pinterestFullBoardArgs(
  url: string,
  outputPath: string,
  cookieSource: CookieSource = 'none',
  cookieFilePath?: string,
  settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()
): Promise<string[]> {
  const target = await normalizedPinterestTarget(url);
  const effectiveCookieSource = effectivePinterestCookieSource(cookieSource, cookieFilePath, settings);
  const archivePath = pinterestArchivePath(url, outputPath);
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await unlockBravePinterestCookiesIfNeeded(effectiveCookieSource, cookieFilePath, settings);
  const resolvedCookieArgs = await resolvePinterestCookieArgs(effectiveCookieSource, cookieFilePath, settings);
  return pinterestModuleArgs([
    ...resolvedCookieArgs,
    '--download-archive',
    archivePath,
    ...pinterestDownloadTimingArgs(settings),
    '-d',
    outputPath,
    url || target.normalizedUrl
  ]);
}

export async function pinterestSelectedRangeArgs(
  url: string,
  outputPath: string,
  selectedRange: string,
  cookieSource: CookieSource = 'none',
  cookieFilePath?: string,
  settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()
): Promise<string[]> {
  const effectiveCookieSource = effectivePinterestCookieSource(cookieSource, cookieFilePath, settings);
  const archivePath = pinterestArchivePath(url, outputPath);
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await unlockBravePinterestCookiesIfNeeded(effectiveCookieSource, cookieFilePath, settings);
  const resolvedCookieArgs = await resolvePinterestCookieArgs(effectiveCookieSource, cookieFilePath, settings);
  return pinterestModuleArgs([
    ...resolvedCookieArgs,
    '--download-archive',
    archivePath,
    ...pinterestDownloadTimingArgs(settings),
    '--range',
    selectedRange,
    '-d',
    outputPath,
    url
  ]);
}

export function defaultPinterestSafeModeSettings(): PinterestSafeModeSettings {
  return {
    useBraveCookies: true,
    useWorkingTerminalProfile: true,
    pythonExecutablePath: '',
    cookieMode: 'brave-pinterest',
    safeMode: true,
    delayBetweenDownloads: '4-8',
    delayBetweenRequests: '3-6',
    sleep429: '300',
    retries: 5,
    debugShowCommandArgs: false
  };
}

export function effectivePinterestCookieSource(
  cookieSource: CookieSource = 'none',
  cookieFilePath?: string,
  settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()
): CookieSource {
  if (settings.cookieMode === 'cookies-txt' && cookieFilePath) {
    return cookieSource;
  }
  if (settings.cookieMode === 'none' || settings.useBraveCookies === false) {
    return 'none';
  }
  return 'brave';
}

export function pinterestSafeModeArgs(settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()): string[] {
  if (!settings.safeMode) {
    return [];
  }
  return [
    '--sleep',
    settings.delayBetweenDownloads || '4-8',
    '--sleep-request',
    settings.delayBetweenRequests || '3-6',
    '--sleep-429',
    settings.sleep429 || 'exp:60:300',
    '--retries',
    String(settings.retries || 5)
  ];
}

export function pinterestCookieArgs(
  cookieSource: CookieSource = 'none',
  cookieFilePath?: string,
  settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()
): string[] {
  if (settings.cookieMode === 'cookies-txt') {
    return cookieFilePath ? ['--cookies', cookieFilePath] : [];
  }
  if (settings.cookieMode === 'none' || cookieSource === 'none') {
    return [];
  }
  if (settings.cookieMode === 'brave-pinterest' || cookieSource === 'brave') {
    return ['--cookies-from-browser', 'brave/.pinterest.com'];
  }
  return ['--cookies-from-browser', cookieSource];
}

// Async version: tries to extract Brave cookies to a temp file first.
// This bypasses the macOS Keychain subprocess access issue where the gallery-dl
// Python process (spawned from Electron) cannot get its own Keychain grant for
// "Brave Safe Storage" — but the Electron process can, so we do the extraction here.
export async function resolvePinterestCookieArgs(
  cookieSource: CookieSource = 'none',
  cookieFilePath?: string,
  settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()
): Promise<string[]> {
  if (settings.cookieMode === 'cookies-txt') {
    return cookieFilePath ? ['--cookies', cookieFilePath] : [];
  }
  if (settings.cookieMode === 'none' || cookieSource === 'none') {
    return [];
  }
  if (settings.cookieMode === 'brave-pinterest' || cookieSource === 'brave') {
    const extractedPath = await getOrExtractBraveCookiesPath('pinterest.com');
    if (extractedPath) {
      return ['--cookies', extractedPath];
    }
    // Fall back to direct browser flag — may still work if Keychain access was previously granted
    return ['--cookies-from-browser', 'brave/.pinterest.com'];
  }
  return ['--cookies-from-browser', cookieSource];
}

export function pinterestPythonExecutable(settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()): string {
  const configured = settings.pythonExecutablePath?.trim();
  const candidates = uniqueValues([configured, 'python3', 'python']);
  for (const candidate of candidates) {
    if (candidate && canRunGalleryDlModule(candidate)) {
      return candidate;
    }
  }

  const galleryDlPython = pythonFromGalleryDlShebang();
  if (galleryDlPython && canRunGalleryDlModule(galleryDlPython)) {
    return galleryDlPython;
  }

  return configured || 'python3';
}

export function pinterestSpawnEnv(): NodeJS.ProcessEnv {
  const ytDlpPath = pythonPackagePathFromExecutable('yt-dlp');
  const existingPythonPath = process.env.PYTHONPATH;
  return {
    ...process.env,
    PYTHONPATH: [ytDlpPath, existingPythonPath].filter(Boolean).join(path.delimiter)
  };
}

export function pinterestModuleArgs(args: string[]): string[] {
  return ['-m', 'gallery_dl', ...args];
}

export function equivalentPinterestCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ');
}

export async function unlockBravePinterestCookiesIfNeeded(
  cookieSource: CookieSource = 'none',
  cookieFilePath?: string,
  settings: PinterestSafeModeSettings = defaultPinterestSafeModeSettings()
): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }
  if (cookieFilePath || settings.cookieMode === 'none' || cookieSource !== 'brave') {
    return;
  }

  const result = await unlockBraveSafeStorage();
  await logPinterestDebug('keychain:brave-safe-storage', {
    prompted: true,
    success: result.success,
    service: result.service,
    error: result.error
  });
}

function pinterestDownloadTimingArgs(settings: PinterestSafeModeSettings): string[] {
  if (settings.useWorkingTerminalProfile !== false) {
    return ['--sleep-429', pinterestSleep429(settings)];
  }
  return pinterestSafeModeArgs(settings);
}

function pinterestSleep429(settings: PinterestSafeModeSettings): string {
  return settings.sleep429?.trim() || '300';
}

async function normalizedPinterestTarget(url: string): Promise<PinterestTarget> {
  const initial = normalizePinterestUrl(url);
  if (!initial.normalizedUrl.includes('pin.it')) {
    return initial;
  }

  try {
    const response = await fetch(initial.normalizedUrl, { method: 'HEAD', redirect: 'follow' });
    return normalizePinterestUrl(response.url);
  } catch {
    return initial;
  }
}

function runGalleryDl(args: string[], timeoutMs: number, settings: PinterestSafeModeSettings): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(pinterestPythonExecutable(settings), args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: pinterestSpawnEnv()
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('gallery-dl took too long to analyze this Pinterest URL.'));
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
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(classifyGalleryDlError(stderr || stdout)));
      });
    });
  });
}

function parseGalleryJson(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error('No downloadable Pinterest media was detected.');
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as unknown);
  }
}

function pinterestCandidates(rawJson: unknown, target: PinterestTarget): PinterestCandidate[] {
  const direct = directPinterestObjects(rawJson);
  if (direct.length > 0) {
    return direct.map(({ object, index }) => pinterestCandidateFromObject(object, target, index));
  }

  const objects: Array<{ object: Record<string, unknown>; path: string[] }> = [];
  visitObjects(rawJson, [], (object, objectPath) => {
    objects.push({ object, path: objectPath });
  });

  return objects
    .filter(({ object, path: objectPath }) => isPinterestPinObject(object, objectPath))
    .map(({ object, path: objectPath }, index) => {
      if (objectPath.some((part) => /related|recommend|suggest|more_like|embed/i.test(part))) {
        return { filteredReason: 'related-or-recommended' };
      }

      return pinterestCandidateFromObject(object, target, galleryDlIndexFromPath(objectPath) ?? index + 1);
    });
}

function directPinterestObjects(rawJson: unknown): Array<{ object: Record<string, unknown>; index: number }> {
  const urlMessages = galleryDlUrlMessages(rawJson);
  if (urlMessages.length > 0) {
    return urlMessages;
  }

  const rootItems = rootPinterestItems(rawJson);
  if (rootItems.length > 0) {
    return rootItems;
  }

  return [];
}

function galleryDlUrlMessages(value: unknown): Array<{ object: Record<string, unknown>; index: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: Array<{ object: Record<string, unknown>; index: number }> = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry[0] !== 3) {
      continue;
    }
    const url = typeof entry[1] === 'string' ? entry[1] : undefined;
    const metadata = entry.find((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object' && !Array.isArray(part));
    if (!metadata) {
      continue;
    }
    output.push({
      object: url ? { ...metadata, file_url: url } : metadata,
      index: output.length + 1
    });
  }
  return output;
}

function rootPinterestItems(value: unknown): Array<{ object: Record<string, unknown>; index: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const root = value as Record<string, unknown>;
  const items = ['items', 'pins', 'results'].flatMap((key) => {
    const candidate = root[key];
    return Array.isArray(candidate) ? candidate : [];
  });
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((object, index) => ({ object, index: index + 1 }));
}

function pinterestCandidateFromObject(object: Record<string, unknown>, target: PinterestTarget, index: number): PinterestCandidate {
  const item = pinterestItemFromObject(object, target, index);
  if (!item) {
    return { failedParse: true };
  }

  const reason = boardFilterReason(item, target);
  if (reason) {
    return { filteredReason: reason };
  }

  return { item };
}

export function isPinterestPinObject(object: Record<string, unknown>, objectPath: string[] = []): boolean {
  const pinId = pinterestPinIdFromObject(object);
  const pinUrl = pinUrlFromObject(object);
  const hasPinIdentity = Boolean(pinId || pinUrl);
  const hasMedia = Boolean(mediaUrlFromObject(object) || thumbnailUrlFromObject(object));
  return hasMedia && (hasPinIdentity || isLikelyEmittedPinterestItemPath(objectPath));
}

function pinterestItemFromObject(object: Record<string, unknown>, target: PinterestTarget, index: number): MediaItem | null {
  const pinUrl = pinUrlFromObject(object);
  const pinId = pinterestPinIdFromObject(object) || extractPinterestPinId(pinUrl);
  const mediaUrl = mediaUrlFromObject(object);
  const thumbnailUrl = thumbnailUrlFromObject(object) || mediaUrl;
  const extension = firstString(object, ['extension', 'ext']) || extensionFromUrl(mediaUrl || thumbnailUrl) || 'jpg';

  if (!pinId && !mediaUrl && !pinUrl && !thumbnailUrl) {
    return null;
  }

  const boardOwner = boardOwnerFromObject(object) || target.owner;
  const boardName = boardNameFromObject(object) || target.boardSlug;
  const normalizedMedia = normalizeMediaUrl(mediaUrl);
  const normalizedThumb = normalizeMediaUrl(thumbnailUrl);

  return {
    id: pinId || normalizedMedia || normalizedThumb || `pinterest-${index}`,
    appItemId: pinId ? `pin-${pinId}` : `pinterest-${index}-${shortHash(normalizedMedia || normalizedThumb || String(index))}`,
    pinId,
    pinUrl,
    mediaUrl: normalizedMedia,
    url: normalizedMedia || pinUrl,
    thumbnailUrl: normalizedThumb,
    thumbnail: normalizedThumb,
    filename: firstString(object, ['filename', 'title', 'description']),
    filenameBase: filenameBase(boardOwner, boardName, pinId, index, normalizedMedia || normalizedThumb),
    extension,
    index,
    originalGalleryDlIndex: index,
    type: mediaTypeFromExtension(extension, normalizedMedia),
    width: numberValue(object.width) ?? numberValue(object.image_width),
    height: numberValue(object.height) ?? numberValue(object.image_height),
    boardOwner,
    boardName,
    selected: true
  };
}

function boardFilterReason(item: MediaItem, target: PinterestTarget): string | undefined {
  if (target.type !== 'board' && target.type !== 'section') {
    return undefined;
  }

  const ownerMatches = !item.boardOwner || !target.owner || slugifyPinterestValue(item.boardOwner) === slugifyPinterestValue(target.owner);
  const boardMatches = !item.boardName || !target.boardSlug || slugifyPinterestValue(item.boardName) === slugifyPinterestValue(target.boardSlug);
  if (!ownerMatches) {
    return 'board-owner-mismatch';
  }
  if (!boardMatches) {
    return 'board-name-mismatch';
  }
  return undefined;
}

function visitObjects(value: unknown, objectPath: string[], visitor: (object: Record<string, unknown>, path: string[]) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitObjects(item, [...objectPath, String(index)], visitor));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const object = value as Record<string, unknown>;
  visitor(object, objectPath);
  Object.entries(object).forEach(([key, child]) => visitObjects(child, [...objectPath, key], visitor));
}

function isLikelyEmittedPinterestItemPath(objectPath: string[]): boolean {
  if (objectPath.length === 0) {
    return false;
  }

  const current = objectPath.at(-1);
  const parent = objectPath.at(-2)?.toLowerCase();
  const grandparent = objectPath.at(-3)?.toLowerCase();
  const isArrayItem = current !== undefined && /^\d+$/u.test(current);
  const container = parent && /^(items|pins|results|data|resources|edges|nodes)$/u.test(parent);
  const nestedVariantContainer = [parent, grandparent].some((part) => part && /^(images|videos|video_list|story_pin_data|blocks|pages)$/u.test(part));

  return Boolean(isArrayItem && container && !nestedVariantContainer);
}

function galleryDlIndexFromPath(objectPath: string[]): number | undefined {
  for (let index = objectPath.length - 1; index >= 0; index -= 1) {
    const part = objectPath[index];
    const parent = objectPath[index - 1]?.toLowerCase();
    if (!part || !/^\d+$/u.test(part)) {
      continue;
    }
    if (!parent || /^(items|pins|results|data|resources|edges|nodes)$/u.test(parent)) {
      return Number(part) + 1;
    }
  }
  return undefined;
}

function mediaUrlFromObject(object: Record<string, unknown>): string | undefined {
  const candidates = [
    firstString(object, [
      'file_url',
      'image_url',
      'display_url',
      'video_url',
      'gif_url',
      'animated_image_url',
      'contentUrl',
      'src',
      'original'
    ]),
    nestedString(object, ['images', 'orig', 'url']),
    nestedString(object, ['images', 'originals', 'url']),
    nestedString(object, ['images', '736x', 'url']),
    nestedString(object, ['images', 'gif', 'url']),
    nestedString(object, ['videos', 'video_list', 'V_HLSV4', 'url']),
    nestedString(object, ['videos', 'video_list', 'V_EXP7', 'url']),
    nestedString(object, ['videos', 'video_list', 'V_720P', 'url']),
    nestedString(object, ['story_pin_data', 'pages', '0', 'blocks', '0', 'video', 'video_list', 'V_720P', 'url']),
    bestNestedMediaUrl(object),
    firstString(object, ['url'])
  ];
  return candidates.find((candidate) => candidate && !/pinterest\.[^/]+\/pin\//i.test(candidate));
}

function thumbnailUrlFromObject(object: Record<string, unknown>): string | undefined {
  return (
    firstString(object, ['thumbnail', 'thumb', 'preview', 'display_url', 'image_url']) ||
    nestedString(object, ['images', '236x', 'url']) ||
    nestedString(object, ['images', '474x', 'url']) ||
    nestedString(object, ['images', '736x', 'url']) ||
    bestNestedMediaUrl(object, 'image')
  );
}

function bestNestedMediaUrl(object: Record<string, unknown>, preferred: 'image' | 'any' = 'any'): string | undefined {
  const urls: string[] = [];
  visitObjects(object, [], (candidate) => {
    const url = firstString(candidate, ['url']);
    if (url && isPinterestMediaAssetUrl(url)) {
      urls.push(url);
    }
  });

  const preferredUrls = preferred === 'image' ? urls.filter((url) => /\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/iu.test(url)) : urls;
  return [...preferredUrls].sort(mediaUrlPreference)[0];
}

function isPinterestMediaAssetUrl(url: string): boolean {
  return /(?:i\.pinimg\.com|v[0-9]?\.pinimg\.com|pinimg\.com)/iu.test(url) && !/\/pin\//iu.test(url);
}

function mediaUrlPreference(a: string, b: string): number {
  return mediaUrlScore(b) - mediaUrlScore(a);
}

function mediaUrlScore(url: string): number {
  const normalized = url.toLowerCase();
  let score = 0;
  if (/\.(?:gif)(?:[?#]|$)/u.test(normalized)) score += 1000;
  if (/\.(?:mp4|m3u8|webm|mov)(?:[?#]|$)/u.test(normalized)) score += 900;
  if (normalized.includes('/originals/')) score += 500;
  if (normalized.includes('/736x/')) score += 300;
  if (normalized.includes('/564x/')) score += 250;
  if (normalized.includes('/474x/')) score += 200;
  if (normalized.includes('/236x/')) score += 100;
  return score;
}

function pinUrlFromObject(object: Record<string, unknown>): string | undefined {
  const explicit = firstString(object, ['pin_url', 'pinterest_url', 'link']);
  if (explicit && /\/pin\//i.test(explicit)) {
    return explicit;
  }
  const url = firstString(object, ['url']);
  if (url && /\/pin\//i.test(url)) {
    return url;
  }
  const pinId = pinterestPinIdFromObject(object);
  return pinId ? `https://www.pinterest.com/pin/${pinId}/` : undefined;
}

function pinterestPinIdFromObject(object: Record<string, unknown>): string | undefined {
  const explicit = firstString(object, ['pin_id', 'pinId']);
  if (explicit) {
    return extractPinterestPinId(explicit);
  }

  const id = firstString(object, ['id']);
  return id && /^\d{8,}$/u.test(id) ? id : undefined;
}

function boardOwnerFromObject(object: Record<string, unknown>): string | undefined {
  return (
    firstString(object, ['board_owner', 'owner', 'username', 'pinner']) ||
    nestedString(object, ['board', 'owner', 'username']) ||
    nestedString(object, ['board', 'owner', 'name']) ||
    nestedString(object, ['pinner', 'username'])
  );
}

function boardNameFromObject(object: Record<string, unknown>): string | undefined {
  return firstString(object, ['board_name', 'board_slug']) || nestedString(object, ['board', 'slug']) || nestedString(object, ['board', 'name']);
}

function nestedString(object: Record<string, unknown>, keys: string[]): string | undefined {
  let current: unknown = object;
  for (const key of keys) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return firstPrimitiveString(current);
}

function firstString(object: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = firstPrimitiveString(object[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function firstPrimitiveString(value: unknown): string | undefined {
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
  return path.extname(value.split('?')[0] ?? '').replace('.', '').toLowerCase() || undefined;
}

function mediaTypeFromExtension(extension?: string, mediaUrl?: string): MediaItem['type'] {
  const value = `${extension ?? ''} ${mediaUrl ?? ''}`.toLowerCase();
  if (/\b(mp4|webm|mov|m4v|m3u8)\b/u.test(value)) {
    return 'video';
  }
  if (/\b(jpg|jpeg|png|webp|gif|heic)\b/u.test(value)) {
    return 'image';
  }
  return 'unknown';
}

function filenameBase(owner: string | undefined, board: string | undefined, pinId: string | undefined, index: number, mediaUrl?: string): string {
  const safeOwner = sanitize(owner || 'unknown');
  const safeBoard = sanitize(board || 'board');
  return pinId ? `pinterest_${safeOwner}_${safeBoard}_${pinId}` : `pinterest_${index}_${shortHash(mediaUrl || String(index))}`;
}

function sanitize(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, '_').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function pinterestTitle(target: PinterestTarget, items: MediaItem[]): string {
  if (target.type === 'pin') {
    return `Pinterest pin ${target.pinId ?? items[0]?.pinId ?? ''}`.trim();
  }
  const owner = target.owner || items.find((item) => item.boardOwner)?.boardOwner;
  const board = target.boardSlug || items.find((item) => item.boardName)?.boardName;
  return [owner, board].filter(Boolean).join(' / ') || 'Pinterest board';
}

function pinterestOptions(url: string): DownloadOption[] {
  return [
    {
      id: 'pinterest-full-board',
      label: 'Download full board',
      type: 'board',
      tool: 'gallery-dl',
      commandArgs: ['python', '-m', 'gallery_dl', '--cookies-from-browser', 'brave/.pinterest.com', '--download-archive', 'ARCHIVE_PATH', '--sleep-429', '300', '-d', 'OUTPUT_PATH', url]
    },
    {
      id: 'pinterest-selected-manifest',
      label: 'Download selected pins',
      type: 'image',
      tool: 'gallery-dl',
      commandArgs: ['python', '-m', 'gallery_dl', '--range', 'SELECTED_RANGE', '-d', 'OUTPUT_PATH', url]
    }
  ];
}

function cookieMode(cookieSource: CookieSource, cookieFilePath?: string): string {
  return cookieFilePath ? `cookies.txt:${cookieFilePath}` : cookieSource === 'none' ? 'none' : `browser:${cookieSource}`;
}

function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => (args[index - 1] === '--cookies' ? '[cookies.txt]' : arg));
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

const moduleCheckCache = new Map<string, boolean>();
let cachedGalleryDlPython: string | undefined;
let braveSafeStorageUnlocked = false;

function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function canRunGalleryDlModule(command: string): boolean {
  const cached = moduleCheckCache.get(command);
  if (cached !== undefined) {
    return cached;
  }

  const result = spawnSync(command, ['-m', 'gallery_dl', '--version'], {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
  const ok = result.status === 0;
  moduleCheckCache.set(command, ok);
  return ok;
}

function pythonFromGalleryDlShebang(): string | undefined {
  if (cachedGalleryDlPython !== undefined) {
    return cachedGalleryDlPython;
  }

  for (const candidate of galleryDlExecutableCandidates()) {
    try {
      const firstLine = fsSync.readFileSync(candidate, 'utf8').split(/\r?\n/)[0] ?? '';
      const match = firstLine.match(/^#!\s*(.+)$/u);
      if (match?.[1]) {
        cachedGalleryDlPython = match[1].trim();
        return cachedGalleryDlPython;
      }
    } catch {
      // Try the next candidate.
    }
  }

  cachedGalleryDlPython = '';
  return undefined;
}

function pythonPackagePathFromExecutable(executable: string): string | undefined {
  const target = executablePath(executable);
  if (!target) {
    return undefined;
  }
  try {
    const firstLine = fsSync.readFileSync(target, 'utf8').split(/\r?\n/)[0] ?? '';
    const match = firstLine.match(/^#!\s*(.+?)\/bin\/python(?:\d+(?:\.\d+)?)?$/u);
    if (!match?.[1]) {
      return undefined;
    }
    return path.join(match[1], 'lib', 'python3.14', 'site-packages');
  } catch {
    return undefined;
  }
}

function galleryDlExecutableCandidates(): string[] {
  const which = executablePath('gallery-dl');
  return uniqueValues([
    which,
    '/opt/homebrew/bin/gallery-dl',
    '/usr/local/bin/gallery-dl',
    '/usr/bin/gallery-dl'
  ]);
}

function executablePath(executable: string): string | undefined {
  return spawnSync('which', [executable], {
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8'
  }).stdout?.trim() || undefined;
}

async function unlockBraveSafeStorage(): Promise<{ success: boolean; service?: string; error?: string }> {
  if (braveSafeStorageUnlocked) {
    return { success: true, service: 'cached' };
  }

  const services = ['Brave Safe Storage', 'Brave Browser Safe Storage', 'Chromium Safe Storage'];
  let lastError = '';
  for (const service of services) {
    const result = await runSecurityFindPassword(service);
    if (result.success) {
      braveSafeStorageUnlocked = true;
      return { success: true, service };
    }
    lastError = result.error || lastError;
  }

  return { success: false, error: lastError || 'Brave Safe Storage was not available in Keychain.' };
}

function runSecurityFindPassword(service: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('security', ['find-generic-password', '-w', '-s', service], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ success: false, error: `Timed out while waiting for Keychain access to ${service}.` });
    }, 60_000);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ success: code === 0, error: code === 0 ? undefined : stderr.trim() || `security exited with code ${code}` });
    });
  });
}

function looksCookieBlocked(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes('login') || normalized.includes('cookies') || normalized.includes('private') || normalized.includes('forbidden');
}
