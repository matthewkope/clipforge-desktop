export type OutputType = 'mp4' | 'mp3' | 'wav' | 'm4a' | 'webm' | 'subtitles' | 'markdown' | 'timed-transcript';
export type CookieSource = 'none' | 'chrome' | 'safari' | 'firefox' | 'edge' | 'brave';
export type YtDlpStrategy = 'standard' | 'youtube-default-no-web' | 'youtube-tv' | 'youtube-mobile';
export type Platform = 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'pinterest' | 'x' | 'unknown';
export type MediaIntent =
  | 'instagram-image'
  | 'instagram-video'
  | 'instagram-carousel'
  | 'tiktok-video'
  | 'facebook-image'
  | 'facebook-video'
  | 'facebook-album'
  | 'pinterest-pin'
  | 'pinterest-board'
  | 'pinterest-section'
  | 'x-video'
  | 'youtube-video'
  | 'youtube-shorts'
  | 'youtube-playlist'
  | 'unknown';
export type MediaItemType = 'image' | 'video' | 'audio' | 'subtitle' | 'unknown';
export type NormalizedMediaType = 'video' | 'audio' | 'image' | 'carousel' | 'album' | 'board' | 'playlist' | 'unknown';
export type DownloadTool = 'yt-dlp' | 'gallery-dl' | 'instaloader';

export interface PinterestSafeModeSettings {
  useBraveCookies: boolean;
  useWorkingTerminalProfile?: boolean;
  pythonExecutablePath?: string;
  cookieMode?: 'brave-pinterest' | 'cookies-txt' | 'none';
  safeMode: boolean;
  delayBetweenDownloads: string;
  delayBetweenRequests: string;
  sleep429: string;
  retries: number;
  debugShowCommandArgs?: boolean;
}

export interface YtDlpFormat {
  format_id: string;
  format_note?: string;
  ext?: string;
  resolution?: string;
  height?: number;
  width?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  abr?: number;
  asr?: number;
}

export interface CaptionTrack {
  ext: string;
  url?: string;
  name?: string;
}

export type CaptionMap = Record<string, CaptionTrack[]>;

export interface PlaylistEntry {
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  duration?: number;
  uploader?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
}

export interface MediaInfo {
  _type?: string;
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string; preference?: number; width?: number; height?: number }>;
  webpage_url: string;
  extractor?: string;
  formats: YtDlpFormat[];
  subtitles?: CaptionMap;
  automatic_captions?: CaptionMap;
  ytDlpStrategy?: YtDlpStrategy;
  isPlaylist?: boolean;
  entries?: PlaylistEntry[];
  playlist_count?: number;
}

export interface QualityOption {
  id: string;
  label: string;
  height?: number;
}

export interface ClipRange {
  start: number;
  end: number;
}

export interface DownloadRequest {
  url: string;
  outputTypes: OutputType[];
  outputPath: string;
  mediaTitle?: string;
  qualityId?: string;
  subtitleLanguage?: string;
  cookieSource?: CookieSource;
  cookieFilePath?: string;
  ytDlpStrategy?: YtDlpStrategy;
  captionsAvailable?: boolean;
  isPlaylist?: boolean;
  extractor?: string;
  whisperModelPath?: string;
  forceOverwrite?: boolean;
  clipRange?: ClipRange;
}

export interface MediaItem {
  id: string;
  appItemId?: string;
  pinId?: string;
  index: number;
  visibleIndex?: number;
  originalGalleryDlIndex?: number;
  type: MediaItemType;
  url?: string;
  pinUrl?: string;
  mediaUrl?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  filename?: string;
  filenameBase?: string;
  extension?: string;
  width?: number;
  height?: number;
  duration?: number;
  boardOwner?: string;
  boardName?: string;
  status?: 'queued' | 'downloading' | 'downloaded' | 'skipped_duplicate' | 'failed_private' | 'failed_not_found' | 'failed_network' | 'failed_unknown';
  failureReason?: string;
  filtered?: boolean;
  duplicate?: boolean;
  selected: boolean;
}

export interface DownloadOption {
  id: string;
  label: string;
  type: NormalizedMediaType | OutputType;
  tool: DownloadTool;
  commandArgs: string[];
}

export interface MediaAnalyzerResult {
  manifestId?: string;
  archivePath?: string;
  platform: Platform;
  intent: MediaIntent;
  sourceUrl: string;
  normalizedSourceUrl?: string;
  title: string;
  creator?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  mediaType: NormalizedMediaType;
  items: MediaItem[];
  availableOutputs: DownloadOption[];
  requiresCookies: boolean;
  rawTool: DownloadTool;
  rawJson: unknown;
  stats?: {
    rawCount: number;
    filteredCount: number;
    duplicateCount: number;
    displayedCount: number;
    failedParseCount?: number;
  };
}

export interface GalleryDownloadRequest {
  url: string;
  platform: Platform;
  tool: DownloadTool;
  outputPath: string;
  selectedItems?: number[];
  manifestId?: string;
  selectedItemIds?: string[];
  retryFailed?: boolean;
  cookieSource?: CookieSource;
  cookieFilePath?: string;
  pinterestSettings?: PinterestSafeModeSettings;
}

export interface PinterestRateLimitState {
  last429At?: string;
  pausedUntil?: string;
  consecutive429Count: number;
  activePinterestJob: boolean;
  pendingPinterestJobs: number;
  paused: boolean;
}

export interface DependencyStatus {
  name: 'yt-dlp' | 'gallery-dl' | 'instaloader' | 'ffmpeg' | 'ffprobe';
  available: boolean;
  optional?: boolean;
  version?: string;
  message?: string;
}

export interface DownloadProgress {
  percent?: number;
  percentText?: string;
  speed?: string;
  eta?: string;
  status: 'idle' | 'starting' | 'downloading' | 'processing' | 'finished' | 'error' | 'cancelled';
  message?: string;
  filename?: string;
  savedPath?: string;
}

export interface DownloadResult {
  success: boolean;
  savedPath?: string;
  savedPaths?: string[];
  failedItems?: Array<{ id: string; label?: string; reason: string }>;
  error?: string;
}

export interface FormatPreset {
  id: string;
  name: string;
  formats: OutputType[];
}

export interface ExtensionBridgeConfig {
  presets: FormatPreset[];
  saveFolder: string;
  downloadActive: boolean;
  subtitleLanguage: string;
  whisperModelPath: string;
  cookieSource: CookieSource;
  cookieFilePath?: string;
  pinterestSettings: PinterestSafeModeSettings;
}

export interface ExtensionDownloadRequest {
  url: string;
  format?: 'mp4' | 'mp3' | 'markdown';
  presetId?: string;
  presetName?: string;
  formats?: OutputType[];
  source: 'active-tab' | 'clipboard' | 'youtube-player';
  clipStart?: number;
  clipEnd?: number;
}

export interface MediaThumbnailUpdate {
  url: string;
  thumbnail: string;
}

export interface AppApi {
  checkDependencies: () => Promise<DependencyStatus[]>;
  detectPlatform: (url: string) => Promise<{ platform: Platform; intent: MediaIntent }>;
  analyzeUrl: (url: string, cookieSource?: CookieSource, cookieFilePath?: string) => Promise<MediaInfo>;
  analyzeMedia: (url: string, cookieSource?: CookieSource, cookieFilePath?: string, pinterestSettings?: PinterestSafeModeSettings) => Promise<MediaAnalyzerResult>;
  listSubtitles: (url: string) => Promise<string>;
  chooseFolder: () => Promise<string | null>;
  chooseCookieFile: () => Promise<string | null>;
  chooseWhisperModel: () => Promise<string | null>;
  startDownload: (request: DownloadRequest) => Promise<{ downloadId: string }>;
  startGalleryDownload: (request: GalleryDownloadRequest) => Promise<{ downloadId: string }>;
  cancelDownload: (downloadId: string) => Promise<void>;
  updateTool: (tool: 'yt-dlp' | 'gallery-dl' | 'instaloader') => Promise<string>;
  getPinterestDebugReport: () => Promise<string>;
  getPinterestRateLimitState: () => Promise<PinterestRateLimitState>;
  resumePinterestQueue: () => Promise<PinterestRateLimitState>;
  getPinterestArchivePath: (url: string) => Promise<string>;
  resetPinterestArchive: (url: string) => Promise<string>;
  openPath: (path: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;
  updateExtensionBridgeConfig: (config: ExtensionBridgeConfig) => Promise<void>;
  onExtensionDownloadRequest: (callback: (request: ExtensionDownloadRequest) => void) => () => void;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  onDownloadComplete: (callback: (result: DownloadResult) => void) => () => void;
  onMediaThumbnail: (callback: (update: MediaThumbnailUpdate) => void) => () => void;
}
