import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppApi,
  CookieSource,
  DownloadHistoryEntry,
  DownloadHistorySource,
  DownloadProgress,
  DownloadQueueState,
  DownloadRequest,
  DownloadResult,
  ExtensionBridgeConfig,
  ExtensionDownloadRequest,
  GalleryDownloadRequest,
  MediaThumbnailUpdate,
  PinterestSafeModeSettings,
  WatchSubscription,
  WatchSubscriptionInput,
  YtDlpUpdateInfo
} from '../shared/media.js';

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
  startDownload: (request: DownloadRequest, source?: DownloadHistorySource) =>
    ipcRenderer.invoke('download:start', request, source),
  startBatchDownload: (urls: string[], baseRequest: Omit<DownloadRequest, 'url'>) =>
    ipcRenderer.invoke('download:batch-start', urls, baseRequest),
  startGalleryDownload: (request: GalleryDownloadRequest) => ipcRenderer.invoke('download:gallery-start', request),
  cancelDownload: (downloadId: string) => ipcRenderer.invoke('download:cancel', downloadId),
  cancelAllDownloads: () => ipcRenderer.invoke('download:cancel-all'),
  setDownloadConcurrency: (n: number) => ipcRenderer.invoke('queue:set-concurrency', n),
  getDownloadHistory: () => ipcRenderer.invoke('history:list'),
  removeDownloadHistoryEntry: (id: string) => ipcRenderer.invoke('history:remove', id),
  clearDownloadHistory: () => ipcRenderer.invoke('history:clear'),
  getDownloadCover: (filePath: string) => ipcRenderer.invoke('history:cover', filePath),
  listWatchSubscriptions: () => ipcRenderer.invoke('watch:list'),
  addWatchSubscription: (input: WatchSubscriptionInput) => ipcRenderer.invoke('watch:add', input),
  updateWatchSubscription: (id: string, patch: Partial<WatchSubscriptionInput> & { enabled?: boolean }) =>
    ipcRenderer.invoke('watch:update', id, patch),
  removeWatchSubscription: (id: string) => ipcRenderer.invoke('watch:remove', id),
  syncWatchSubscriptionNow: (id: string) => ipcRenderer.invoke('watch:sync-now', id),
  updateTool: (tool) => ipcRenderer.invoke('tool:update', tool),
  getPinterestDebugReport: () => ipcRenderer.invoke('pinterest:debug-report'),
  getPinterestRateLimitState: () => ipcRenderer.invoke('pinterest:rate-state'),
  resumePinterestQueue: () => ipcRenderer.invoke('pinterest:resume-queue'),
  getPinterestArchivePath: (url: string) => ipcRenderer.invoke('pinterest:archive-path', url),
  resetPinterestArchive: (url: string) => ipcRenderer.invoke('pinterest:reset-archive', url),
  openPath: (path: string) => ipcRenderer.invoke('path:open', path),
  showInFolder: (path: string) => ipcRenderer.invoke('path:show', path),
  updateExtensionBridgeConfig: (config: ExtensionBridgeConfig) => ipcRenderer.invoke('extension:update-config', config),
  onExtensionDownloadRequest: (callback: (request: ExtensionDownloadRequest) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: ExtensionDownloadRequest) => callback(request);
    ipcRenderer.on('extension:download-request', listener);
    return () => ipcRenderer.removeListener('extension:download-request', listener);
  },
  onYtDlpUpdateAvailable: (callback: (info: YtDlpUpdateInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: YtDlpUpdateInfo) => callback(info);
    ipcRenderer.on('app:ytdlp-update-available', listener);
    return () => ipcRenderer.removeListener('app:ytdlp-update-available', listener);
  },
  onDownloadHistoryChanged: (callback: (entries: DownloadHistoryEntry[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: DownloadHistoryEntry[]) => callback(entries);
    ipcRenderer.on('history:changed', listener);
    return () => ipcRenderer.removeListener('history:changed', listener);
  },
  onDownloadQueueChanged: (callback: (state: DownloadQueueState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DownloadQueueState) => callback(state);
    ipcRenderer.on('download:queue', listener);
    return () => ipcRenderer.removeListener('download:queue', listener);
  },
  onWatchSubscriptionsChanged: (callback: (watches: WatchSubscription[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, watches: WatchSubscription[]) => callback(watches);
    ipcRenderer.on('watch:changed', listener);
    return () => ipcRenderer.removeListener('watch:changed', listener);
  },
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => callback(progress);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  },
  onDownloadComplete: (callback: (result: DownloadResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: DownloadResult) => callback(result);
    ipcRenderer.on('download:complete', listener);
    return () => ipcRenderer.removeListener('download:complete', listener);
  },
  onMediaThumbnail: (callback: (update: MediaThumbnailUpdate) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: MediaThumbnailUpdate) => callback(update);
    ipcRenderer.on('media:thumbnail', listener);
    return () => ipcRenderer.removeListener('media:thumbnail', listener);
  }
};

contextBridge.exposeInMainWorld('clipForge', api);
