import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { CookieSource, MediaItem } from '../../shared/media.js';
import { normalizePinterestUrl, slugifyPinterestValue } from './pinterestNormalize.js';

export interface PinterestManifest {
  manifestId: string;
  sourceUrl: string;
  normalizedSourceUrl: string;
  analyzedAt: string;
  cookieMode: {
    cookieSource?: CookieSource;
    cookieFilePath?: string;
  };
  itemCountRaw: number;
  itemCountFiltered: number;
  itemCountDeduped: number;
  duplicateCount: number;
  filteredOutCount: number;
  archivePath: string;
  items: MediaItem[];
}

export async function createPinterestManifest(input: Omit<PinterestManifest, 'manifestId' | 'analyzedAt'>): Promise<PinterestManifest> {
  const manifest: PinterestManifest = {
    ...input,
    manifestId: randomUUID(),
    analyzedAt: new Date().toISOString()
  };
  await fs.mkdir(pinterestManifestDirectory(), { recursive: true });
  await fs.writeFile(pinterestManifestPath(manifest.manifestId), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

export async function readPinterestManifest(manifestId: string): Promise<PinterestManifest> {
  const manifest = JSON.parse(await fs.readFile(pinterestManifestPath(manifestId), 'utf8')) as PinterestManifest;
  return manifest;
}

export async function updatePinterestManifest(manifest: PinterestManifest): Promise<void> {
  await fs.mkdir(pinterestManifestDirectory(), { recursive: true });
  await fs.writeFile(pinterestManifestPath(manifest.manifestId), JSON.stringify(manifest, null, 2), 'utf8');
}

export function resolvePinterestManifestItems(manifest: PinterestManifest, selectedAppItemIds?: string[], retryFailed = false): MediaItem[] {
  if (retryFailed) {
    return manifest.items.filter((item) => item.status?.startsWith('failed_'));
  }
  if (!selectedAppItemIds?.length) {
    return manifest.items;
  }
  const selected = new Set(selectedAppItemIds);
  return manifest.items.filter((item) => selected.has(item.appItemId || item.id));
}

export function pinterestArchivePath(sourceUrl?: string, outputPath?: string): string {
  const archiveDir = pinterestArchiveDirectory();
  const archiveName = sourceUrl ? pinterestArchiveName(sourceUrl, outputPath) : 'pinterest-archive.txt';
  return path.join(archiveDir, archiveName);
}

export function pinterestArchiveDirectory(): string {
  return path.join(app.getPath('userData'), 'archives', 'pinterest');
}

export async function resetPinterestArchive(sourceUrl: string): Promise<string> {
  const archiveDir = pinterestArchiveDirectory();
  const archivePath = pinterestArchivePath(sourceUrl);
  await fs.rm(archivePath, { force: true });
  const prefix = pinterestArchivePrefix(sourceUrl);
  if (prefix) {
    const entries = await fs.readdir(archiveDir).catch(() => []);
    await Promise.all(entries.filter((entry) => entry.startsWith(prefix)).map((entry) => fs.rm(path.join(archiveDir, entry), { force: true })));
  }
  return archivePath;
}

function pinterestManifestDirectory(): string {
  return path.join(app.getPath('userData'), 'manifests', 'pinterest');
}

function pinterestManifestPath(manifestId: string): string {
  return path.join(pinterestManifestDirectory(), `${manifestId}.json`);
}

function pinterestArchiveName(sourceUrl: string, outputPath?: string): string {
  const outputSuffix = outputPath ? `-${shortHash(path.resolve(outputPath))}` : '';
  try {
    const target = normalizePinterestUrl(sourceUrl);
    const owner = slugifyPinterestValue(target.owner);
    const board = slugifyPinterestValue(target.boardSlug);
    const section = slugifyPinterestValue(target.sectionSlug);
    if (owner && board) {
      return [owner, board, section].filter(Boolean).join('-') + `${outputSuffix}-archive.txt`;
    }
    if (target.pinId) {
      return `pin-${target.pinId}${outputSuffix}-archive.txt`;
    }
    return `pinterest-${shortHash(target.normalizedUrl)}${outputSuffix}-archive.txt`;
  } catch {
    return `pinterest-${shortHash(sourceUrl)}${outputSuffix}-archive.txt`;
  }
}

function pinterestArchivePrefix(sourceUrl: string): string | undefined {
  try {
    const target = normalizePinterestUrl(sourceUrl);
    const owner = slugifyPinterestValue(target.owner);
    const board = slugifyPinterestValue(target.boardSlug);
    const section = slugifyPinterestValue(target.sectionSlug);
    if (owner && board) {
      return [owner, board, section].filter(Boolean).join('-');
    }
    if (target.pinId) {
      return `pin-${target.pinId}`;
    }
    return `pinterest-${shortHash(target.normalizedUrl)}`;
  } catch {
    return `pinterest-${shortHash(sourceUrl)}`;
  }
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}
