import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CookieSource, TranscriptSegment } from '../shared/media.js';
import { buildSubtitleFetchArgs, buildWhisperAudioArgs } from './ytdlp.js';
import { parseTimedCues } from './utils/srt.js';
import { runWhisperCpp } from './utils/whisper.js';
import { resolveToolPath } from './toolResolver.js';

interface TranscriptCacheEntry {
  segments: TranscriptSegment[];
  fetchedAt: number;
}

// Timed transcript segments for the extension's "search the transcript to set
// clip points" feature. Cached per URL because the user typically searches the
// same video several times while picking a clip.
const cache = new Map<string, TranscriptCacheEntry>();
const cacheTtlMs = 15 * 60 * 1000;
const cacheMaxEntries = 20;
const inFlight = new Map<string, Promise<TranscriptSegment[]>>();

export async function fetchTranscriptSegments(
  url: string,
  subtitleLanguage: string,
  cookieSource: CookieSource,
  cookieFilePath?: string,
  whisperModelPath?: string
): Promise<TranscriptSegment[]> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.segments;
  }

  const pending = inFlight.get(url);
  if (pending) {
    return pending;
  }

  const promise = downloadTranscript(url, subtitleLanguage, cookieSource, cookieFilePath, whisperModelPath)
    .then((segments) => {
      cache.set(url, { segments, fetchedAt: Date.now() });
      while (cache.size > cacheMaxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        cache.delete(oldest);
      }
      return segments;
    })
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, promise);
  return promise;
}

async function downloadTranscript(
  url: string,
  subtitleLanguage: string,
  cookieSource: CookieSource,
  cookieFilePath?: string,
  whisperModelPath?: string
): Promise<TranscriptSegment[]> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'clipforge-transcript-'));
  try {
    const args = buildSubtitleFetchArgs(
      {
        url,
        outputTypes: [],
        outputPath: tempDir,
        // 'en.*' matches every translated English track (en-de-DE, en-ja, ...)
        // and YouTube rate-limits after a few subtitle downloads; one track is
        // enough for searching.
        subtitleLanguage: subtitleLanguage === 'en.*' ? 'en,en-orig' : subtitleLanguage,
        cookieSource,
        cookieFilePath
      },
      path.join(tempDir, 'captions.%(ext)s')
    );
    // A non-zero exit (e.g. HTTP 429 on a later language variant) is fine as
    // long as at least one subtitle file landed before the failure; when no
    // caption file lands at all we fall back to whisper below.
    await runYtDlp(args, 90_000).catch(() => undefined);

    const files = await readdir(tempDir);
    // Prefer manual captions over auto-generated ones when both exist.
    const subtitleFile = files
      .filter((file) => /\.(?:srt|vtt)$/i.test(file))
      .sort((a, b) => Number(/orig|auto/i.test(a)) - Number(/orig|auto/i.test(b)))[0];
    if (!subtitleFile) {
      // Whisper fallback: no source captions, so transcribe the audio locally
      // using the model the user configured in Settings → Transcripts.
      return whisperTranscript(url, cookieSource, cookieFilePath, tempDir, whisperModelPath);
    }

    const segments = parseTimedCues(await readFile(path.join(tempDir, subtitleFile), 'utf8'));
    if (segments.length === 0) {
      throw new Error('This video has no captions to search.');
    }
    return segments;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// Downloads the video's audio as WAV into the temp dir and transcribes it
// with whisper.cpp, preferring the model the user loaded for transcription
// (the same Settings → Transcripts model used everywhere else). When no model
// is configured, runWhisperCpp auto-detects one or throws its friendly error.
async function whisperTranscript(
  url: string,
  cookieSource: CookieSource,
  cookieFilePath: string | undefined,
  tempDir: string,
  whisperModelPath?: string
): Promise<TranscriptSegment[]> {
  const args = buildWhisperAudioArgs({
    url,
    outputTypes: [],
    outputPath: tempDir,
    mediaTitle: 'whisper-audio',
    cookieSource,
    cookieFilePath
  });
  await runYtDlp(args, 600_000);

  const files = await readdir(tempDir);
  const audioFile = files.find((file) => /\.wav$/i.test(file));
  if (!audioFile) {
    throw new Error('Could not extract audio for whisper.cpp transcription.');
  }

  const srtPath = await runWhisperCpp({ audioPath: path.join(tempDir, audioFile), modelPath: whisperModelPath || undefined });
  const segments = parseTimedCues(await readFile(srtPath, 'utf8'));
  if (segments.length === 0) {
    throw new Error('This video has no captions to search.');
  }
  return segments;
}

function runYtDlp(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveToolPath('yt-dlp'), args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error('Fetching the transcript took too long.'));
      }
    }, timeoutMs);

    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(output.trim() || 'yt-dlp could not fetch captions for this video.'));
      }
    });
  });
}
