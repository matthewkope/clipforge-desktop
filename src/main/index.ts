import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { checkDependencies } from './ffmpegCheck.js';
import { analyzeUrl, listSubtitles } from './ytdlp.js';
import {
  cancelAllDownloads,
  cancelDownload,
  resumePinterestQueue,
  setDownloadConcurrency,
  startBatchDownload,
  startDownload,
  startGalleryDownload
} from './downloadManager.js';
import { clearHistory, listHistory, removeHistoryEntry } from './historyStore.js';
import { getDownloadCover } from './coverImage.js';
import { isSafeOpenTarget } from './utils/pathSafety.js';
import { autoUpdateYtDlp, provisionCoreTools } from './binaryManager.js';
import {
  addWatchSubscription,
  listWatchSubscriptions,
  removeWatchSubscription,
  startWatchScheduler,
  stopWatchScheduler,
  syncWatchSubscriptionNow,
  updateWatchSubscription
} from './watchManager.js';
import { analyzeMedia } from './downloaders/mediaAnalyzer.js';
import { getPinterestRateLimitState } from './downloaders/pinterestRateLimiter.js';
import { detectMediaIntent, detectPlatform } from './urlRouter.js';
import { readPinterestDebugReport } from './utils/pinterestDebug.js';
import { pinterestArchivePath, resetPinterestArchive } from './utils/mediaManifest.js';
import { clearExtractedCookiesCache } from './utils/braveCookieExtractor.js';
import { checkYtDlpUpdate, updateDownloadTool } from './toolUpdate.js';
import {
  setExtensionBridgeWindow,
  startExtensionBridge,
  stopExtensionBridge,
  updateExtensionBridgeConfig
} from './extensionBridge.js';
import type {
  CookieSource,
  DownloadHistorySource,
  DownloadRequest,
  DownloadTool,
  ExtensionBridgeConfig,
  GalleryDownloadRequest,
  PinterestSafeModeSettings,
  WatchSubscriptionInput
} from '../shared/media.js';

let mainWindow: BrowserWindow | null = null;
let pinterestAnalysisRunning = false;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 520,
    minHeight: 560,
    title: 'ClipForge',
    backgroundColor: '#f6f3ed',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  });
  hardenWebContents(mainWindow);
  setExtensionBridgeWindow(mainWindow);
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    setExtensionBridgeWindow(null);
    mainWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// Lock the window down so a malicious link, redirect, or injected markup can
// never navigate the app to remote content (which would inherit the powerful
// preload bridge) or open arbitrary new windows. External http(s) links are
// handed to the user's real browser instead.
function hardenWebContents(window: BrowserWindow): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  const isInternalUrl = (target: string): boolean => {
    if (devServerUrl && target.startsWith(devServerUrl)) {
      return true;
    }
    return target.startsWith('file://');
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
    }
  });

  // Deny every renderer-initiated permission request (camera, mic, geolocation,
  // notifications, etc.); the app needs none of them.
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  // Content-Security-Policy for the packaged (file://) app. Skipped in dev so it
  // does not fight the Vite dev server / HMR. Allows remote images for
  // thumbnails but forbids remote/inline scripts.
  if (!devServerUrl) {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          // `file:` is included on script/style/default because Chromium does
          // not reliably treat 'self' as matching file:// assets; the app's own
          // bundle is the only file:// content that can load here (navigation is
          // locked down). Crucially there is NO 'unsafe-inline'/'unsafe-eval' on
          // script-src and no remote scheme, so injected or remote scripts are
          // still blocked — the actual XSS defense.
          'Content-Security-Policy': [
            "default-src 'self' file:; " +
              "script-src 'self' file:; " +
              "style-src 'self' 'unsafe-inline' file:; " +
              "img-src 'self' file: data: https: http:; " +
              "media-src 'self' file: data: blob:; " +
              "font-src 'self' file: data:; " +
              "connect-src 'self' file: data:; " +
              "object-src 'none'; " +
              "base-uri 'none'; " +
              "frame-src 'none'"
          ]
        }
      });
    });
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  // Start the bridge in the background so window creation is not blocked on it.
  startExtensionBridge().catch((caught) => {
    console.error('ClipForge extension bridge could not start:', caught);
  });
  await createWindow();
  // Provision the core download tools (promote the bundled yt-dlp into a
  // writable managed copy on first run), then refresh it if a newer release
  // exists. Best-effort and fully in the background — the resolver falls back to
  // the bundled binary while this runs, so it never blocks the window.
  void provisionCoreTools().then(() => autoUpdateYtDlp());
  void notifyYtDlpUpdateAvailable();
  startWatchScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopWatchScheduler();
  void clearExtractedCookiesCache();
  void stopExtensionBridge();
});

function registerIpcHandlers(): void {
  ipcMain.handle('deps:check', () => checkDependencies());
  ipcMain.handle('platform:detect', (_event, url: string) => ({
    platform: detectPlatform(url),
    intent: detectMediaIntent(url)
  }));
  ipcMain.handle('media:analyze', (event, url: string, cookieSource?: CookieSource, cookieFilePath?: string) =>
    analyzeUrl(url, cookieSource, cookieFilePath, (thumbnail) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('media:thumbnail', { url, thumbnail });
      }
    })
  );
  ipcMain.handle('media:analyze-normalized', async (_event, url: string, cookieSource?: CookieSource, cookieFilePath?: string, pinterestSettings?: PinterestSafeModeSettings) => {
    if (detectPlatform(url) === 'pinterest') {
      const state = getPinterestRateLimitState();
      if (state.activePinterestJob) {
        throw new Error('A Pinterest download is active. The app will not re-analyze this board until the current Pinterest task finishes.');
      }
      if (state.paused) {
        throw new Error('Pinterest is rate limiting requests. The app paused the Pinterest queue. Try again later, or use Brave cookies for an account that can access this board.');
      }
      if (pinterestAnalysisRunning) {
        throw new Error('A Pinterest analysis is already running. Wait for it to finish before analyzing another Pinterest URL.');
      }
      pinterestAnalysisRunning = true;
      try {
        return await analyzeMedia(url, cookieSource, cookieFilePath, pinterestSettings);
      } finally {
        pinterestAnalysisRunning = false;
      }
    }
    return analyzeMedia(url, cookieSource, cookieFilePath, pinterestSettings);
  });
  ipcMain.handle('media:list-subs', (_event, url: string) => listSubtitles(url));
  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });
  ipcMain.handle('cookies:choose-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Cookie files', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });
  ipcMain.handle('whisper:model:choose', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'whisper.cpp models', extensions: ['bin'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });
  ipcMain.handle('download:start', (event, request: DownloadRequest, source?: DownloadHistorySource) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('No active window is available for this download.');
    }
    return startDownload(window, request, source);
  });
  ipcMain.handle('download:batch-start', (event, urls: string[], baseRequest: Omit<DownloadRequest, 'url'>) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('No active window is available for this download.');
    }
    if (!Array.isArray(urls)) {
      throw new Error('Batch downloads need a list of URLs.');
    }
    return startBatchDownload(window, urls, baseRequest);
  });
  ipcMain.handle('download:cancel-all', () => cancelAllDownloads());
  ipcMain.handle('queue:set-concurrency', (_event, n: number) => setDownloadConcurrency(n));
  ipcMain.handle('history:list', () => listHistory());
  ipcMain.handle('history:remove', (_event, id: string) => removeHistoryEntry(id));
  ipcMain.handle('history:clear', () => clearHistory());
  ipcMain.handle('history:cover', (_event, filePath: string) => getDownloadCover(filePath));
  ipcMain.handle('watch:list', () => listWatchSubscriptions());
  ipcMain.handle('watch:add', (_event, input: WatchSubscriptionInput) => addWatchSubscription(input));
  ipcMain.handle('watch:update', (_event, id: string, patch: Partial<WatchSubscriptionInput> & { enabled?: boolean }) =>
    updateWatchSubscription(id, patch)
  );
  ipcMain.handle('watch:remove', (_event, id: string) => removeWatchSubscription(id));
  ipcMain.handle('watch:sync-now', (_event, id: string) => syncWatchSubscriptionNow(id));
  ipcMain.handle('download:gallery-start', (event, request: GalleryDownloadRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('No active window is available for this download.');
    }
    return startGalleryDownload(window, request);
  });
  ipcMain.handle('download:cancel', (_event, downloadId: string) => cancelDownload(downloadId));
  ipcMain.handle('tool:update', (_event, tool: DownloadTool) => updateDownloadTool(tool));
  ipcMain.handle('pinterest:debug-report', () => readPinterestDebugReport());
  ipcMain.handle('pinterest:rate-state', () => getPinterestRateLimitState());
  ipcMain.handle('pinterest:resume-queue', async () => {
    await resumePinterestQueue();
    return getPinterestRateLimitState();
  });
  ipcMain.handle('pinterest:archive-path', (_event, url: string) => pinterestArchivePath(url));
  ipcMain.handle('pinterest:reset-archive', (_event, url: string) => resetPinterestArchive(url));
  ipcMain.handle('path:open', async (_event, targetPath: string) => {
    if (!(await isSafeOpenTarget(targetPath))) {
      return 'This location cannot be opened from ClipForge.';
    }
    return shell.openPath(targetPath);
  });
  ipcMain.handle('path:show', async (_event, targetPath: string) => {
    if (!(await isSafeOpenTarget(targetPath))) {
      return;
    }
    shell.showItemInFolder(targetPath);
  });
  ipcMain.handle('extension:update-config', (_event, config: ExtensionBridgeConfig) => {
    updateExtensionBridgeConfig(config);
  });
}

async function notifyYtDlpUpdateAvailable(): Promise<void> {
  const info = await checkYtDlpUpdate();
  if (info?.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:ytdlp-update-available', info);
  }
}
