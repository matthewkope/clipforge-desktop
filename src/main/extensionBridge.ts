import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserWindow } from 'electron';
import type { CaptionStyle, ExtensionBridgeConfig, ExtensionDownloadRequest, FormatPreset, OutputType } from '../shared/media.js';
import { fetchTranscriptSegments } from './transcriptService.js';

const bridgeHost = '127.0.0.1';
export const extensionBridgePort = 38473;
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

export function setExtensionBridgeWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function updateExtensionBridgeConfig(nextConfig: ExtensionBridgeConfig): void {
  config = normalizeConfig(nextConfig);
}

export function startExtensionBridge(): Promise<void> {
  if (server) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server = createServer((request, response) => {
      void handleRequest(request, response);
    });
    server.once('error', reject);
    server.listen(extensionBridgePort, bridgeHost, () => {
      server?.removeListener('error', reject);
      resolve();
    });
  });
}

export function stopExtensionBridge(): Promise<void> {
  const activeServer = server;
  server = null;
  if (!activeServer) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    activeServer.close(() => resolve());
  });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  // Reject requests whose Host header is not the loopback bridge address. Combined with
  // the Origin check below this blocks DNS-rebinding attacks, where a malicious website
  // resolves its own domain to 127.0.0.1 to reach this local server from the browser.
  if (!isAllowedBridgeHost(request.headers.host)) {
    sendJson(response, 403, { error: 'This bridge only accepts local requests.' });
    return;
  }

  const origin = request.headers.origin;
  if (origin && !isAllowedExtensionOrigin(origin)) {
    sendJson(response, 403, { error: 'This bridge only accepts browser-extension requests.' });
    return;
  }

  // State-changing routes require a real browser-extension Origin. Browsers
  // always attach Origin on cross-origin requests, so this blocks both websites
  // and non-browser local processes (curl, scripts) that omit it from forging a
  // download or transcript request.
  if (request.method === 'POST' && !isAllowedExtensionOrigin(origin ?? '')) {
    sendJson(response, 403, { error: 'This bridge only accepts browser-extension requests.' });
    return;
  }

  applyCorsHeaders(response, origin);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, {
      app: 'ClipForge',
      ready: Boolean(mainWindow && !mainWindow.isDestroyed()),
      port: (server?.address() as AddressInfo | null)?.port ?? extensionBridgePort
    });
    return;
  }

  if (request.method === 'GET' && request.url === '/status') {
    sendJson(response, 200, {
      presets: config?.presets ?? [],
      saveFolderConfigured: Boolean(config?.saveFolder),
      downloadActive: Boolean(config?.downloadActive),
      ready: Boolean(mainWindow && !mainWindow.isDestroyed())
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/transcript') {
    try {
      const body = (await readJsonBody(request)) as { url?: unknown };
      if (typeof body.url !== 'string' || !isHttpUrl(body.url)) {
        throw new BridgeRequestError(400, 'The transcript request needs a valid HTTP or HTTPS URL.');
      }
      const segments = await fetchTranscriptSegments(
        body.url.trim(),
        config?.subtitleLanguage || 'en.*',
        config?.cookieSource ?? 'none',
        config?.cookieFilePath,
        // Use the whisper model the user loaded in Settings → Transcripts for
        // the caption-less fallback, matching the rest of the app.
        config?.whisperModelPath || undefined
      );
      sendJson(response, 200, { segments });
    } catch (caught) {
      const status = caught instanceof BridgeRequestError ? caught.status : 400;
      const message = caught instanceof Error ? caught.message : 'Transcript fetch failed.';
      sendJson(response, status, { error: message });
    }
    return;
  }

  if (request.method === 'POST' && request.url === '/download') {
    try {
      const body = await readJsonBody(request);
      const downloadRequest = parseDownloadRequest(body);
      const preset = downloadRequest.presetId
        ? config?.presets.find((candidate) => candidate.id === downloadRequest.presetId)
        : undefined;
      if (downloadRequest.presetId && !preset) {
        throw new BridgeRequestError(400, 'The selected preset is no longer available.');
      }
      if (!config?.saveFolder) {
        throw new BridgeRequestError(409, 'Choose a save folder in ClipForge before using the extension.');
      }
      // Concurrent requests are fine: the desktop app queues downloads.
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new BridgeRequestError(503, 'ClipForge is not ready.');
      }

      mainWindow.show();
      mainWindow.focus();
      const trustedRequest: ExtensionDownloadRequest = preset
        ? { ...downloadRequest, presetName: preset.name, formats: [...preset.formats] }
        : downloadRequest;
      mainWindow.webContents.send('extension:download-request', trustedRequest);
      sendJson(response, 202, { accepted: true, format: trustedRequest.format, preset: trustedRequest.presetName });
    } catch (caught) {
      const status = caught instanceof BridgeRequestError ? caught.status : 400;
      const message = caught instanceof Error ? caught.message : 'Invalid extension request.';
      sendJson(response, status, { error: message });
    }
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
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
    throw new BridgeRequestError(400, 'Invalid request.');
  }
  const request = value as Partial<ExtensionDownloadRequest>;
  if (typeof request.url !== 'string' || !isHttpUrl(request.url)) {
    throw new BridgeRequestError(400, 'The selected value is not a valid HTTP or HTTPS URL.');
  }
  const hasFormat = allowedExtensionFormats.has(request.format as ExtensionDownloadRequest['format']);
  const hasPreset = typeof request.presetId === 'string' && Boolean(request.presetId);
  if (hasFormat === hasPreset) {
    throw new BridgeRequestError(400, 'Choose one direct format or one saved preset.');
  }
  if (request.source !== 'active-tab' && request.source !== 'clipboard' && request.source !== 'youtube-player') {
    throw new BridgeRequestError(400, 'Invalid URL source.');
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
  const raw = value as { size?: unknown; position?: unknown };
  const style: CaptionStyle = {};
  if (raw.size === 'small' || raw.size === 'medium' || raw.size === 'large') {
    style.size = raw.size;
  }
  if (raw.position === 'top' || raw.position === 'middle' || raw.position === 'bottom') {
    style.position = raw.position;
  }
  return style.size || style.position ? style : undefined;
}

function parseClipRange(start: unknown, end: unknown): Pick<ExtensionDownloadRequest, 'clipStart' | 'clipEnd'> | null {
  if (start === undefined && end === undefined) {
    return null;
  }
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new BridgeRequestError(400, 'Clip start and end must both be numbers of seconds.');
  }
  const clipStart = Math.max(0, start);
  if (end <= clipStart) {
    throw new BridgeRequestError(400, 'Clip end must be after clip start.');
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

function isAllowedExtensionOrigin(origin: string): boolean {
  return origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
}

function isAllowedBridgeHost(host: string | undefined): boolean {
  if (!host) {
    return false;
  }
  // Only the literal loopback IP the server binds to — not "localhost", which
  // can resolve to a DNS-controlled address and weaken anti-rebinding.
  return host.toLowerCase() === `${bridgeHost}:${extensionBridgePort}`;
}

function applyCorsHeaders(response: ServerResponse, origin?: string): void {
  if (origin && isAllowedExtensionOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'no-store');
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 16_384) {
      throw new BridgeRequestError(413, 'Request is too large.');
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

class BridgeRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
