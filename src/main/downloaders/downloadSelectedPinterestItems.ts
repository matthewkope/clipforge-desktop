import { spawn } from 'node:child_process';
import type { DownloadProgress, GalleryDownloadRequest, MediaItem } from '../../shared/media.js';
import { classifyGalleryDlError } from './galleryDlAdapter.js';
import {
  defaultPinterestSafeModeSettings,
  effectivePinterestCookieSource,
  equivalentPinterestCommand,
  pinterestPythonExecutable,
  pinterestSpawnEnv,
  pinterestSelectedRangeArgs
} from './pinterestAdapter.js';
import { isPinterestRateLimitedOutput, markPinterest429, pinterestRateLimitMessage } from './pinterestRateLimiter.js';
import {
  readPinterestManifest,
  resolvePinterestManifestItems,
  updatePinterestManifest,
  type PinterestManifest
} from '../utils/mediaManifest.js';
import { logPinterestDebug } from '../utils/pinterestDebug.js';
import { buildRange } from '../utils/rangeBuilder.js';

interface SelectedPinterestResult {
  savedPaths: string[];
  failed: Array<{ item: MediaItem; reason: string }>;
}

export async function downloadSelectedPinterestItems(
  request: GalleryDownloadRequest,
  onProgress: (progress: DownloadProgress) => void,
  isCancelled: () => boolean
): Promise<SelectedPinterestResult> {
  if (!request.manifestId) {
    throw new Error('Pinterest selected downloads require a manifest.');
  }

  const manifest = await readPinterestManifest(request.manifestId);
  const settings = request.pinterestSettings ?? defaultPinterestSafeModeSettings();
  const effectiveRequest: GalleryDownloadRequest = {
    ...request,
    cookieSource: effectivePinterestCookieSource(manifest.cookieMode.cookieSource, manifest.cookieMode.cookieFilePath, settings),
    cookieFilePath: manifest.cookieMode.cookieFilePath,
    pinterestSettings: settings
  };
  const selectedIds = selectedIdsFromRequest(request, manifest);
  const selected = resolvePinterestManifestItems(manifest, selectedIds, request.retryFailed);
  const savedPaths: string[] = [];
  const failed: Array<{ item: MediaItem; reason: string }> = [];
  const selectedRange = buildRange(
    selected
      .map((item) => item.originalGalleryDlIndex ?? item.index)
      .filter((item): item is number => Number.isInteger(item) && item > 0)
  );

  if (!selected.length || !selectedRange) {
    throw new Error('Choose at least one Pinterest item to download.');
  }

  await logPinterestDebug('download:selected:start', {
    manifestId: request.manifestId,
    selectedItemIds: selected.map((item) => item.appItemId || item.id),
    selectedRange,
    sourceUrl: manifest.sourceUrl,
    archivePath: manifest.archivePath,
    cookieMode: manifest.cookieMode
  });

  selected.forEach((item) => updateItemStatus(manifest, item, 'downloading'));
  await updatePinterestManifest(manifest);
  onProgress({
    status: 'starting',
    percent: 0,
    percentText: '0%',
    message: `Pinterest: downloading ${selected.length} selected item(s) with range ${selectedRange}`
  });

  try {
    savedPaths.push(...(await downloadRangeWithGalleryDl(manifest, selectedRange, request.outputPath, effectiveRequest, onProgress, isCancelled)));
    selected.forEach((item) => updateItemStatus(manifest, item, 'downloaded'));
  } catch (caught) {
    const reason = errorMessage(caught);
    if (isPinterestRateLimitedOutput(reason)) {
      await markPinterest429({ manifestId: request.manifestId, phase: 'range-selected' });
      throw new Error(pinterestRateLimitMessage());
    }
    selected.forEach((item) => {
      updateItemStatus(manifest, item, classifyFailure(reason), reason);
      failed.push({ item, reason });
    });
    await logPinterestDebug('download:selected:failed', { manifestId: request.manifestId, selectedRange, reason });
  }

  await updatePinterestManifest(manifest);
  onProgress({
    status: failed.length > 0 ? 'processing' : 'finished',
    percent: 100,
    percentText: '100%',
    message: failed.length > 0 ? `Pinterest: ${failed.length} item(s) failed. The rest finished.` : 'Pinterest: selected items finished.'
  });

  return { savedPaths, failed };
}

async function downloadRangeWithGalleryDl(
  manifest: PinterestManifest,
  selectedRange: string,
  outputPath: string,
  request: GalleryDownloadRequest,
  onProgress: (progress: DownloadProgress) => void,
  isCancelled: () => boolean
): Promise<string[]> {
  const args = await pinterestSelectedRangeArgs(
    manifest.sourceUrl || manifest.normalizedSourceUrl,
    outputPath,
    selectedRange,
    request.cookieSource,
    request.cookieFilePath,
    request.pinterestSettings ?? defaultPinterestSafeModeSettings()
  );
  const command = pinterestPythonExecutable(request.pinterestSettings ?? defaultPinterestSafeModeSettings());
  await logPinterestDebug('download:selected:command', {
    args: redactArgs(args),
    equivalentCommand: equivalentPinterestCommand(command, args),
    selectedRange,
    archivePath: manifest.archivePath
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: pinterestSpawnEnv()
    });
    let output = '';
    const savedPaths: string[] = [];

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const filePath = galleryFilePath(line);
        if (filePath && !savedPaths.includes(filePath)) {
          savedPaths.push(filePath);
        }
        onProgress({
          status: 'downloading',
          message: line.trim(),
          filename: filePath
        });
      }
    };

    child.stdout.on('data', handleOutput);
    child.stderr.on('data', handleOutput);
    const cancelTimer = setInterval(() => {
      if (isCancelled()) {
        child.kill('SIGTERM');
      }
    }, 500);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearInterval(cancelTimer);
      if (isCancelled() || signal) {
        reject(new Error('Download cancelled.'));
        return;
      }
      if (code === 0) {
        void logPinterestDebug('download:selected:complete', {
          sourceUrl: manifest.sourceUrl,
          selectedRange,
          savedCount: savedPaths.length,
          outputTail: output.slice(-2000)
        });
        resolve(savedPaths);
        return;
      }
      void logPinterestDebug('download:selected:failed-process', {
        sourceUrl: manifest.sourceUrl,
        selectedRange,
        code,
        outputTail: output.slice(-4000)
      });
      if (isPinterestRateLimitedOutput(output)) {
        reject(new Error(pinterestRateLimitMessage()));
        return;
      }
      reject(new Error(classifyGalleryDlError(output)));
    });
  });
}

function selectedIdsFromRequest(request: GalleryDownloadRequest, manifest: PinterestManifest): string[] | undefined {
  if (request.selectedItemIds?.length) {
    return request.selectedItemIds;
  }
  if (!request.selectedItems?.length) {
    return undefined;
  }
  const selectedIndexes = new Set(request.selectedItems);
  return manifest.items.filter((item) => selectedIndexes.has(item.index)).map((item) => item.appItemId || item.id);
}

function updateItemStatus(manifest: PinterestManifest, item: MediaItem, status: MediaItem['status'], failureReason?: string): void {
  const target = manifest.items.find((candidate) => (candidate.appItemId || candidate.id) === (item.appItemId || item.id));
  if (target) {
    target.status = status;
    target.failureReason = failureReason;
  }
}

function classifyFailure(reason: string): MediaItem['status'] {
  const normalized = reason.toLowerCase();
  if (normalized.includes('private') || normalized.includes('login') || normalized.includes('cookie') || normalized.includes('forbidden')) {
    return 'failed_private';
  }
  if (normalized.includes('404') || normalized.includes('not found') || normalized.includes('unavailable')) {
    return 'failed_not_found';
  }
  if (normalized.includes('network') || normalized.includes('timeout') || normalized.includes('http')) {
    return 'failed_network';
  }
  return 'failed_unknown';
}

function galleryFilePath(line: string): string | undefined {
  const trimmed = line.trim();
  const match =
    trimmed.match(/(?:Downloading|Writing|Skipping|File exists):?\s+(.+)$/i) ||
    trimmed.match(/\[download\]\s+(.+)$/i) ||
    trimmed.match(/^\S+\s+(.+\.(?:jpe?g|png|webp|gif|mp4|mov|webm|m4v))$/i);
  const candidate = match?.[1]?.trim();
  if (!candidate || /^https?:\/\//i.test(candidate)) {
    return undefined;
  }
  return candidate;
}

function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => (args[index - 1] === '--cookies' ? '[cookies.txt]' : arg));
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
