import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserWindow } from 'electron';
import type { ExtensionBridgeConfig, ExtensionDownloadRequest, FormatPreset, OutputType } from '../shared/media.js';

const bridgeHost = '127.0.0.1';
export const extensionBridgePort = 38473;
const allowedExtensionFormats = new Set<ExtensionDownloadRequest['format']>(['mp4', 'mp3', 'markdown']);
const allowedOutputTypes = new Set<OutputType>([
  'mp4',
  'webm',
  'mp3',
  'wav',
  'm4a',
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
  const origin = request.headers.origin;
  if (origin && !isAllowedExtensionOrigin(origin)) {
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
      if (config.downloadActive) {
        throw new BridgeRequestError(409, 'A ClipForge download is already active.');
      }
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
  if (request.source !== 'active-tab' && request.source !== 'clipboard') {
    throw new BridgeRequestError(400, 'Invalid URL source.');
  }
  return {
    url: request.url.trim(),
    ...(hasFormat ? { format: request.format as ExtensionDownloadRequest['format'] } : { presetId: request.presetId }),
    source: request.source
  };
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
