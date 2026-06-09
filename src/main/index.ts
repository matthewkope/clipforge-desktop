import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { checkDependencies } from './ffmpegCheck.js';
import { analyzeUrl, listSubtitles } from './ytdlp.js';
import { cancelDownload, resumePinterestQueue, startDownload, startGalleryDownload } from './downloadManager.js';
import { analyzeMedia } from './downloaders/mediaAnalyzer.js';
import { getPinterestRateLimitState } from './downloaders/pinterestRateLimiter.js';
import { detectMediaIntent, detectPlatform } from './urlRouter.js';
import { readPinterestDebugReport } from './utils/pinterestDebug.js';
import { pinterestArchivePath, resetPinterestArchive } from './utils/mediaManifest.js';
import { clearExtractedCookiesCache } from './utils/braveCookieExtractor.js';
import type { CookieSource, DownloadRequest, DownloadTool, GalleryDownloadRequest, PinterestSafeModeSettings } from '../shared/media.js';

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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();

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
  void clearExtractedCookiesCache();
});

function registerIpcHandlers(): void {
  ipcMain.handle('deps:check', () => checkDependencies());
  ipcMain.handle('platform:detect', (_event, url: string) => ({
    platform: detectPlatform(url),
    intent: detectMediaIntent(url)
  }));
  ipcMain.handle('media:analyze', (_event, url: string, cookieSource?: CookieSource, cookieFilePath?: string) =>
    analyzeUrl(url, cookieSource, cookieFilePath)
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
  ipcMain.handle('download:start', (event, request: DownloadRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('No active window is available for this download.');
    }
    return startDownload(window, request);
  });
  ipcMain.handle('download:gallery-start', (event, request: GalleryDownloadRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('No active window is available for this download.');
    }
    return startGalleryDownload(window, request);
  });
  ipcMain.handle('download:cancel', (_event, downloadId: string) => cancelDownload(downloadId));
  ipcMain.handle('tool:update', (_event, tool: DownloadTool) => updateTool(tool));
  ipcMain.handle('pinterest:debug-report', () => readPinterestDebugReport());
  ipcMain.handle('pinterest:rate-state', () => getPinterestRateLimitState());
  ipcMain.handle('pinterest:resume-queue', async () => {
    await resumePinterestQueue();
    return getPinterestRateLimitState();
  });
  ipcMain.handle('pinterest:archive-path', (_event, url: string) => pinterestArchivePath(url));
  ipcMain.handle('pinterest:reset-archive', (_event, url: string) => resetPinterestArchive(url));
  ipcMain.handle('path:open', (_event, targetPath: string) => shell.openPath(targetPath));
  ipcMain.handle('path:show', (_event, targetPath: string) => shell.showItemInFolder(targetPath));
}

function updateTool(tool: DownloadTool): Promise<string> {
  if (!['yt-dlp', 'gallery-dl', 'instaloader'].includes(tool)) {
    return Promise.reject(new Error('Unsupported tool update request.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn('python', ['-m', 'pip', 'install', '-U', tool], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim() || `${tool} updated.`);
        return;
      }
      reject(new Error(output.trim() || `${tool} update failed.`));
    });
  });
}
