import { createServer, type Server, type Socket } from 'node:net';
import { chmod, unlink } from 'node:fs/promises';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { CaptionStyle, ExtensionBridgeConfig, ExtensionDownloadRequest, FormatPreset, OutputType } from '../shared/media.js';
import { fetchTranscriptSegments } from './transcriptService.js';

// The browser extension reaches the desktop app through Chrome Native
// Messaging: the browser spawns a small host process (extension/native-host)
// which relays each request to THIS Unix-domain socket. There is no network
// listener — only a filesystem socket in the app's user-data dir, reachable
// only by the current user — so the website-driven and DNS-rebinding attack
// surfaces of the old loopback HTTP bridge are gone entirely.

const maxFrameBytes = 1_000_000;
const allowedExtensionFormats = new Set<ExtensionDownloadRequest['format']>(['mp4', 'mp3', 'markdown', 'gif']);
const allowedOutputTypes = new Set<OutputType>([
  'mp4',
  'webm',
  'mp3',
  'wav',
  'm4a',
  'gif',
  'subtitles',
  'timed-transcript',
  'markdown'
]);

let server: Server | null = null;
let mainWindow: BrowserWindow | null = null;
let config: ExtensionBridgeConfig | null = null;

// Canonical socket path. The native host computes the same path (see
// extension/native-host/clipforge-host.mjs); keep them in sync.
export function extensionSocketPath(): string {
  return path.join(app.getPath('userData'), 'clipforge.sock');
}

export function setExtensionBridgeWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function updateExtensionBridgeConfig(nextConfig: ExtensionBridgeConfig): void {
  config = normalizeConfig(nextConfig);
}

export async function startExtensionBridge(): Promise<void> {
  if (server) {
    return;
  }
  const socketPath = extensionSocketPath();
  // A leftover socket file from a crash would make listen() fail with EADDRINUSE.
  await unlink(socketPath).catch(() => undefined);

  await new Promise<void>((resolve, reject) => {
    const next = createServer((socket) => handleConnection(socket));
    next.once('error', reject);
    next.listen(socketPath, () => {
      next.removeListener('error', reject);
      server = next;
      resolve();
    });
  });

  // Owner-only, so no other user account on the machine can send requests.
  await chmod(socketPath, 0o600).catch(() => undefined);
}

export function stopExtensionBridge(): Promise<void> {
  const activeServer = server;
  server = null;
  if (!activeServer) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    activeServer.close(() => {
      void unlink(extensionSocketPath())
        .catch(() => undefined)
        .then(() => resolve());
    });
  });
}

// Reads length-prefixed frames (4-byte little-endian length + UTF-8 JSON) and
// answers each with a framed `{ ok, body }` response — the same shape the old
// HTTP relay returned, so the extension's handling is unchanged.
function handleConnection(socket: Socket): void {
  let buffer = Buffer.alloc(0);
  let expected: number | null = null;

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (expected === null) {
        if (buffer.length < 4) {
          return;
        }
        expected = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
        if (expected > maxFrameBytes) {
          socket.destroy();
          return;
        }
      }
      if (buffer.length < expected) {
        return;
      }
      const frame = buffer.subarray(0, expected);
      buffer = buffer.subarray(expected);
      expected = null;
      void respond(socket, frame);
    }
  });

  socket.on('error', () => socket.destroy());
}

async function respond(socket: Socket, frame: Buffer): Promise<void> {
  let result: { ok: boolean; body: unknown };
  try {
    const message = JSON.parse(frame.toString('utf8')) as unknown;
    result = await handleMessage(message);
  } catch (caught) {
    result = { ok: false, body: { error: caught instanceof Error ? caught.message : 'Invalid request.' } };
  }
  if (socket.destroyed) {
    return;
  }
  const json = Buffer.from(JSON.stringify(result), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  socket.write(Buffer.concat([header, json]));
}

async function handleMessage(message: unknown): Promise<{ ok: boolean; body: unknown }> {
  const type = typeof message === 'object' && message ? (message as { type?: unknown }).type : undefined;
  const payload = typeof message === 'object' && message ? (message as { payload?: unknown }).payload : undefined;

  if (type === 'clipforge-status') {
    return { ok: true, body: statusBody() };
  }
  if (type === 'clipforge-transcript') {
    return handleTranscript(payload);
  }
  if (type === 'clipforge-download') {
    return handleDownload(payload);
  }
  return { ok: false, body: { error: 'Unknown ClipForge request.' } };
}

function statusBody(): unknown {
  return {
    presets: config?.presets ?? [],
    saveFolderConfigured: Boolean(config?.saveFolder),
    downloadActive: Boolean(config?.downloadActive),
    ready: Boolean(mainWindow && !mainWindow.isDestroyed())
  };
}

async function handleTranscript(payload: unknown): Promise<{ ok: boolean; body: unknown }> {
  try {
    const url = (payload as { url?: unknown })?.url;
    if (typeof url !== 'string' || !isHttpUrl(url)) {
      throw new Error('The transcript request needs a valid HTTP or HTTPS URL.');
    }
    const segments = await fetchTranscriptSegments(
      url.trim(),
      config?.subtitleLanguage || 'en.*',
      config?.cookieSource ?? 'none',
      config?.cookieFilePath,
      // Use the whisper model the user loaded in Settings → Transcripts for the
      // caption-less fallback, matching the rest of the app.
      config?.whisperModelPath || undefined
    );
    return { ok: true, body: { segments } };
  } catch (caught) {
    return { ok: false, body: { error: caught instanceof Error ? caught.message : 'Transcript fetch failed.' } };
  }
}

async function handleDownload(payload: unknown): Promise<{ ok: boolean; body: unknown }> {
  try {
    const downloadRequest = parseDownloadRequest(payload);
    const preset = downloadRequest.presetId
      ? config?.presets.find((candidate) => candidate.id === downloadRequest.presetId)
      : undefined;
    if (downloadRequest.presetId && !preset) {
      throw new Error('The selected preset is no longer available.');
    }
    if (!config?.saveFolder) {
      throw new Error('Choose a save folder in ClipForge before using the extension.');
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('ClipForge is not ready.');
    }

    mainWindow.show();
    mainWindow.focus();
    const trustedRequest: ExtensionDownloadRequest = preset
      ? { ...downloadRequest, presetName: preset.name, formats: [...preset.formats] }
      : downloadRequest;
    mainWindow.webContents.send('extension:download-request', trustedRequest);
    return { ok: true, body: { accepted: true, format: trustedRequest.format, preset: trustedRequest.presetName } };
  } catch (caught) {
    return { ok: false, body: { error: caught instanceof Error ? caught.message : 'Invalid extension request.' } };
  }
}

function normalizeConfig(value: ExtensionBridgeConfig): ExtensionBridgeConfig {
  return {
    ...value,
    presets: value.presets.filter(isFormatPreset).slice(0, 3),
    saveFolder: value.saveFolder.trim(),
    subtitleLanguage: value.subtitleLanguage.trim() || 'en.*',
    whisperModelPath: value.whisperModelPath.trim(),
    cookieFilePath: value.cookieFilePath?.trim() || undefined
  };
}

function parseDownloadRequest(value: unknown): ExtensionDownloadRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid request.');
  }
  const request = value as Partial<ExtensionDownloadRequest>;
  if (typeof request.url !== 'string' || !isHttpUrl(request.url)) {
    throw new Error('The selected value is not a valid HTTP or HTTPS URL.');
  }
  const hasFormat = allowedExtensionFormats.has(request.format as ExtensionDownloadRequest['format']);
  const hasPreset = typeof request.presetId === 'string' && Boolean(request.presetId);
  if (hasFormat === hasPreset) {
    throw new Error('Choose one direct format or one saved preset.');
  }
  if (request.source !== 'active-tab' && request.source !== 'clipboard' && request.source !== 'youtube-player') {
    throw new Error('Invalid URL source.');
  }
  const clip = parseClipRange(request.clipStart, request.clipEnd);
  const captionStyle = parseCaptionStyle(request.captionStyle);
  return {
    url: request.url.trim(),
    ...(hasFormat ? { format: request.format as ExtensionDownloadRequest['format'] } : { presetId: request.presetId }),
    source: request.source,
    ...(clip ?? {}),
    ...(request.crop === 'vertical' ? { crop: 'vertical' as const } : {}),
    ...(request.burnCaptions === true ? { burnCaptions: true } : {}),
    ...(captionStyle ? { captionStyle } : {})
  };
}

// Keeps only the recognized caption-style values; invalid fields are dropped
// rather than rejected so older/newer extensions stay compatible.
function parseCaptionStyle(value: unknown): CaptionStyle | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as { size?: unknown; position?: unknown; animate?: unknown };
  const style: CaptionStyle = {};
  if (raw.size === 'small' || raw.size === 'medium' || raw.size === 'large') {
    style.size = raw.size;
  }
  if (raw.position === 'top' || raw.position === 'middle' || raw.position === 'bottom') {
    style.position = raw.position;
  }
  // Word-by-word "karaoke" highlight opt-in; passed through so a style carrying
  // only `animate` (no size/position) is still returned.
  if (raw.animate === 'word') {
    style.animate = 'word';
  }
  return style.size || style.position || style.animate ? style : undefined;
}

function parseClipRange(start: unknown, end: unknown): Pick<ExtensionDownloadRequest, 'clipStart' | 'clipEnd'> | null {
  if (start === undefined && end === undefined) {
    return null;
  }
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('Clip start and end must both be numbers of seconds.');
  }
  const clipStart = Math.max(0, start);
  if (end <= clipStart) {
    throw new Error('Clip end must be after clip start.');
  }
  return { clipStart, clipEnd: end };
}

function isFormatPreset(value: FormatPreset): boolean {
  return (
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    typeof value.name === 'string' &&
    Boolean(value.name.trim()) &&
    Array.isArray(value.formats) &&
    value.formats.length > 0 &&
    value.formats.every((format) => allowedOutputTypes.has(format))
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
