// 'gif' is typed as the template-literal pattern `gif${string}` (which the
// plain string 'gif' satisfies) so existing exhaustive Record<OutputType, ...>
// maps that predate GIF support keep compiling without listing it.
export type OutputType =
  | 'mp4'
  | 'mp3'
  | 'wav'
  | 'm4a'
  | 'webm'
  | `gif${string}`
  | 'subtitles'
  | 'markdown'
  | 'timed-transcript';
export type CookieSource = 'none' | 'chrome' | 'safari' | 'firefox' | 'edge' | 'brave';
export type YtDlpStrategy = 'standard' | 'youtube-default-no-web' | 'youtube-tv' | 'youtube-mobile';
export type Platform = 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'pinterest' | 'x' | 'reddit' | 'twitch' | 'unknown';
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
  | 'reddit-video'
  | 'reddit-post'
  | 'twitch-video'
  | 'twitch-clip'
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

// Post-download ffmpeg treatments for clips: 'vertical' center-crops to 9:16
// for Shorts/Reels/TikTok-style output.
export type ClipCrop = 'vertical';

// Styling for burned-in clip captions (libass force_style on the ffmpeg
// subtitles filter). Defaults: medium size, bottom position.
export interface CaptionStyle {
  size?: 'small' | 'medium' | 'large';
  position?: 'top' | 'middle' | 'bottom';
  // When 'word', captions are burned in as word-by-word highlighted "karaoke"
  // captions (CapCut/Opus-clip style) using an ASS track with per-word timing
  // instead of a plain block subtitle. Requires word-level caption timing;
  // falls back to a block subtitle when word timing is unavailable.
  animate?: 'word';
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface YtDlpUpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export type DownloadHistoryStatus = 'queued' | 'downloading' | 'finished' | 'error' | 'cancelled';
export type DownloadHistorySource = 'app' | 'extension' | 'batch' | 'watch' | 'gallery';

export interface DownloadHistoryEntry {
  id: string;
  url: string;
  title?: string;
  thumbnail?: string;
  label: string;
  outputPath: string;
  status: DownloadHistoryStatus;
  error?: string;
  savedPaths: string[];
  source: DownloadHistorySource;
  createdAt: string;
  completedAt?: string;
}

export interface DownloadQueueState {
  activeDownloadId: string | null;
  activeUrl?: string;
  pendingCount: number;
  activeCount?: number;
}

export type WatchOutputType = 'mp4' | 'mp3' | 'm4a' | 'wav';

export interface WatchSubscription {
  id: string;
  url: string;
  label: string;
  outputType: WatchOutputType;
  outputPath: string;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt?: string;
  lastResult?: string;
  syncing?: boolean;
}

export interface WatchSubscriptionInput {
  url: string;
  label?: string;
  outputType: WatchOutputType;
  outputPath: string;
  intervalMinutes: number;
}

export interface DownloadRequest {
  url: string;
  outputTypes: OutputType[];
  outputPath: string;
  mediaTitle?: string;
  mediaThumbnail?: string;
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
  clipCrop?: ClipCrop;
  burnCaptions?: boolean;
  captionStyle?: CaptionStyle;
  // Custom filename template with {title}/{uploader}/{date}/{id} placeholders.
  outputTemplate?: string;
  // SponsorBlock categories to cut out of the download (e.g. 'sponsor',
  // 'intro', 'outro', 'selfpromo'). Applied via yt-dlp's native
  // --sponsorblock-remove for full (non-clip) video/audio downloads.
  sponsorBlockCategories?: string[];
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
  thumbnail?: string;
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
  format?: 'mp4' | 'mp3' | 'markdown' | 'gif';
  presetId?: string;
  presetName?: string;
  formats?: OutputType[];
  source: 'active-tab' | 'clipboard' | 'youtube-player';
  clipStart?: number;
  clipEnd?: number;
  crop?: ClipCrop;
  burnCaptions?: boolean;
  captionStyle?: CaptionStyle;
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
  startDownload: (request: DownloadRequest, source?: DownloadHistorySource) => Promise<{ downloadId: string }>;
  startBatchDownload: (urls: string[], baseRequest: Omit<DownloadRequest, 'url'>) => Promise<{ queued: number }>;
  startGalleryDownload: (request: GalleryDownloadRequest) => Promise<{ downloadId: string }>;
  cancelDownload: (downloadId: string) => Promise<void>;
  cancelAllDownloads: () => Promise<void>;
  setDownloadConcurrency: (n: number) => Promise<void>;
  getDownloadHistory: () => Promise<DownloadHistoryEntry[]>;
  removeDownloadHistoryEntry: (id: string) => Promise<DownloadHistoryEntry[]>;
  clearDownloadHistory: () => Promise<DownloadHistoryEntry[]>;
  getDownloadCover: (filePath: string) => Promise<string | null>;
  listWatchSubscriptions: () => Promise<WatchSubscription[]>;
  addWatchSubscription: (input: WatchSubscriptionInput) => Promise<WatchSubscription[]>;
  updateWatchSubscription: (id: string, patch: Partial<WatchSubscriptionInput> & { enabled?: boolean }) => Promise<WatchSubscription[]>;
  removeWatchSubscription: (id: string) => Promise<WatchSubscription[]>;
  syncWatchSubscriptionNow: (id: string) => Promise<WatchSubscription[]>;
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
  onYtDlpUpdateAvailable: (callback: (info: YtDlpUpdateInfo) => void) => () => void;
  onDownloadHistoryChanged: (callback: (entries: DownloadHistoryEntry[]) => void) => () => void;
  onDownloadQueueChanged: (callback: (state: DownloadQueueState) => void) => () => void;
  onWatchSubscriptionsChanged: (callback: (subscriptions: WatchSubscription[]) => void) => () => void;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  onDownloadComplete: (callback: (result: DownloadResult) => void) => () => void;
  onMediaThumbnail: (callback: (update: MediaThumbnailUpdate) => void) => () => void;
}
