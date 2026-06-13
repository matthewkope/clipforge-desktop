import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type {
  DownloadHistorySource,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  GalleryDownloadRequest,
  OutputType
} from '../shared/media.js';
import { buildDownloadArgs, buildWhisperAudioArgs, classifyYtDlpError } from './ytdlp.js';
import { buildGalleryDlDownloadArgs, classifyGalleryDlError } from './downloaders/galleryDlAdapter.js';
import { buildInstaloaderDownloadArgs } from './downloaders/instaloaderAdapter.js';
import { downloadSelectedPinterestItems } from './downloaders/downloadSelectedPinterestItems.js';
import { equivalentPinterestCommand, pinterestFullBoardArgs, pinterestPythonExecutable, pinterestSpawnEnv } from './downloaders/pinterestAdapter.js';
import {
  getPinterestRateLimitState,
  isPinterestRateLimitedOutput,
  markPinterest429,
  pinterestRateLimitMessage,
  resumePinterestQueueState,
  setPinterestActive,
  setPinterestPending
} from './downloaders/pinterestRateLimiter.js';
import { readPinterestManifest } from './utils/mediaManifest.js';
import { logPinterestDebug } from './utils/pinterestDebug.js';
import { convertVideoToGif, postprocessClip } from './clipPostprocess.js';
import { recordHistoryEntry, updateHistoryEntry } from './historyStore.js';
import { broadcast } from './utils/broadcast.js';
import { resolveToolPath } from './toolResolver.js';
import { runWhisperCpp } from './utils/whisper.js';

interface ActiveDownload {
  child?: ChildProcess;
  window: BrowserWindow;
  cancelled: boolean;
}

interface SubtitleCandidate {
  path: string;
  kind: 'manual' | 'automatic' | 'unknown';
}

interface QueuedVideoJob {
  downloadId: string;
  window: BrowserWindow;
  request: DownloadRequest;
}

const activeDownloads = new Map<string, ActiveDownload>();
const pinterestQueue: Array<{ downloadId: string; request: GalleryDownloadRequest }> = [];
let drainingPinterestQueue = false;
// General FIFO queue for yt-dlp video/audio downloads: up to
// `videoConcurrency` jobs run at a time (default 1, max 3), the rest wait.
// Batch paste and extension clips enqueue here freely.
const videoQueue: QueuedVideoJob[] = [];
const activeVideoJobs = new Map<string, QueuedVideoJob>();
let videoConcurrency = 1;

export function setDownloadConcurrency(n: number): void {
  const clamped = Math.min(3, Math.max(1, Math.round(n) || 1));
  videoConcurrency = clamped;
  void drainVideoQueue();
}

export function startDownload(
  window: BrowserWindow,
  request: DownloadRequest,
  source: DownloadHistorySource = 'app'
): { downloadId: string } {
  const downloadId = randomUUID();
  activeDownloads.set(downloadId, { window, cancelled: false });
  void recordHistoryEntry({
    id: downloadId,
    url: request.url,
    title: request.mediaTitle,
    thumbnail: request.mediaThumbnail,
    label: outputTypesLabel(request),
    outputPath: request.outputPath,
    status: 'queued',
    savedPaths: [],
    source,
    createdAt: new Date().toISOString()
  });
  videoQueue.push({ downloadId, window, request });
  broadcastQueueState();
  void drainVideoQueue();
  return { downloadId };
}

export function startBatchDownload(
  window: BrowserWindow,
  urls: string[],
  baseRequest: Omit<DownloadRequest, 'url'>
): { queued: number } {
  let queued = 0;
  for (const url of urls) {
    try {
      startDownload(window, { ...baseRequest, url }, 'batch');
      queued += 1;
    } catch {
      // Skip URLs that fail validation; the rest of the batch still queues.
    }
  }
  return { queued };
}

export function startGalleryDownload(window: BrowserWindow, request: GalleryDownloadRequest): { downloadId: string } {
  const downloadId = randomUUID();
  activeDownloads.set(downloadId, { window, cancelled: false });
  void recordHistoryEntry({
    id: downloadId,
    url: request.url,
    thumbnail: request.thumbnail,
    label: `${request.platform} gallery`,
    outputPath: request.outputPath,
    status: 'downloading',
    savedPaths: [],
    source: 'gallery',
    createdAt: new Date().toISOString()
  });
  if (request.platform === 'pinterest') {
    pinterestQueue.push({ downloadId, request });
    setPinterestPending(pinterestQueue.length);
    void drainPinterestQueue();
  } else {
    void runGalleryDownload(downloadId, request);
  }
  return { downloadId };
}

export async function resumePinterestQueue(): Promise<void> {
  await resumePinterestQueueState();
  void drainPinterestQueue();
}

export function cancelDownload(downloadId: string): void {
  const active = activeDownloads.get(downloadId);
  if (!active) {
    return;
  }

  active.cancelled = true;
  active.child?.kill('SIGTERM');
  const queuedIndex = pinterestQueue.findIndex((job) => job.downloadId === downloadId);
  if (queuedIndex >= 0) {
    pinterestQueue.splice(queuedIndex, 1);
    setPinterestPending(pinterestQueue.length);
  }
  const videoQueueIndex = videoQueue.findIndex((job) => job.downloadId === downloadId);
  if (videoQueueIndex >= 0) {
    videoQueue.splice(videoQueueIndex, 1);
    activeDownloads.delete(downloadId);
    void updateHistoryEntry(downloadId, {
      status: 'cancelled',
      error: 'Cancelled before starting.',
      completedAt: new Date().toISOString()
    });
    broadcastQueueState();
  }
}

export function cancelAllDownloads(): void {
  for (const job of [...videoQueue]) {
    cancelDownload(job.downloadId);
  }
  for (const downloadId of [...activeVideoJobs.keys()]) {
    cancelDownload(downloadId);
  }
}

async function drainVideoQueue(): Promise<void> {
  while (activeVideoJobs.size < videoConcurrency && videoQueue.length > 0) {
    const job = videoQueue.shift();
    if (!job) {
      break;
    }
    activeVideoJobs.set(job.downloadId, job);
    void runVideoJob(job);
  }
  broadcastQueueState();
}

async function runVideoJob(job: QueuedVideoJob): Promise<void> {
  try {
    // Fail fast before yt-dlp even starts when the target volume is nearly
    // full; the failure flows through the normal error/history path.
    const spaceError = await diskSpaceError(job.request.outputPath);
    if (spaceError) {
      failVideoJob(job, spaceError);
      return;
    }
    void updateHistoryEntry(job.downloadId, { status: 'downloading' });
    await runDownloadQueue(job.downloadId, job.request);
  } finally {
    activeVideoJobs.delete(job.downloadId);
    void drainVideoQueue();
  }
}

const minimumFreeDiskBytes = 500 * 1024 * 1024;

async function diskSpaceError(outputPath: string): Promise<string | null> {
  try {
    const stats = await fs.statfs(outputPath);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (freeBytes < minimumFreeDiskBytes) {
      return 'Not enough free disk space in the download folder (less than 500 MB available).';
    }
  } catch {
    // The folder may not exist yet or statfs may be unsupported; let yt-dlp
    // surface any real problem instead of blocking the download here.
  }
  return null;
}

// Mirrors runDownloadQueue's error path for jobs that fail before starting.
function failVideoJob(job: QueuedVideoJob, error: string): void {
  const active = activeDownloads.get(job.downloadId);
  activeDownloads.delete(job.downloadId);
  if (active) {
    sendProgress(active.window, { status: 'error', message: error });
    sendComplete(active.window, { success: false, error });
  }
  void updateHistoryEntry(job.downloadId, {
    status: 'error',
    error,
    completedAt: new Date().toISOString()
  });
}

function broadcastQueueState(): void {
  const firstActive = activeVideoJobs.values().next().value as QueuedVideoJob | undefined;
  broadcast('download:queue', {
    activeDownloadId: firstActive?.downloadId ?? null,
    activeUrl: firstActive?.request.url,
    pendingCount: videoQueue.length,
    activeCount: activeVideoJobs.size
  });
}

function outputTypesLabel(request: DownloadRequest): string {
  const formats = request.outputTypes.length > 0 ? request.outputTypes : ['mp4'];
  const base = formats.map((format) => format.toUpperCase()).join(' + ');
  return request.clipRange ? `${base} clip` : base;
}

async function drainPinterestQueue(): Promise<void> {
  if (drainingPinterestQueue || getPinterestRateLimitState().paused) {
    return;
  }

  drainingPinterestQueue = true;
  setPinterestActive(true);
  try {
    while (pinterestQueue.length > 0 && !getPinterestRateLimitState().paused) {
      const job = pinterestQueue.shift();
      setPinterestPending(pinterestQueue.length);
      if (job) {
        await runGalleryDownload(job.downloadId, job.request);
      }
    }
  } finally {
    drainingPinterestQueue = false;
    setPinterestActive(false);
    setPinterestPending(pinterestQueue.length);
  }
}

async function runDownloadQueue(downloadId: string, request: DownloadRequest): Promise<void> {
  const active = activeDownloads.get(downloadId);
  if (!active) {
    return;
  }

  const savedPaths: string[] = [];
  const outputs = orderedOutputs(request.outputTypes.length > 0 ? request.outputTypes : ['mp4' as OutputType]);

  sendProgress(active.window, {
    status: 'starting',
    message: `Starting ${outputs.length} output${outputs.length === 1 ? '' : 's'}...`
  });

  try {
    for (const [index, outputType] of outputs.entries()) {
      if (active.cancelled) {
        throw new Error('Download cancelled.');
      }

      sendProgress(active.window, {
        status: 'starting',
        message: `Starting ${outputLabel(outputType)} (${index + 1}/${outputs.length})...`
      });

      if (outputType === 'gif' && (!request.clipRange || request.clipRange.end - request.clipRange.start > 30)) {
        throw new Error('GIF export is limited to clips of 30 seconds or less.');
      }

      const result =
        outputType === 'markdown'
          ? await runMarkdownTranscript(downloadId, request, index, outputs.length)
          : outputType === 'timed-transcript'
            ? await runTimedTranscript(downloadId, request, index, outputs.length)
          : await runSingleDownload(downloadId, request, outputType, index, outputs.length);
      const finalResultPaths =
        outputType === 'gif'
          ? await convertGifPaths(result.savedPaths, active.window)
          : (outputType === 'mp4' || outputType === 'webm') && (request.clipCrop || request.burnCaptions)
            ? await postprocessVideoPaths(request, result.savedPaths, active.window)
            : result.savedPaths;
      savedPaths.push(...finalResultPaths);
    }

    activeDownloads.delete(downloadId);
    const uniquePaths = await finalSavedPaths(savedPaths);
    sendProgress(active.window, {
      status: 'finished',
      percent: 100,
      percentText: '100%',
      message: `Finished ${uniquePaths.length} file${uniquePaths.length === 1 ? '' : 's'}.`,
      savedPath: uniquePaths[0],
      filename: uniquePaths[0]
    });
    sendComplete(active.window, { success: true, savedPath: uniquePaths[0], savedPaths: uniquePaths });
    void updateHistoryEntry(downloadId, {
      status: 'finished',
      savedPaths: uniquePaths,
      completedAt: new Date().toISOString()
    });
  } catch (caught) {
    activeDownloads.delete(downloadId);
    const error = caught instanceof Error ? classifyYtDlpError(caught.message) : 'Download failed.';
    const cancelled = error.toLowerCase().includes('cancelled');
    sendProgress(active.window, {
      status: cancelled ? 'cancelled' : 'error',
      message: error
    });
    sendComplete(active.window, { success: false, error });
    void updateHistoryEntry(downloadId, {
      status: cancelled ? 'cancelled' : 'error',
      error,
      completedAt: new Date().toISOString()
    });
  }
}

async function runGalleryDownload(downloadId: string, request: GalleryDownloadRequest): Promise<void> {
  const active = activeDownloads.get(downloadId);
  if (!active) {
    return;
  }

  // Completion funnel: notify the renderer and keep the history entry in sync.
  const complete = (result: DownloadResult) => {
    sendComplete(active.window, result);
    void updateHistoryEntry(downloadId, {
      status: result.success ? 'finished' : result.error?.toLowerCase().includes('cancelled') ? 'cancelled' : 'error',
      error: result.success ? undefined : result.error,
      savedPaths: result.savedPaths ?? (result.savedPath ? [result.savedPath] : []),
      completedAt: new Date().toISOString()
    });
  };

  if (request.platform === 'pinterest' && getPinterestRateLimitState().paused) {
    const message = pinterestRateLimitMessage();
    sendProgress(active.window, { status: 'error', message });
    complete({ success: false, error: message });
    return;
  }

  if (request.platform === 'pinterest' && request.manifestId && (request.selectedItemIds?.length || request.selectedItems?.length || request.retryFailed)) {
    try {
      const result = await downloadSelectedPinterestItems(
        request,
        (progress) => sendProgress(active.window, progress),
        () => active.cancelled
      );
      activeDownloads.delete(downloadId);
      const failedItems = result.failed.map(({ item, reason }) => ({ id: item.appItemId || item.id, label: item.pinId || item.filename, reason }));
      complete({
        success: result.savedPaths.length > 0 || failedItems.length === 0,
        savedPath: result.savedPaths[0],
        savedPaths: result.savedPaths,
        failedItems,
        error: failedItems.length > 0 ? `${failedItems.length} Pinterest item(s) failed.` : undefined
      });
    } catch (caught) {
      activeDownloads.delete(downloadId);
      const error = caught instanceof Error ? caught.message : 'Pinterest selected download failed.';
      if (request.platform === 'pinterest' && isPinterestRateLimitedOutput(error)) {
        await markPinterest429({ downloadId, mode: 'selected' });
      }
      sendProgress(active.window, { status: error.toLowerCase().includes('cancelled') ? 'cancelled' : 'error', message: error });
      complete({ success: false, error });
    }
    return;
  }

  sendProgress(active.window, {
    status: 'starting',
    message: request.selectedItems?.length ? `Downloading ${request.selectedItems.length} selected item(s)...` : 'Downloading all gallery media...'
  });

  const command =
    request.platform === 'pinterest'
      ? pinterestPythonExecutable(request.pinterestSettings)
      : request.tool === 'instaloader'
        ? resolveToolPath('instaloader')
        : request.tool === 'yt-dlp'
          ? resolveToolPath('yt-dlp')
          : resolveToolPath('gallery-dl');
  const args = await galleryCommandArgs(request);
  if (request.platform === 'pinterest') {
    await logPinterestDebug('download:full:start', {
      url: request.url,
      selectedCount: request.selectedItems?.length ?? 0,
      args: redactArgs(args),
      equivalentCommand: equivalentPinterestCommand(command, args),
      safeMode: request.pinterestSettings,
      cookieMode: request.cookieFilePath ? 'cookies.txt' : request.cookieSource
    });
  }
  const spawnEnv = request.platform === 'pinterest'
    ? pinterestSpawnEnv()
    : process.env;
  const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv });
  let combinedOutput = '';
  const savedPaths: string[] = [];

  active.child = child;

  const handleOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    combinedOutput += text;
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      const progress = request.tool === 'yt-dlp' ? parseProgressLine(line) : null;
      const filePath = progress?.filename || galleryFilePath(line);
      if (filePath && !savedPaths.includes(filePath)) {
        savedPaths.push(filePath);
      }
      sendProgress(active.window, {
        ...(progress ?? { status: 'downloading' as const, message: line.trim() }),
        filename: filePath
      });
    }
  };

  child.stdout?.on('data', handleOutput);
  child.stderr?.on('data', handleOutput);

  return new Promise((resolve) => {
    child.on('error', (error) => {
      activeDownloads.delete(downloadId);
      if (request.platform === 'pinterest') {
        void logPinterestDebug('download:spawn-error', {
          url: request.url,
          error: error.message
        });
      }
      if (request.platform === 'pinterest' && isPinterestRateLimitedOutput(error.message)) {
        void markPinterest429({ downloadId, mode: 'spawn-error', error: error.message });
      }
      const message = request.platform === 'pinterest' && isPinterestRateLimitedOutput(error.message) ? pinterestRateLimitMessage() : classifyGalleryDlError(error.message);
      sendProgress(active.window, { status: 'error', message });
      complete({ success: false, error: message });
      resolve();
    });

    child.on('close', (code, signal) => {
      active.child = undefined;
      activeDownloads.delete(downloadId);

      if (active.cancelled || signal || code === null) {
        sendProgress(active.window, { status: 'cancelled', message: 'Download cancelled.' });
        complete({ success: false, error: 'Download cancelled.' });
        resolve();
        return;
      }

      if (code !== 0) {
        if (request.platform === 'pinterest') {
          void logPinterestDebug('download:full:failed', {
            url: request.url,
            code,
            outputTail: combinedOutput.slice(-4000)
          });
        }
        if (request.platform === 'pinterest' && isPinterestRateLimitedOutput(combinedOutput)) {
          const message = pinterestRateLimitMessage();
          void markPinterest429({ downloadId, mode: 'full-board', output: combinedOutput.slice(-1000) });
          sendProgress(active.window, { status: 'error', message });
          complete({ success: false, error: message });
          resolve();
          return;
        }
        const message = request.tool === 'yt-dlp' ? classifyYtDlpError(combinedOutput) : classifyGalleryDlError(combinedOutput);
        sendProgress(active.window, { status: 'error', message });
        complete({ success: false, error: message });
        resolve();
        return;
      }

      sendProgress(active.window, {
        status: 'finished',
        percent: 100,
        percentText: '100%',
        message: `Finished ${savedPaths.length || 'gallery'} file${savedPaths.length === 1 ? '' : 's'}.`,
        savedPath: savedPaths[0],
        filename: savedPaths[0]
      });
      if (request.platform === 'pinterest') {
        void logPinterestDebug('download:full:complete', {
          url: request.url,
          savedCount: savedPaths.length,
          outputTail: combinedOutput.slice(-2000)
        });
      }
      complete({ success: true, savedPath: savedPaths[0], savedPaths });
      resolve();
    });
  });
}

async function runMarkdownTranscript(
  downloadId: string,
  request: DownloadRequest,
  outputIndex: number,
  outputCount: number
): Promise<{ savedPaths: string[] }> {
  if (request.captionsAvailable) {
    try {
      return await runCaptionMarkdown(downloadId, request, outputIndex, outputCount);
    } catch (caught) {
      if (request.isPlaylist) {
        throw caught;
      }
    }
  }

  if (request.isPlaylist) {
    throw new Error('No source captions were found for Markdown transcript generation.');
  }

  return runWhisperMarkdown(downloadId, request, outputIndex, outputCount);
}

async function runTimedTranscript(
  downloadId: string,
  request: DownloadRequest,
  outputIndex: number,
  outputCount: number
): Promise<{ savedPaths: string[] }> {
  if (request.captionsAvailable) {
    try {
      return await runSourceTimedTranscript(downloadId, request, outputIndex, outputCount);
    } catch (caught) {
      if (request.isPlaylist) {
        throw caught;
      }
    }
  }

  if (request.isPlaylist) {
    throw new Error('No source captions were found for timestamped transcript generation.');
  }

  return runWhisperTimedTranscript(downloadId, request, outputIndex, outputCount);
}

async function runCaptionMarkdown(
  downloadId: string,
  request: DownloadRequest,
  outputIndex: number,
  outputCount: number
): Promise<{ savedPaths: string[] }> {
  const result = await runSingleDownload(downloadId, request, 'markdown', outputIndex, outputCount);
  const subtitlePaths = result.savedPaths.filter((savedPath) => /\.(?:srt|vtt)$/i.test(savedPath));
  const selectedSubtitlePaths = selectSubtitlePaths(subtitlePaths);
  if (selectedSubtitlePaths.length === 0) {
    throw new Error('No source captions were found for Markdown transcript generation.');
  }
  const markdownPaths = await Promise.all(selectedSubtitlePaths.map((subtitlePath) => createMarkdownTranscript(subtitlePath, request)));

  if (!request.outputTypes.includes('subtitles')) {
    await Promise.all(subtitlePaths.map((subtitlePath) => removeTemporaryFile(subtitlePath)));
  }

  return {
    savedPaths: markdownPaths
  };
}

async function runSourceTimedTranscript(
  downloadId: string,
  request: DownloadRequest,
  outputIndex: number,
  outputCount: number
): Promise<{ savedPaths: string[] }> {
  const result = await runSingleDownload(downloadId, request, 'timed-transcript', outputIndex, outputCount);
  const subtitlePaths = result.savedPaths.filter((savedPath) => /\.(?:srt|vtt)$/i.test(savedPath));
  const selectedSubtitlePaths = selectSubtitlePaths(subtitlePaths);
  if (selectedSubtitlePaths.length === 0) {
    throw new Error('No source captions were found for timestamped transcript generation.');
  }

  const unselected = subtitlePaths.filter((subtitlePath) => !selectedSubtitlePaths.includes(subtitlePath));
  await Promise.all(unselected.map((subtitlePath) => removeTemporaryFile(subtitlePath)));
  return { savedPaths: selectedSubtitlePaths };
}

async function runWhisperMarkdown(
  downloadId: string,
  request: DownloadRequest,
  outputIndex: number,
  outputCount: number
): Promise<{ savedPaths: string[] }> {
  const transcript = await runWhisperTranscript(downloadId, request, outputIndex, outputCount);
  const markdownPath = await createMarkdownTranscript(transcript.srtPath, request);
  if (!request.outputTypes.includes('wav')) {
    await removeTemporaryFile(transcript.audioPath);
  }
  if (!request.outputTypes.includes('timed-transcript')) {
    await removeTemporaryFile(transcript.srtPath);
  }
  return { savedPaths: [markdownPath] };
}

async function runWhisperTimedTranscript(
  downloadId: string,
  request: DownloadRequest,
  outputIndex: number,
  outputCount: number
): Promise<{ savedPaths: string[] }> {
  const transcript = await runWhisperTranscript(downloadId, request, outputIndex, outputCount);
  if (!request.outputTypes.includes('wav')) {
    await removeTemporaryFile(transcript.audioPath);
  }
  return { savedPaths: [transcript.srtPath] };
}

function runSingleDownload(
  downloadId: string,
  request: DownloadRequest,
  outputType: OutputType,
  outputIndex: number,
  outputCount: number
): Promise<{ savedPaths: string[] }> {
  const active = activeDownloads.get(downloadId);
  if (!active) {
    return Promise.reject(new Error('Download cancelled.'));
  }

  const args = buildDownloadArgs(request, outputType);
  const child = spawn(resolveToolPath('yt-dlp'), args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let combinedOutput = '';
  let lastFilename = '';
  const savedPaths: string[] = [];

  active.child = child;

  const handleOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    combinedOutput += text;
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      const progress = parseProgressLine(line);
      if (progress.filename) {
        lastFilename = progress.filename;
        if (!savedPaths.includes(progress.filename)) {
          savedPaths.push(progress.filename);
        }
      }
      const scaledPercent = scalePercent(progress.percent, outputIndex, outputCount);
      sendProgress(active.window, {
        ...progress,
        percent: scaledPercent,
        percentText: scaledPercent !== undefined ? `${Math.round(scaledPercent)}%` : progress.percentText,
        message: progress.message ? `${outputLabel(outputType)}: ${progress.message}` : undefined
      });
    }
  };

  child.stdout?.on('data', handleOutput);
  child.stderr?.on('data', handleOutput);

  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      reject(new Error(classifyYtDlpError(error.message)));
    });

    child.on('close', async (code, signal) => {
      active.child = undefined;
      if (active.cancelled || signal || code === null) {
        reject(new Error('Download cancelled.'));
        return;
      }

      if (code !== 0) {
        reject(new Error(classifyYtDlpError(combinedOutput)));
        return;
      }

      if (lastFilename && !savedPaths.includes(lastFilename)) {
        savedPaths.push(lastFilename);
      }

      const subtitleCandidates = findSubtitleCandidates(combinedOutput);
      for (const candidate of subtitleCandidates) {
        if (!savedPaths.includes(candidate.path)) {
          savedPaths.push(candidate.path);
        }
      }

      // Remove intermediate format fragments (e.g. video.f399.mp4, audio.f251.webm)
      // that yt-dlp downloads then deletes after merging. The merged output was
      // already captured from the [Merger]/[ExtractAudio] lines above.
      const finalPaths = await finalSavedPaths(savedPaths);
      resolve({ savedPaths: finalPaths });
    });
  });
}

// Converts the intermediate 480p MP4 a GIF download produced into the final
// .gif (deleting the MP4); non-video side files pass through untouched.
async function convertGifPaths(paths: string[], window: BrowserWindow): Promise<string[]> {
  const processed: string[] = [];
  for (const savedPath of paths) {
    if (/\.(?:mp4|webm|mov|mkv)$/i.test(savedPath)) {
      sendProgress(window, { status: 'processing', message: 'GIF: converting clip with ffmpeg palette...' });
      processed.push(await convertVideoToGif(savedPath));
    } else {
      processed.push(savedPath);
    }
  }
  return processed;
}

// Runs the ffmpeg crop/caption pass over downloaded video files; non-video
// side outputs (e.g. caption files yt-dlp also wrote) pass through untouched.
async function postprocessVideoPaths(request: DownloadRequest, paths: string[], window: BrowserWindow): Promise<string[]> {
  const processed: string[] = [];
  for (const savedPath of paths) {
    if (/\.(?:mp4|webm|mov|mkv)$/i.test(savedPath)) {
      processed.push(
        await postprocessClip({
          request,
          inputPath: savedPath,
          onProgress: (message) => sendProgress(window, { status: 'processing', message })
        })
      );
    } else {
      processed.push(savedPath);
    }
  }
  return processed;
}

async function finalSavedPaths(paths: string[]): Promise<string[]> {
  const candidates = [...new Set(paths)].filter((filePath) => !isIntermediateDownloadPath(filePath));
  const existing: string[] = [];

  for (const filePath of candidates) {
    if (await fileExists(filePath)) {
      existing.push(filePath);
    }
  }

  return existing;
}

function isIntermediateDownloadPath(filePath: string): boolean {
  return (
    /\.f\d+\.[a-z0-9]+$/iu.test(filePath) ||
    /\.(?:part|ytdl)$/iu.test(filePath) ||
    /\.temp\.[a-z0-9]+$/iu.test(filePath) ||
    /\.orig\.[a-z0-9]+$/iu.test(filePath)
  );
}

async function runWhisperTranscript(
  downloadId: string,
  request: DownloadRequest,
  outputIndex: number,
  outputCount: number
): Promise<{ audioPath: string; srtPath: string }> {
  if (request.isPlaylist) {
    throw new Error('whisper.cpp fallback is only available for single videos for now.');
  }

  const active = activeDownloads.get(downloadId);
  if (!active) {
    throw new Error('Download cancelled.');
  }

  sendProgress(active.window, {
    status: 'starting',
    message: 'Transcript: extracting audio for whisper.cpp...'
  });

  const audioPath = await runAudioExtraction(downloadId, request, outputIndex, outputCount);
  if (active.cancelled) {
    throw new Error('Download cancelled.');
  }

  sendProgress(active.window, {
    status: 'processing',
    message: 'Transcript: running whisper.cpp...'
  });

  const srtPath = await runWhisperCppForDownload(downloadId, audioPath, request);
  return { audioPath, srtPath };
}

function runAudioExtraction(
  downloadId: string,
  request: DownloadRequest,
  outputIndex: number,
  outputCount: number
): Promise<string> {
  const active = activeDownloads.get(downloadId);
  if (!active) {
    return Promise.reject(new Error('Download cancelled.'));
  }

  const args = buildWhisperAudioArgs(request);
  const child = spawn(resolveToolPath('yt-dlp'), args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let combinedOutput = '';
  let lastFilename = '';

  active.child = child;

  const handleOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    combinedOutput += text;
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      const progress = parseProgressLine(line);
      const audioPath = findAudioPath(line);
      if (audioPath) {
        lastFilename = audioPath;
      } else if (progress.filename) {
        lastFilename = progress.filename;
      }
      const scaledPercent = scalePercent(progress.percent, outputIndex, outputCount);
      sendProgress(active.window, {
        ...progress,
        percent: scaledPercent,
        percentText: scaledPercent !== undefined ? `${Math.round(scaledPercent)}%` : progress.percentText,
        message: progress.message ? `Transcript audio: ${progress.message}` : undefined
      });
    }
  };

  child.stdout?.on('data', handleOutput);
  child.stderr?.on('data', handleOutput);

  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      reject(new Error(classifyYtDlpError(error.message)));
    });

    child.on('close', (code, signal) => {
      active.child = undefined;
      if (active.cancelled || signal || code === null) {
        reject(new Error('Download cancelled.'));
        return;
      }

      if (code !== 0) {
        reject(new Error(classifyYtDlpError(combinedOutput)));
        return;
      }

      const audioPath = findAudioPath(combinedOutput) || lastFilename;
      if (!audioPath) {
        reject(new Error('Could not find the WAV file extracted for whisper.cpp.'));
        return;
      }

      resolve(audioPath);
    });
  });
}

// Runs whisper.cpp via the shared utility, wiring its child process and
// progress lines into this download's cancellation/progress plumbing.
async function runWhisperCppForDownload(downloadId: string, audioPath: string, request: DownloadRequest): Promise<string> {
  const active = activeDownloads.get(downloadId);
  if (!active) {
    return Promise.reject(new Error('Download cancelled.'));
  }

  try {
    return await runWhisperCpp({
      audioPath,
      modelPath: request.whisperModelPath,
      onChild: (child) => {
        active.child = child;
      },
      onProgressLine: (line) => {
        sendProgress(active.window, {
          status: 'processing',
          message: `whisper.cpp: ${line}`
        });
      },
      isCancelled: () => active.cancelled
    });
  } finally {
    active.child = undefined;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sendProgress(window: BrowserWindow, progress: DownloadProgress): void {
  if (!window.isDestroyed()) {
    window.webContents.send('download:progress', progress);
  }
}

function sendComplete(window: BrowserWindow, result: DownloadResult): void {
  if (!window.isDestroyed()) {
    window.webContents.send('download:complete', result);
  }
}

function parseProgressLine(line: string): DownloadProgress {
  if (line.startsWith('download:')) {
    const [, payload] = line.split('download:', 2);
    const [status, percentText, speed, eta, filename] = payload.split('|');
    const percent = Number.parseFloat((percentText || '').replace('%', '').trim());
    return {
      status: status === 'finished' ? 'processing' : 'downloading',
      percent: Number.isFinite(percent) ? percent : undefined,
      percentText: cleanField(percentText),
      speed: cleanField(speed),
      eta: cleanField(eta),
      filename: cleanField(filename),
      message: status === 'finished' ? 'Processing downloaded file...' : 'Downloading...'
    };
  }

  if (line.includes('[Merger]')) {
    const match = line.match(/\[Merger\] Merging formats into "(.+?)"/u);
    return { status: 'processing', message: line.trim(), filename: match?.[1]?.trim() };
  }

  if (line.includes('[ExtractAudio]')) {
    const match = line.match(/\[ExtractAudio\] Destination: (.+)/u);
    return { status: 'processing', message: line.trim(), filename: match?.[1]?.trim() };
  }

  if (line.includes('[download] Destination:')) {
    return {
      status: 'downloading',
      message: line.trim(),
      filename: line.replace('[download] Destination:', '').trim()
    };
  }

  return { status: 'downloading', message: line.trim() };
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

function buildYtDlpGeneralArgs(request: GalleryDownloadRequest): string[] {
  return [
    ...ytDlpCookieArgs(request),
    '--no-playlist',
    '--newline',
    '-f',
    'bv*+ba/b',
    '--merge-output-format',
    'mp4',
    '-o',
    `${request.outputPath}/%(title)s.%(ext)s`,
    '--progress-template',
    'download:%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.filename)s',
    '--',
    request.url
  ];
}

async function galleryCommandArgs(request: GalleryDownloadRequest): Promise<string[]> {
  if (request.tool === 'instaloader') {
    return buildInstaloaderDownloadArgs(request);
  }
  if (request.tool === 'yt-dlp') {
    return buildYtDlpGeneralArgs(request);
  }
  if (request.platform === 'pinterest') {
    if (request.manifestId) {
      const manifest = await readPinterestManifest(request.manifestId);
      return pinterestFullBoardArgs(
        manifest.sourceUrl || manifest.normalizedSourceUrl,
        request.outputPath,
        manifest.cookieMode.cookieSource,
        manifest.cookieMode.cookieFilePath,
        request.pinterestSettings
      );
    }
    return pinterestFullBoardArgs(request.url, request.outputPath, request.cookieSource, request.cookieFilePath, request.pinterestSettings);
  }
  return buildGalleryDlDownloadArgs(request);
}

function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => (args[index - 1] === '--cookies' ? '[cookies.txt]' : arg));
}

function ytDlpCookieArgs(request: GalleryDownloadRequest): string[] {
  if (request.cookieFilePath) {
    return ['--cookies', request.cookieFilePath];
  }
  if (!request.cookieSource || request.cookieSource === 'none') {
    return [];
  }
  return ['--cookies-from-browser', request.cookieSource];
}

function cleanField(value?: string): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned || cleaned === 'NA' || cleaned === 'N/A') {
    return undefined;
  }
  return cleaned;
}

function scalePercent(percent: number | undefined, outputIndex: number, outputCount: number): number | undefined {
  if (percent === undefined) {
    return undefined;
  }
  return ((outputIndex + percent / 100) / outputCount) * 100;
}

function outputLabel(outputType: OutputType): string {
  const labels: Record<OutputType, string> = {
    mp4: 'MP4',
    mp3: 'MP3',
    wav: 'WAV',
    m4a: 'M4A',
    webm: 'WEBM',
    gif: 'GIF',
    subtitles: 'SRT captions',
    'timed-transcript': 'Timed transcript',
    markdown: 'Markdown transcript'
  };
  return labels[outputType];
}

function orderedOutputs(outputTypes: OutputType[]): OutputType[] {
  const videoOutputs: OutputType[] = ['webm', 'mp4', 'gif'];
  const selectedVideoOutputs = videoOutputs.filter((outputType) => outputTypes.includes(outputType));
  const nonVideoOutputs = outputTypes.filter((outputType) => !videoOutputs.includes(outputType));
  return [...nonVideoOutputs, ...selectedVideoOutputs];
}

function findSubtitleCandidates(output: string): SubtitleCandidate[] {
  const candidates: SubtitleCandidate[] = [];
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/(?:Writing video subtitles to:|Writing automatic captions to:|Destination:)\s(.+\.(?:srt|vtt))/i);
    const subtitlePath = match?.[1]?.trim();
    if (subtitlePath && !candidates.some((candidate) => candidate.path === subtitlePath)) {
      candidates.push({
        path: subtitlePath,
        kind: line.includes('Writing video subtitles to:') ? 'manual' : line.includes('Writing automatic captions to:') ? 'automatic' : 'unknown'
      });
    }
  }
  return candidates;
}

function selectSubtitlePaths(subtitlePaths: string[]): string[] {
  const candidates = subtitlePaths.map((subtitlePath) => ({ path: subtitlePath, kind: captionKindFromPath(subtitlePath) }));
  const groups = new Map<string, SubtitleCandidate[]>();

  for (const candidate of candidates) {
    const key = subtitleBaseKey(candidate.path);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  return Array.from(groups.values())
    .map((group) => group.sort(compareSubtitleCandidates)[0]?.path)
    .filter((subtitlePath): subtitlePath is string => Boolean(subtitlePath))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function compareSubtitleCandidates(a: SubtitleCandidate, b: SubtitleCandidate): number {
  return subtitlePriority(a) - subtitlePriority(b) || a.path.length - b.path.length || a.path.localeCompare(b.path);
}

function subtitlePriority(candidate: SubtitleCandidate): number {
  if (candidate.kind === 'manual') {
    return 0;
  }
  if (candidate.kind === 'unknown') {
    return 1;
  }
  return 2;
}

function captionKindFromPath(subtitlePath: string): SubtitleCandidate['kind'] {
  return /\.(?:auto|automatic|asr|orig)\./i.test(subtitlePath) || /(?:-auto|-orig)\.(?:srt|vtt)$/i.test(subtitlePath) ? 'automatic' : 'unknown';
}

function subtitleBaseKey(subtitlePath: string): string {
  return removeSubtitleLanguageSuffix(subtitlePath.replace(/\.(?:srt|vtt)$/i, '')).toLowerCase();
}

function findAudioPath(output: string): string | undefined {
  const lines = output.split(/\r?\n/).reverse();

  for (const line of lines) {
    const match = line.match(/\[ExtractAudio\]\s+Destination:\s+(.+\.wav)\s*$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  for (const line of lines) {
    if (/Deleting original file/i.test(line)) {
      continue;
    }

    const match = line.match(/Destination:\s+(.+\.wav)\s*$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

async function createMarkdownTranscript(subtitlePath: string | undefined, request: DownloadRequest): Promise<string> {
  if (!subtitlePath) {
    throw new Error('Could not find a downloaded caption file to convert into Markdown.');
  }

  const subtitle = await fs.readFile(subtitlePath, 'utf8');
  const markdown = subtitleToMarkdown(subtitle);
  if (!markdown) {
    throw new Error('The downloaded captions were empty, so no Markdown transcript could be created.');
  }

  const markdownPath = markdownPathForSubtitle(subtitlePath, request);
  await fs.writeFile(markdownPath, markdown, 'utf8');
  return markdownPath;
}

function markdownPathForSubtitle(subtitlePath: string, request: DownloadRequest): string {
  const directory = path.dirname(subtitlePath);
  const withoutExtension = subtitlePath.replace(/\.(?:srt|vtt)$/i, '');
  const baseName = path.basename(removeSubtitleLanguageSuffix(withoutExtension));
  return path.join(directory, `${baseName}.${transcriptLanguage(request)}.md`);
}

function removeSubtitleLanguageSuffix(value: string): string {
  return value.replace(/\.[a-z]{2,3}(?:[-_][a-z0-9]+)*(?:[-_](?:orig|auto|asr|automatic))?$/i, '');
}

function transcriptLanguage(request: DownloadRequest): string {
  const language = (request.subtitleLanguage || 'en.*').split(',')[0]?.trim() || 'en';
  return language.replace(/\.\*$/u, '').replace(/[^\w-]/g, '') || 'en';
}

function subtitleToMarkdown(subtitle: string): string {
  const segments = parseSubtitleSegments(subtitle);
  const text = segments.join(' ').replace(/\s+/g, ' ').trim();

  if (!text) {
    return '';
  }

  const sentences = splitSentences(text);
  const lines = shouldUseSentenceSplit(sentences, text) ? sentences : captionSegmentsToReadableLines(segments);
  return dedupeAdjacent(lines).join('\n\n') + '\n';
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) ?? [text];
  return matches.map(normalizeMarkdownLine).filter(Boolean);
}

function parseSubtitleSegments(subtitle: string): string[] {
  return dedupeAdjacent(
    subtitle
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((block) =>
        block
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && line !== 'WEBVTT')
          .filter((line) => !/^(?:NOTE|STYLE|REGION)\b/u.test(line))
          .filter((line) => !/^\d+$/.test(line))
          .filter((line) => !/-->/u.test(line))
          .map(cleanCaptionText)
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean)
  );
}

function cleanCaptionText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function shouldUseSentenceSplit(sentences: string[], text: string): boolean {
  if (sentences.length > 1) {
    return true;
  }
  return text.length < 220;
}

function captionSegmentsToReadableLines(segments: string[]): string[] {
  const lines: string[] = [];
  let current = '';

  for (const segment of segments) {
    const next = current ? `${current} ${segment}` : segment;
    if (next.length > 130 && current) {
      lines.push(normalizeMarkdownLine(current));
      current = segment;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(normalizeMarkdownLine(current));
  }

  return lines.filter(Boolean);
}

function normalizeMarkdownLine(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  const capitalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return /[.!?]"?$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function dedupeAdjacent(values: string[]): string[] {
  const deduped: string[] = [];
  for (const value of values) {
    if (deduped.at(-1)?.toLowerCase() !== value.toLowerCase()) {
      deduped.push(value);
    }
  }
  return deduped;
}

async function removeTemporaryFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Best effort cleanup; the final download should not fail because a temp file was already removed.
  }
}
