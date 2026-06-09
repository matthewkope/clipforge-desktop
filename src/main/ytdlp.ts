import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CookieSource, DownloadRequest, MediaInfo, OutputType, PlaylistEntry, YtDlpStrategy } from '../shared/media.js';

interface YtDlpRunResult {
  stdout: string;
  stderr: string;
}

interface StrategyAttempt {
  strategy: YtDlpStrategy;
  args: string[];
}

export class YtDlpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YtDlpError';
  }
}

export function validateUrl(input: string): void {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new YtDlpError('Paste a valid http or https media URL before analyzing.');
  }
}

export async function analyzeUrl(url: string, cookieSource: CookieSource = 'none', cookieFilePath?: string): Promise<MediaInfo> {
  validateUrl(url);
  const playlistMode = isPlaylistOnlyUrl(url);
  const analyzeArgs = playlistMode ? ['-J', '--flat-playlist', url] : ['-J', '--no-playlist', url];

  let result: YtDlpRunResult;
  let strategy: YtDlpStrategy;
  try {
    const analyzed = await runYtDlpWithFallbacks(url, [...cookieArgs(cookieSource, cookieFilePath), ...analyzeArgs], {
      timeoutMs: 90_000,
      allowYouTubeFallbacks: !cookieFilePath && cookieSource === 'none'
    });
    result = analyzed.result;
    strategy = analyzed.strategy;
  } catch (caught) {
    if (!isPlaylistUrl(url)) {
      throw caught;
    }
    const analyzed = await runYtDlpWithFallbacks(url, [...cookieArgs(cookieSource, cookieFilePath), '-J', '--flat-playlist', url], {
      timeoutMs: 90_000,
      allowYouTubeFallbacks: !cookieFilePath && cookieSource === 'none'
    });
    result = analyzed.result;
    strategy = analyzed.strategy;
  }

  try {
    const parsed = JSON.parse(result.stdout) as MediaInfo;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const isPlaylist = parsed._type === 'playlist' || entries.length > 0 || playlistMode;
    const firstEntry = entries.find((entry) => entry.thumbnail || entry.thumbnails?.length || entry.title);
    const firstEntryDetails = isPlaylist ? await fetchFirstPlaylistEntryDetails(url, firstEntry, strategy) : null;
    const metadataThumbnail = isPlaylist
      ? firstEntryDetails?.thumbnail || bestThumbnail(firstEntryDetails?.thumbnails) || firstEntry?.thumbnail || bestThumbnail(firstEntry?.thumbnails) || parsed.thumbnail
      : preferredPreviewThumbnail(parsed);
    const thumbnail =
      !isPlaylist && isOpeningFramePlatform(parsed.webpage_url || url, parsed.extractor)
        ? (await extractOpeningFrameThumbnail(url, cookieSource, cookieFilePath, strategy)) || metadataThumbnail
        : metadataThumbnail;

    return {
      ...parsed,
      formats: Array.isArray(parsed.formats) ? parsed.formats : [],
      subtitles: parsed.subtitles ?? {},
      automatic_captions: parsed.automatic_captions ?? {},
      ytDlpStrategy: strategy,
      isPlaylist,
      entries,
      playlist_count: parsed.playlist_count ?? entries.length,
      thumbnail
    };
  } catch {
    throw new YtDlpError('yt-dlp returned metadata that could not be read.');
  }
}

function preferredPreviewThumbnail(info: MediaInfo): string | undefined {
  if (isOpeningFramePlatform(info.webpage_url, info.extractor)) {
    return info.thumbnail || bestThumbnail(info.thumbnails);
  }

  return info.thumbnail || bestThumbnail(info.thumbnails);
}

function bestThumbnail(thumbnails?: Array<{ url?: string; preference?: number; width?: number; height?: number }>): string | undefined {
  if (!thumbnails?.length) {
    return undefined;
  }

  return [...thumbnails]
    .filter((thumbnail) => thumbnail.url)
    .sort((a, b) => (b.preference ?? 0) - (a.preference ?? 0) || (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0]?.url;
}

function isOpeningFramePlatform(url: string, extractor?: string): boolean {
  const normalized = `${url} ${extractor ?? ''}`.toLowerCase();
  return normalized.includes('instagram') || normalized.includes('tiktok');
}

async function extractOpeningFrameThumbnail(
  url: string,
  cookieSource: CookieSource,
  cookieFilePath: string | undefined,
  strategy: YtDlpStrategy
): Promise<string | undefined> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'clipforge-preview-'));
  const outputTemplate = path.join(tempDir, 'preview.%(ext)s');
  const framePath = path.join(tempDir, 'opening-frame.jpg');

  try {
    await runYtDlp(
      [
        ...strategyArgs(strategy),
        ...cookieArgs(cookieSource, cookieFilePath),
        '--no-playlist',
        '--no-warnings',
        '--no-continue',
        '-f',
        'bv*[vcodec!=none]/b[vcodec!=none]/best',
        '--download-sections',
        '*00:00:00-00:00:01',
        '--force-keyframes-at-cuts',
        '--merge-output-format',
        'mp4',
        '-o',
        outputTemplate,
        url
      ],
      60_000
    );

    const mediaPath = await findPreviewMediaFile(tempDir);
    if (!mediaPath) {
      return undefined;
    }

    await runCommand('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0', '-i', mediaPath, '-frames:v', '1', '-q:v', '3', framePath], 20_000);
    const frame = await readFile(framePath);
    return `data:image/jpeg;base64,${frame.toString('base64')}`;
  } catch {
    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function findPreviewMediaFile(tempDir: string): Promise<string | undefined> {
  const files = await readdir(tempDir);
  const mediaFile = files.find((file) => /^preview\./.test(file) && !file.endsWith('.part') && !file.endsWith('.ytdl') && !file.endsWith('.jpg'));
  return mediaFile ? path.join(tempDir, mediaFile) : undefined;
}

async function fetchFirstPlaylistEntryDetails(
  playlistUrl: string,
  firstEntry: PlaylistEntry | undefined,
  strategy: YtDlpStrategy
): Promise<Partial<MediaInfo> | null> {
  const entryUrl = firstEntryUrl(playlistUrl, firstEntry);
  if (!entryUrl) {
    return null;
  }

  try {
    const result = await runYtDlp([...strategyArgs(strategy), '-J', '--no-playlist', entryUrl], 45_000);
    return JSON.parse(result.stdout) as Partial<MediaInfo>;
  } catch {
    return null;
  }
}

export async function listSubtitles(url: string): Promise<string> {
  validateUrl(url);
  const { stdout, stderr } = await runYtDlp(['--list-subs', url]);
  return stdout || stderr;
}

export function buildDownloadArgs(request: DownloadRequest, outputType: OutputType): string[] {
  validateUrl(request.url);
  const outputTemplate = outputTemplateForRequest(request);
  const args = [
    ...strategyArgs(request.ytDlpStrategy ?? automaticStrategyForUrl(request.url)),
    ...cookieArgs(request.cookieSource, request.cookieFilePath),
    request.isPlaylist ? '--yes-playlist' : '--no-playlist',
    '--newline',
    '-o',
    outputTemplate
  ];

  switch (outputType) {
    case 'mp4':
      args.push('-f', videoFormatSelector(request.qualityId), '--merge-output-format', 'mp4');
      break;
    case 'mp3':
      args.push('-x', '--audio-format', 'mp3');
      break;
    case 'wav':
      args.push('-x', '--audio-format', 'wav');
      break;
    case 'm4a':
      args.push('-x', '--audio-format', 'm4a');
      break;
    case 'webm':
      args.push('-f', videoFormatSelector(request.qualityId), '--recode-video', 'webm');
      break;
    case 'subtitles':
    case 'markdown':
    case 'timed-transcript':
      args.push(
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        request.subtitleLanguage || 'en.*',
        '--sub-format',
        'srt'
      );
      break;
  }

  args.push(
    '--progress-template',
    'download:%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.filename)s',
    request.url
  );

  return args;
}

export function buildWhisperAudioArgs(request: DownloadRequest): string[] {
  validateUrl(request.url);
  return [
    ...strategyArgs(request.ytDlpStrategy ?? automaticStrategyForUrl(request.url)),
    ...cookieArgs(request.cookieSource, request.cookieFilePath),
    '--no-playlist',
    '--newline',
    '-x',
    '--audio-format',
    'wav',
    '-o',
    outputTemplateForRequest(request),
    '--progress-template',
    'download:%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.filename)s',
    request.url
  ];
}

function outputTemplateForRequest(request: DownloadRequest): string {
  if (request.isPlaylist) {
    return path.join(request.outputPath, '%(playlist_index)03d - %(title)s.%(ext)s');
  }

  const snapshotTitle = sanitizeSnapshotFileName(request.mediaTitle ?? '');
  return path.join(request.outputPath, `${snapshotTitle || '%(title)s'}.%(ext)s`);
}

function sanitizeSnapshotFileName(value: string): string {
  return value
    .replace(/%/g, ' percent')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
}

export function classifyYtDlpError(output: string): string {
  const normalized = output.toLowerCase();
  if (normalized.includes('sign in to confirm') || normalized.includes('not a bot') || normalized.includes('confirm you')) {
    return 'YouTube is blocking yt-dlp with a sign-in or bot-check page. The app tried its no-login compatibility modes. Try again later, update yt-dlp, or use a different network.';
  }
  if (normalized.includes('password') || normalized.includes('keyring') || normalized.includes('keychain')) {
    return 'yt-dlp tried to access protected browser cookies. The app avoids keychain prompts by default; switch Browser cookies back to No browser cookies and try again.';
  }
  if (normalized.includes('unsupported url')) {
    return 'That URL is not supported by yt-dlp.';
  }
  if (normalized.includes('playlist does not exist')) {
    return 'YouTube says this playlist does not exist or is not publicly available. Check that the playlist link opens in your browser and is public or unlisted.';
  }
  if (normalized.includes('private video') || normalized.includes('members-only') || normalized.includes('requires payment')) {
    return 'This media appears to be private, members-only, or otherwise unavailable to yt-dlp.';
  }
  if (normalized.includes('sign in')) {
    return 'This media requires sign-in or YouTube is blocking anonymous access. The app avoids keychain and cookie prompts by default.';
  }
  if (normalized.includes('ffmpeg') && normalized.includes('not found')) {
    return 'ffmpeg is missing. Install or bundle ffmpeg to merge or convert downloads.';
  }
  if (normalized.includes('whisper.cpp was not found') || normalized.includes('whisper.cpp command not found')) {
    return 'whisper.cpp is not installed or not on PATH. Install whisper.cpp and make whisper-cli available, or set WHISPER_CPP_BIN.';
  }
  if (normalized.includes('choose a whisper.cpp model')) {
    return 'Choose a whisper.cpp model file, such as ggml-base.en.bin, before generating a transcript without source captions. You can also set WHISPER_CPP_MODEL.';
  }
  if (normalized.includes('network') || normalized.includes('timed out') || normalized.includes('connection')) {
    return 'A network error interrupted the download. Check your connection and try again.';
  }
  return output.trim() || 'yt-dlp failed without a detailed error message.';
}

async function runYtDlpWithFallbacks(
  url: string,
  baseArgs: string[],
  options: { timeoutMs: number; allowYouTubeFallbacks: boolean }
): Promise<{ result: YtDlpRunResult; strategy: YtDlpStrategy }> {
  const attempts = buildStrategyAttempts(url, options.allowYouTubeFallbacks);
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const result = await runYtDlp([...attempt.args, ...baseArgs], options.timeoutMs);
      return { result, strategy: attempt.strategy };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      errors.push(message);
      if (!shouldTryNextStrategy(message)) {
        break;
      }
    }
  }

  throw new YtDlpError(errors.at(-1) ?? 'yt-dlp failed without a detailed error message.');
}

function buildStrategyAttempts(url: string, allowYouTubeFallbacks: boolean): StrategyAttempt[] {
  const attempts: StrategyAttempt[] = [{ strategy: 'standard', args: [] }];
  if (!allowYouTubeFallbacks || !isYouTubeUrl(url)) {
    return attempts;
  }

  attempts.push(
    { strategy: 'youtube-default-no-web', args: strategyArgs('youtube-default-no-web') },
    { strategy: 'youtube-tv', args: strategyArgs('youtube-tv') },
    { strategy: 'youtube-mobile', args: strategyArgs('youtube-mobile') }
  );

  return attempts;
}

function shouldTryNextStrategy(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('sign-in') ||
    normalized.includes('sign in') ||
    normalized.includes('bot-check') ||
    normalized.includes('bot check') ||
    normalized.includes('not a bot') ||
    normalized.includes('confirm') ||
    normalized.includes('unable to download api page') ||
    normalized.includes('unable to download webpage') ||
    normalized.includes('http error 403')
  );
}

function automaticStrategyForUrl(url: string): YtDlpStrategy {
  return isYouTubeUrl(url) ? 'youtube-default-no-web' : 'standard';
}

function strategyArgs(strategy: YtDlpStrategy): string[] {
  switch (strategy) {
    case 'youtube-default-no-web':
      return ['--extractor-args', 'youtube:player_client=default,-web'];
    case 'youtube-tv':
      return ['--extractor-args', 'youtube:player_client=tv'];
    case 'youtube-mobile':
      return ['--extractor-args', 'youtube:player_client=ios,android'];
    case 'standard':
      return [];
  }
}

function isYouTubeUrl(input: string): boolean {
  try {
    const hostname = new URL(input).hostname.toLowerCase();
    return hostname === 'youtu.be' || hostname.endsWith('.youtube.com') || hostname === 'youtube.com';
  } catch {
    return false;
  }
}

function isPlaylistUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.searchParams.has('list') || parsed.pathname.toLowerCase().includes('playlist');
  } catch {
    return false;
  }
}

function isPlaylistOnlyUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.searchParams.has('list') && !parsed.searchParams.has('v');
  } catch {
    return false;
  }
}

function firstEntryUrl(playlistUrl: string, firstEntry: PlaylistEntry | undefined): string | null {
  if (!firstEntry) {
    return null;
  }

  if (firstEntry.webpage_url) {
    return firstEntry.webpage_url;
  }

  if (firstEntry.url) {
    if (/^https?:\/\//i.test(firstEntry.url)) {
      return firstEntry.url;
    }
    if (isYouTubeUrl(playlistUrl)) {
      return `https://www.youtube.com/watch?v=${firstEntry.url}`;
    }
  }

  if (firstEntry.id && isYouTubeUrl(playlistUrl)) {
    return `https://www.youtube.com/watch?v=${firstEntry.id}`;
  }

  return null;
}

function cookieArgs(cookieSource: CookieSource = 'none', cookieFilePath?: string): string[] {
  if (cookieFilePath) {
    return ['--cookies', cookieFilePath];
  }

  if (cookieSource === 'none') {
    return [];
  }

  return ['--cookies-from-browser', cookieSource];
}

function videoFormatSelector(qualityId?: string): string {
  if (!qualityId || qualityId === 'best') {
    return 'bv*+ba/b';
  }

  if (qualityId.startsWith('height:')) {
    const height = Number(qualityId.replace('height:', ''));
    if (Number.isFinite(height) && height > 0) {
      return `bv*[height<=${height}]+ba/b[height<=${height}]`;
    }
  }

  return 'bv*+ba/b';
}

function runYtDlp(args: string[], timeoutMs = 0): Promise<{ stdout: string; stderr: string }> {
  return runCommand('yt-dlp', args, timeoutMs);
}

function runCommand(command: string, args: string[], timeoutMs = 0): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = timeoutMs
      ? setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill('SIGTERM');
          reject(
            new YtDlpError(
              `${command} took too long to respond. If you selected browser cookies and saw a password prompt, choose a cookies.txt file instead.`
            )
          );
        }, timeoutMs)
      : null;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      callback();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finish(() => reject(new YtDlpError(classifyYtDlpError(`${command}: ${error.message}`))));
    });

    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        reject(new YtDlpError(classifyYtDlpError(stderr || stdout)));
      });
    });
  });
}
