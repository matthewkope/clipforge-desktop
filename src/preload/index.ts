import { contextBridge, ipcRenderer } from 'electron';
import type { AppApi, CookieSource, DownloadProgress, DownloadRequest, DownloadResult, GalleryDownloadRequest, PinterestSafeModeSettings } from '../shared/media.js';

const api: AppApi = {
  checkDependencies: () => ipcRenderer.invoke('deps:check'),
  detectPlatform: (url: string) => ipcRenderer.invoke('platform:detect', url),
  analyzeUrl: (url: string, cookieSource?: CookieSource, cookieFilePath?: string) =>
    ipcRenderer.invoke('media:analyze', url, cookieSource, cookieFilePath),
  analyzeMedia: (url: string, cookieSource?: CookieSource, cookieFilePath?: string, pinterestSettings?: PinterestSafeModeSettings) =>
    ipcRenderer.invoke('media:analyze-normalized', url, cookieSource, cookieFilePath, pinterestSettings),
  listSubtitles: (url: string) => ipcRenderer.invoke('media:list-subs', url),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  chooseCookieFile: () => ipcRenderer.invoke('cookies:choose-file'),
  chooseWhisperModel: () => ipcRenderer.invoke('whisper:model:choose'),
  startDownload: (request: DownloadRequest) => ipcRenderer.invoke('download:start', request),
  startGalleryDownload: (request: GalleryDownloadRequest) => ipcRenderer.invoke('download:gallery-start', request),
  cancelDownload: (downloadId: string) => ipcRenderer.invoke('download:cancel', downloadId),
  updateTool: (tool) => ipcRenderer.invoke('tool:update', tool),
  getPinterestDebugReport: () => ipcRenderer.invoke('pinterest:debug-report'),
  getPinterestRateLimitState: () => ipcRenderer.invoke('pinterest:rate-state'),
  resumePinterestQueue: () => ipcRenderer.invoke('pinterest:resume-queue'),
  getPinterestArchivePath: (url: string) => ipcRenderer.invoke('pinterest:archive-path', url),
  resetPinterestArchive: (url: string) => ipcRenderer.invoke('pinterest:reset-archive', url),
  openPath: (path: string) => ipcRenderer.invoke('path:open', path),
  showInFolder: (path: string) => ipcRenderer.invoke('path:show', path),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => callback(progress);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  },
  onDownloadComplete: (callback: (result: DownloadResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: DownloadResult) => callback(result);
    ipcRenderer.on('download:complete', listener);
    return () => ipcRenderer.removeListener('download:complete', listener);
  }
};

contextBridge.exposeInMainWorld('clipForge', api);
