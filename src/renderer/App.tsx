import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  AlertCircle,
  Compass,
  Download,
  Facebook,
  FileAudio,
  FileText,
  Film,
  Folder,
  Home,
  Images,
  Instagram,
  Settings,
  Twitch,
  Youtube
} from 'lucide-react';
import type {
  CaptionStyle,
  ClipCrop,
  ClipRange,
  CookieSource,
  DependencyStatus,
  DownloadHistoryEntry,
  DownloadProgress,
  DownloadQueueState,
  DownloadRequest,
  DownloadResult,
  ExtensionDownloadRequest,
  FormatPreset,
  MediaAnalyzerResult,
  MediaInfo,
  OutputType,
  PinterestRateLimitState,
  PinterestSafeModeSettings,
  Platform,
  QualityOption,
  WatchSubscription,
  WatchSubscriptionInput,
  YtDlpUpdateInfo
} from '../shared/media';
import { CookieSourceSelector } from './components/CookieSourceSelector';
import { DownloadsPanel } from './components/DownloadsPanel';
import { WatchPanel } from './components/WatchPanel';
import { FormatSelector } from './components/FormatSelector';
import { GalleryPreviewCard } from './components/GalleryPreviewCard';
import { MediaItemGrid } from './components/MediaItemGrid';
import { PreviewCard } from './components/PreviewCard';
import { ProgressPanel } from './components/ProgressPanel';
import { QualitySelector } from './components/QualitySelector';
import { SaveFolderPicker } from './components/SaveFolderPicker';
import { UrlInput } from './components/UrlInput';

type Section = Platform | 'downloads' | 'settings' | 'watch';

type NavIcon = ComponentType<{ size?: number; className?: string }>;

const platformSections: Array<{ id: Platform; label: string; icon: NavIcon }> = [
  { id: 'youtube', label: 'YouTube', icon: Youtube },
  { id: 'instagram', label: 'Instagram', icon: Instagram },
  { id: 'tiktok', label: 'TikTok', icon: TikTokIcon },
  { id: 'facebook', label: 'Facebook', icon: Facebook },
  { id: 'pinterest', label: 'Pinterest', icon: PinterestIcon },
  { id: 'x', label: 'X', icon: XIcon },
  { id: 'reddit', label: 'Reddit', icon: RedditIcon },
  { id: 'twitch', label: 'Twitch', icon: Twitch },
  { id: 'unknown', label: 'General URL', icon: Compass }
];

const outputIcons: Record<OutputType, typeof Film> = {
  mp4: Film,
  webm: Film,
  gif: Film,
  mp3: FileAudio,
  wav: FileAudio,
  m4a: FileAudio,
  subtitles: FileText,
  'timed-transcript': FileText,
  markdown: FileText
};

const defaultPinterestSettings: PinterestSafeModeSettings = {
  useBraveCookies: true,
  useWorkingTerminalProfile: true,
  pythonExecutablePath: '',
  cookieMode: 'brave-pinterest',
  safeMode: true,
  delayBetweenDownloads: '4-8',
  delayBetweenRequests: '3-6',
  sleep429: '300',
  retries: 5,
  debugShowCommandArgs: false
};

const whisperModelStorageKey = 'clipforge.whisperModelPath';
const saveFolderStorageKey = 'clipforge.saveFolder';
const downloadConcurrencyStorageKey = 'clipforge.downloadConcurrency';
const filenameTemplateStorageKey = 'clipforge.filenameTemplate';

function App() {
  const [activeSection, setActiveSection] = useState<Section>('youtube');
  const [url, setUrl] = useState('');
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [galleryMedia, setGalleryMedia] = useState<MediaAnalyzerResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [dependencies, setDependencies] = useState<DependencyStatus[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [outputTypes, setOutputTypes] = useState<OutputType[]>(['mp4']);
  const [formatPresets, setFormatPresets] = useState<FormatPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState('');
  const [qualityId, setQualityId] = useState('best');
  const [subtitleLanguage, setSubtitleLanguage] = useState('en.*');
  const [cookieSource, setCookieSource] = useState<CookieSource>('none');
  const [cookieFilePath, setCookieFilePath] = useState('');
  const [pinterestSettings, setPinterestSettings] = useState<PinterestSafeModeSettings>(defaultPinterestSettings);
  const [pinterestRateState, setPinterestRateState] = useState<PinterestRateLimitState | null>(null);
  const [whisperModelPath, setWhisperModelPath] = useState(() => window.localStorage.getItem(whisperModelStorageKey) ?? '');
  const [defaultSaveFolder, setDefaultSaveFolder] = useState(() => window.localStorage.getItem(saveFolderStorageKey) ?? '');
  const [downloadConcurrency, setDownloadConcurrency] = useState(() => {
    const stored = Number(window.localStorage.getItem(downloadConcurrencyStorageKey));
    return Number.isInteger(stored) && stored >= 1 && stored <= 3 ? stored : 1;
  });
  const [filenameTemplate, setFilenameTemplate] = useState(() => window.localStorage.getItem(filenameTemplateStorageKey) ?? '');
  const [saveFolderOverride, setSaveFolderOverride] = useState('');
  const [status, setStatus] = useState('Paste a URL to begin.');
  const [error, setError] = useState('');
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ status: 'idle' });
  const [result, setResult] = useState<DownloadResult | null>(null);
  const [pendingExtensionRequest, setPendingExtensionRequest] = useState<ExtensionDownloadRequest | null>(null);
  const [ytdlpUpdate, setYtdlpUpdate] = useState<YtDlpUpdateInfo | null>(null);
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryEntry[]>([]);
  const [queueState, setQueueState] = useState<DownloadQueueState>({ activeDownloadId: null, pendingCount: 0 });
  const [watchSubscriptions, setWatchSubscriptions] = useState<WatchSubscription[]>([]);
  const lastAutoAnalyzedUrl = useRef('');
  const analyzeRunId = useRef(0);
  const activeAnalysisUrl = useRef('');

  useEffect(() => {
    void refreshDependencies();
    void refreshPinterestRateState();

    const unsubscribeProgress = window.clipForge.onDownloadProgress((nextProgress) => {
      setProgress(nextProgress);
      if (nextProgress.message) {
        setStatus(nextProgress.message);
      }
    });

    const unsubscribeComplete = window.clipForge.onDownloadComplete((nextResult) => {
      setResult(nextResult);
      setDownloadId(null);
      setStatus(nextResult.success ? 'Ready.' : nextResult.error || 'Download failed.');
      if (!nextResult.success) {
        setError(nextResult.error || 'Download failed.');
      }
    });

    const unsubscribeYtDlpUpdate =
      typeof window.clipForge.onYtDlpUpdateAvailable === 'function'
        ? window.clipForge.onYtDlpUpdateAvailable((info) => setYtdlpUpdate(info))
        : () => {};

    if (typeof window.clipForge.getDownloadHistory === 'function') {
      void window.clipForge.getDownloadHistory().then(setDownloadHistory);
    }
    if (typeof window.clipForge.listWatchSubscriptions === 'function') {
      void window.clipForge.listWatchSubscriptions().then(setWatchSubscriptions);
    }
    const unsubscribeHistory =
      typeof window.clipForge.onDownloadHistoryChanged === 'function'
        ? window.clipForge.onDownloadHistoryChanged(setDownloadHistory)
        : () => {};
    const unsubscribeQueue =
      typeof window.clipForge.onDownloadQueueChanged === 'function'
        ? window.clipForge.onDownloadQueueChanged(setQueueState)
        : () => {};
    const unsubscribeWatches =
      typeof window.clipForge.onWatchSubscriptionsChanged === 'function'
        ? window.clipForge.onWatchSubscriptionsChanged(setWatchSubscriptions)
        : () => {};

    const unsubscribeThumbnail =
      typeof window.clipForge.onMediaThumbnail === 'function'
        ? window.clipForge.onMediaThumbnail((update) => {
            if (update.url !== activeAnalysisUrl.current) {
              return;
            }
            setMedia((previous) => (previous ? { ...previous, thumbnail: update.thumbnail } : previous));
          })
        : () => {};

    return () => {
      unsubscribeProgress();
      unsubscribeComplete();
      unsubscribeThumbnail();
      unsubscribeYtDlpUpdate();
      unsubscribeHistory();
      unsubscribeQueue();
      unsubscribeWatches();
    };
  }, []);

  useEffect(() => {
    const trimmedUrl = url.trim();
    if (!looksLikeUrl(trimmedUrl) || trimmedUrl === lastAutoAnalyzedUrl.current) {
      return;
    }

    lastAutoAnalyzedUrl.current = trimmedUrl;
    void analyze(trimmedUrl);
  }, [url]);

  useEffect(() => {
    if (whisperModelPath) {
      window.localStorage.setItem(whisperModelStorageKey, whisperModelPath);
      return;
    }
    window.localStorage.removeItem(whisperModelStorageKey);
  }, [whisperModelPath]);

  useEffect(() => {
    if (defaultSaveFolder) {
      window.localStorage.setItem(saveFolderStorageKey, defaultSaveFolder);
    } else {
      window.localStorage.removeItem(saveFolderStorageKey);
    }
  }, [defaultSaveFolder]);

  useEffect(() => {
    window.localStorage.setItem(downloadConcurrencyStorageKey, String(downloadConcurrency));
    if (typeof window.clipForge.setDownloadConcurrency === 'function') {
      void window.clipForge.setDownloadConcurrency(downloadConcurrency);
    }
  }, [downloadConcurrency]);

  useEffect(() => {
    if (filenameTemplate) {
      window.localStorage.setItem(filenameTemplateStorageKey, filenameTemplate);
    } else {
      window.localStorage.removeItem(filenameTemplateStorageKey);
    }
  }, [filenameTemplate]);

  const saveFolder = saveFolderOverride || defaultSaveFolder;

  useEffect(() => {
    if (typeof window.clipForge.updateExtensionBridgeConfig !== 'function') {
      return;
    }

    void window.clipForge.updateExtensionBridgeConfig({
      presets: formatPresets,
      saveFolder,
      downloadActive: Boolean(downloadId),
      subtitleLanguage,
      whisperModelPath,
      cookieSource,
      cookieFilePath: cookieFilePath || undefined,
      pinterestSettings
    });
  }, [cookieFilePath, cookieSource, downloadId, formatPresets, pinterestSettings, saveFolder, subtitleLanguage, whisperModelPath]);

  useEffect(() => {
    if (typeof window.clipForge.onExtensionDownloadRequest !== 'function') {
      return;
    }

    return window.clipForge.onExtensionDownloadRequest((request) => {
      applyExtensionFormat(request);
    });
  }, [cookieFilePath, cookieSource, dependencies, downloadId, pinterestSettings, saveFolder, subtitleLanguage, whisperModelPath]);

  useEffect(() => {
    if (!pendingExtensionRequest || !sameOutputTypes(outputTypes, extensionRequestFormats(pendingExtensionRequest))) {
      return;
    }

    setPendingExtensionRequest(null);
    setActivePresetId('');
    void downloadFromExtension(pendingExtensionRequest);
  }, [outputTypes, pendingExtensionRequest]);

  const blockingMissingDependencies = dependencies.filter((dependency) => !dependency.available && !dependency.optional);
  const qualityOptions = useMemo(() => getQualityOptions(media), [media]);
  const subtitleOptions = useMemo(() => getSubtitleOptions(media), [media]);
  const isVideoDownloadSection =
    activeSection === 'youtube' ||
    activeSection === 'tiktok' ||
    activeSection === 'twitch' ||
    (activeSection === 'x' && galleryMedia === null) ||
    (activeSection === 'instagram' && galleryMedia === null) ||
    (activeSection === 'facebook' && media !== null) ||
    (activeSection === 'reddit' && media !== null);
  const hasGallery = Boolean(galleryMedia && activeSection !== 'youtube' && activeSection !== 'tiktok' && activeSection !== 'twitch');
  const canDownloadVideo = Boolean(media && saveFolder && outputTypes.length > 0 && hasTool('yt-dlp', dependencies));
  const canDownloadGallery = Boolean(galleryMedia && saveFolder && !downloadId && hasTool(galleryMedia.rawTool, dependencies));

  function goHome() {
    analyzeRunId.current += 1;
    lastAutoAnalyzedUrl.current = '';
    activeAnalysisUrl.current = '';
    setActiveSection('youtube');
    setUrl('');
    setMedia(null);
    setGalleryMedia(null);
    setSelectedItems([]);
    setSaveFolderOverride('');
    setIsAnalyzing(false);
    setError('');
    setResult(null);
    setPendingExtensionRequest(null);
    setStatus('Paste a URL to begin.');
  }

  async function refreshDependencies() {
    const nextDependencies = await window.clipForge.checkDependencies();
    setDependencies(nextDependencies);
  }

  async function refreshPinterestRateState() {
    setPinterestRateState(await window.clipForge.getPinterestRateLimitState());
  }

  function effectiveCookieSource(platform: Platform): CookieSource {
    if (platform === 'pinterest' && pinterestSettings.cookieMode === 'brave-pinterest') {
      return 'brave';
    }
    if (platform === 'pinterest' && pinterestSettings.cookieMode === 'none') {
      return 'none';
    }
    // Instagram, Facebook, and X require login for most photo metadata;
    // default to Brave cookies (matching the Pinterest approach) when no
    // cookie source is configured.
    if ((platform === 'instagram' || platform === 'facebook' || platform === 'x') && cookieSource === 'none' && !cookieFilePath) {
      return 'brave';
    }
    return cookieSource;
  }

  function effectiveCookieFilePath(platform: Platform): string | undefined {
    if (platform === 'pinterest') {
      return undefined;
    }
    return cookieFilePath || undefined;
  }

  function pasteAndDownload(targetUrl: string) {
    // Pasting several links at once queues them all as a batch.
    const urls = extractUrls(targetUrl);
    if (urls.length > 1) {
      void startBatch(urls);
      return;
    }
    const trimmedUrl = targetUrl.trim();
    lastAutoAnalyzedUrl.current = trimmedUrl;
    setUrl(trimmedUrl);
    void analyze(trimmedUrl, true);
  }

  async function startBatch(urls: string[]) {
    if (!saveFolder) {
      setError('Choose a default download folder in Settings before batch downloading.');
      return;
    }
    setError('');
    setResult(null);
    try {
      const { queued } = await window.clipForge.startBatchDownload(urls, {
        outputTypes,
        outputPath: saveFolder,
        subtitleLanguage,
        cookieSource,
        cookieFilePath: cookieFilePath || undefined,
        whisperModelPath: whisperModelPath || undefined,
        outputTemplate: filenameTemplate || undefined
      });
      setActiveSection('downloads');
      setStatus(`Queued ${queued} download${queued === 1 ? '' : 's'}.`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function analyze(targetUrl = url.trim(), autoDownload = false) {
    const currentRunId = analyzeRunId.current + 1;
    analyzeRunId.current = currentRunId;
    activeAnalysisUrl.current = targetUrl;
    setError('');
    setResult(null);
    setMedia(null);
    setGalleryMedia(null);
    setIsAnalyzing(true);
    setStatus('Analyzing media...');

    try {
      const detected = await window.clipForge.detectPlatform(targetUrl);
      if (currentRunId !== analyzeRunId.current) {
        return;
      }
      setActiveSection(detected.platform === 'unknown' ? 'unknown' : detected.platform);

      if (
        detected.platform === 'youtube' ||
        detected.platform === 'tiktok' ||
        detected.platform === 'twitch' ||
        (detected.platform === 'instagram' && detected.intent === 'instagram-video')
      ) {
        const info = await window.clipForge.analyzeUrl(targetUrl, cookieSource, cookieFilePath || undefined);
        if (detected.platform === 'tiktok' && !hasVideoFormats(info)) {
          throw new Error('The TikTok section is currently focused on videos.');
        }
        if (detected.platform === 'twitch' && !hasVideoFormats(info)) {
          throw new Error('Twitch did not provide a downloadable video or clip for this URL.');
        }
        if (currentRunId !== analyzeRunId.current) {
          return;
        }
        setMedia(info);
        setQualityId('best');
        const preferredLanguage = preferredSubtitleLanguage(info);
        setSubtitleLanguage(preferredLanguage);
        if (autoDownload) {
          await startAnalyzedVideoDownload(info, targetUrl, preferredLanguage);
          return;
        }
      } else if (detected.platform === 'x') {
        // Video tweets get the yt-dlp workflow; image/carousel tweets fall
        // back to the selectable gallery grid via gallery-dl.
        try {
          const info = await window.clipForge.analyzeUrl(targetUrl, cookieSource, cookieFilePath || undefined);
          if (!hasVideoFormats(info) || !isNativeTwitterVideo(info)) {
            throw new Error('This tweet has no video.');
          }
          if (currentRunId !== analyzeRunId.current) {
            return;
          }
          setMedia(info);
          setQualityId('best');
          const preferredLanguage = preferredSubtitleLanguage(info);
          setSubtitleLanguage(preferredLanguage);
          if (autoDownload) {
            await startAnalyzedVideoDownload(info, targetUrl, preferredLanguage);
            return;
          }
        } catch {
          const info = await window.clipForge.analyzeMedia(
            targetUrl,
            effectiveCookieSource('x'),
            effectiveCookieFilePath('x')
          );
          if (currentRunId !== analyzeRunId.current) {
            return;
          }
          setGalleryMedia(info);
          setSelectedItems(info.items.map((item) => item.index));
          if (autoDownload) {
            await startAnalyzedGalleryDownload(info);
            return;
          }
        }
      } else if (detected.platform === 'reddit') {
        // Reddit v.redd.it video posts use the yt-dlp workflow; image and
        // gallery posts fall back to the selectable gallery grid via gallery-dl.
        try {
          const info = await window.clipForge.analyzeUrl(targetUrl, cookieSource, cookieFilePath || undefined);
          if (!hasVideoFormats(info)) {
            throw new Error('This Reddit post has no video.');
          }
          if (currentRunId !== analyzeRunId.current) {
            return;
          }
          setMedia(info);
          setQualityId('best');
          const preferredLanguage = preferredSubtitleLanguage(info);
          setSubtitleLanguage(preferredLanguage);
          if (autoDownload) {
            await startAnalyzedVideoDownload(info, targetUrl, preferredLanguage);
            return;
          }
        } catch {
          const info = await window.clipForge.analyzeMedia(
            targetUrl,
            effectiveCookieSource('reddit'),
            effectiveCookieFilePath('reddit')
          );
          if (currentRunId !== analyzeRunId.current) {
            return;
          }
          setGalleryMedia(info);
          setSelectedItems(info.items.map((item) => item.index));
          if (autoDownload) {
            await startAnalyzedGalleryDownload(info);
            return;
          }
        }
      } else if (detected.platform === 'instagram') {
        // Instagram /p/ posts: photos and carousels analyze as a gallery;
        // video posts fall back to the yt-dlp video workflow.
        const info = await window.clipForge.analyzeMedia(
          targetUrl,
          effectiveCookieSource('instagram'),
          effectiveCookieFilePath('instagram')
        );
        if (currentRunId !== analyzeRunId.current) {
          return;
        }
        if (info.mediaType === 'video' && info.rawTool === 'yt-dlp') {
          const videoInfo = await window.clipForge.analyzeUrl(targetUrl, cookieSource, cookieFilePath || undefined);
          if (currentRunId !== analyzeRunId.current) {
            return;
          }
          setMedia(videoInfo);
          setQualityId('best');
          const preferredLanguage = preferredSubtitleLanguage(videoInfo);
          setSubtitleLanguage(preferredLanguage);
          if (autoDownload) {
            await startAnalyzedVideoDownload(videoInfo, targetUrl, preferredLanguage);
            return;
          }
        } else {
          setGalleryMedia(info);
          setSelectedItems(info.items.map((item) => item.index));
          if (autoDownload) {
            await startAnalyzedGalleryDownload(info);
            return;
          }
        }
      } else if (detected.platform === 'facebook' && detected.intent === 'facebook-video') {
        // Facebook video URLs: try yt-dlp for full format/quality controls, fall back to gallery-dl
        try {
          const info = await window.clipForge.analyzeUrl(targetUrl, cookieSource, cookieFilePath || undefined);
          if (currentRunId !== analyzeRunId.current) {
            return;
          }
          setMedia(info);
          setQualityId('best');
          const preferredLanguage = preferredSubtitleLanguage(info);
          setSubtitleLanguage(preferredLanguage);
          if (autoDownload) {
            await startAnalyzedVideoDownload(info, targetUrl, preferredLanguage);
            return;
          }
        } catch {
          const info = await window.clipForge.analyzeMedia(
            targetUrl,
            effectiveCookieSource(detected.platform),
            effectiveCookieFilePath(detected.platform),
            pinterestSettings
          );
          if (currentRunId !== analyzeRunId.current) {
            return;
          }
          setGalleryMedia(info);
          setSelectedItems(info.items.map((item) => item.index));
          if (autoDownload) {
            await startAnalyzedGalleryDownload(info);
            return;
          }
        }
      } else {
        const info = await window.clipForge.analyzeMedia(
          targetUrl,
          effectiveCookieSource(detected.platform),
          effectiveCookieFilePath(detected.platform),
          pinterestSettings
        );
        if (currentRunId !== analyzeRunId.current) {
          return;
        }
        setGalleryMedia(info);
        setSelectedItems(info.items.map((item) => item.index));
        if (autoDownload) {
          await startAnalyzedGalleryDownload(info);
          return;
        }
      }

      setStatus('Analysis complete.');
    } catch (caught) {
      if (currentRunId !== analyzeRunId.current) {
        return;
      }
      setError(errorMessage(caught));
      setStatus('Analysis failed.');
    } finally {
      if (currentRunId === analyzeRunId.current) {
        setIsAnalyzing(false);
      }
    }
  }

  async function chooseFolder() {
    const folder = await window.clipForge.chooseFolder();
    if (folder) {
      setSaveFolderOverride(folder);
    }
  }

  async function chooseDefaultFolder() {
    const folder = await window.clipForge.chooseFolder();
    if (folder) {
      setDefaultSaveFolder(folder);
    }
  }

  async function startAnalyzedVideoDownload(info: MediaInfo, targetUrl: string, language: string) {
    if (!saveFolder) {
      throw new Error('Choose a default download folder in Settings before pasting a URL for automatic download.');
    }

    setProgress({ status: 'starting', message: 'Starting automatic download...' });
    setStatus('Starting automatic download...');
    const started = await window.clipForge.startDownload(
      buildVideoDownloadRequest(info, targetUrl, {
        outputTypes,
        outputPath: saveFolder,
        subtitleLanguage: language,
        cookieSource,
        cookieFilePath,
        whisperModelPath,
        outputTemplate: filenameTemplate || undefined
      })
    );
    setDownloadId(started.downloadId);
  }

  async function startAnalyzedGalleryDownload(info: MediaAnalyzerResult) {
    if (!saveFolder) {
      throw new Error('Choose a default download folder in Settings before pasting a URL for automatic download.');
    }
    if (downloadId) {
      throw new Error('A download is already active.');
    }

    setProgress({ status: 'starting', message: 'Starting automatic gallery download...' });
    setStatus('Starting automatic gallery download...');
    const started = await window.clipForge.startGalleryDownload({
      url: info.sourceUrl,
      platform: info.platform,
      tool: info.rawTool,
      outputPath: saveFolder,
      thumbnail: info.thumbnail,
      manifestId: info.manifestId,
      cookieSource: effectiveCookieSource(info.platform),
      cookieFilePath: effectiveCookieFilePath(info.platform),
      pinterestSettings: info.platform === 'pinterest' ? pinterestSettings : undefined
    });
    setDownloadId(started.downloadId);
  }

  async function chooseCookieFile() {
    const path = await window.clipForge.chooseCookieFile();
    if (path) {
      setCookieFilePath(path);
      setCookieSource('none');
    }
  }

  async function chooseWhisperModel() {
    const modelPath = await window.clipForge.chooseWhisperModel();
    if (modelPath) {
      setWhisperModelPath(modelPath);
    }
  }

  async function downloadVideo() {
    if (!media || !saveFolder) {
      return;
    }

    setError('');
    setResult(null);
    setProgress({ status: 'starting', message: 'Starting download...' });
    setStatus('Starting download...');

    try {
      const started = await window.clipForge.startDownload(
        buildVideoDownloadRequest(media, url.trim(), {
          outputTypes,
          outputPath: saveFolder,
          subtitleLanguage,
          cookieSource,
          cookieFilePath,
          whisperModelPath,
          qualityId,
          outputTemplate: filenameTemplate || undefined
        })
      );
      setDownloadId(started.downloadId);
    } catch (caught) {
      setError(errorMessage(caught));
      setProgress({ status: 'error', message: errorMessage(caught) });
      setStatus('Download could not start.');
    }
  }

  function applyExtensionFormat(request: ExtensionDownloadRequest) {
    const formats = extensionRequestFormats(request);
    if (formats.length === 0) {
      setError('The extension did not provide a usable format selection.');
      return;
    }

    setOutputTypes(formats);
    setActivePresetId(request.presetId ?? '');
    setPendingExtensionRequest(request);
    setStatus(`Extension: selected ${extensionRequestLabel(request)}. Starting download...`);
  }

  async function downloadFromExtension(request: ExtensionDownloadRequest) {
    if (!saveFolder) {
      setError('Choose a save folder before downloading from the browser extension.');
      return;
    }

    lastAutoAnalyzedUrl.current = request.url;
    activeAnalysisUrl.current = request.url;
    setUrl(request.url);
    setError('');
    setResult(null);
    setMedia(null);
    setGalleryMedia(null);
    setIsAnalyzing(true);
    const formats = extensionRequestFormats(request);
    const selectionLabel = extensionRequestLabel(request);
    setStatus(`Extension: analyzing for ${selectionLabel}...`);

    try {
      const detected = await window.clipForge.detectPlatform(request.url);
      setActiveSection(detected.platform === 'unknown' ? 'unknown' : detected.platform);

      if (
        detected.platform === 'youtube' ||
        detected.platform === 'instagram' ||
        detected.platform === 'tiktok' ||
        detected.platform === 'x' ||
        detected.platform === 'twitch' ||
        detected.platform === 'reddit'
      ) {
        const info = await window.clipForge.analyzeUrl(request.url, cookieSource, cookieFilePath || undefined);
        if (detected.platform === 'instagram' && !hasVideoFormats(info)) {
          throw new Error(`${selectionLabel} cannot be downloaded from this Instagram gallery post.`);
        }
        if (detected.platform === 'tiktok' && !hasVideoFormats(info)) {
          throw new Error('TikTok did not provide a downloadable video for this URL.');
        }
        setMedia(info);
        setQualityId('best');
        const started = await window.clipForge.startDownload(
          buildVideoDownloadRequest(info, request.url, {
            outputTypes: formats,
            outputPath: saveFolder,
            subtitleLanguage,
            cookieSource,
            cookieFilePath,
            whisperModelPath,
            forceOverwrite: true,
            clipRange: extensionClipRange(request),
            clipCrop: request.crop,
            burnCaptions: request.burnCaptions,
            captionStyle: request.captionStyle,
            outputTemplate: filenameTemplate || undefined
          }),
          'extension'
        );
        setDownloadId(started.downloadId);
        setProgress({ status: 'starting', message: `Starting ${selectionLabel}...` });
        setStatus(`Extension: downloading ${selectionLabel}...`);
        return;
      }

      if (detected.platform === 'facebook' && detected.intent === 'facebook-video') {
        try {
          const info = await window.clipForge.analyzeUrl(request.url, cookieSource, cookieFilePath || undefined);
          setMedia(info);
          setQualityId('best');
          const started = await window.clipForge.startDownload(
            buildVideoDownloadRequest(info, request.url, {
              outputTypes: formats,
              outputPath: saveFolder,
              subtitleLanguage,
              cookieSource,
              cookieFilePath,
              whisperModelPath,
              forceOverwrite: true,
              captionStyle: request.captionStyle,
              outputTemplate: filenameTemplate || undefined
            }),
            'extension'
          );
          setDownloadId(started.downloadId);
          setProgress({ status: 'starting', message: `Starting ${selectionLabel}...` });
          setStatus(`Extension: downloading ${selectionLabel}...`);
          return;
        } catch {
          // Fall through to gallery-dl for Facebook links yt-dlp cannot analyze.
        }
      }

      throw new Error(`${selectionLabel} cannot be downloaded because this link requires a gallery download.`);
    } catch (caught) {
      setError(errorMessage(caught));
      setProgress({ status: 'error', message: errorMessage(caught) });
      setStatus('Extension download could not start.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function downloadGallery(allItems: boolean) {
    if (!galleryMedia || !saveFolder) {
      return;
    }

    const isPinterest = galleryMedia.platform === 'pinterest';
    const pinterestAllVisibleSelected = isPinterest && !allItems && selectedItems.length === galleryMedia.items.length;
    const shouldDownloadAll = allItems || pinterestAllVisibleSelected;
    const selected = shouldDownloadAll ? undefined : selectedItems;
    const selectedItemIds =
      isPinterest && !shouldDownloadAll
        ? galleryMedia.items
            .filter((item) => selectedItems.includes(item.index))
            .map((item) => item.appItemId || item.id)
        : undefined;
    if (!allItems && selectedItems.length === 0) {
      setError('Choose at least one item to download.');
      return;
    }

    setError('');
    setResult(null);
    setProgress({ status: 'starting', message: 'Starting gallery download...' });
    setStatus('Starting gallery download...');

    try {
      const started = await window.clipForge.startGalleryDownload({
        url: galleryMedia.sourceUrl,
        platform: galleryMedia.platform,
        tool: galleryMedia.rawTool,
        outputPath: saveFolder,
        thumbnail: galleryMedia.thumbnail,
        selectedItems: selected,
        selectedItemIds,
        manifestId: galleryMedia.manifestId,
        cookieSource: effectiveCookieSource(galleryMedia.platform),
        cookieFilePath: effectiveCookieFilePath(galleryMedia.platform),
        pinterestSettings: galleryMedia.platform === 'pinterest' ? pinterestSettings : undefined
      });
      setDownloadId(started.downloadId);
    } catch (caught) {
      setError(errorMessage(caught));
      setProgress({ status: 'error', message: errorMessage(caught) });
      setStatus('Download could not start.');
    }
  }

  async function cancelDownload() {
    if (!downloadId) {
      return;
    }
    await window.clipForge.cancelDownload(downloadId);
    setDownloadId(null);
    setProgress({ status: 'cancelled', message: 'Download cancelled.' });
  }

  async function updateTool(tool: 'yt-dlp' | 'gallery-dl' | 'instaloader') {
    setStatus(`Updating ${tool}...`);
    try {
      await window.clipForge.updateTool(tool);
      await refreshDependencies();
      setStatus(`${tool} updated.`);
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus(`${tool} update failed.`);
    }
  }

  async function retryFailedPinterest() {
    if (!galleryMedia?.manifestId || !saveFolder) {
      return;
    }

    setError('');
    setResult(null);
    setProgress({ status: 'starting', message: 'Retrying failed Pinterest items...' });
    setStatus('Retrying failed Pinterest items...');
    try {
      const started = await window.clipForge.startGalleryDownload({
        url: galleryMedia.sourceUrl,
        platform: 'pinterest',
        tool: 'gallery-dl',
        outputPath: saveFolder,
        thumbnail: galleryMedia.thumbnail,
        manifestId: galleryMedia.manifestId,
        retryFailed: true,
        cookieSource: effectiveCookieSource('pinterest'),
        cookieFilePath: effectiveCookieFilePath('pinterest'),
        pinterestSettings
      });
      setDownloadId(started.downloadId);
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus('Retry could not start.');
    }
  }

  async function copyPinterestDebugReport() {
    const report = await window.clipForge.getPinterestDebugReport();
    await navigator.clipboard.writeText(report);
    setStatus('Pinterest debug report copied.');
  }

  async function resumePinterestQueue() {
    setPinterestRateState(await window.clipForge.resumePinterestQueue());
    setStatus('Pinterest queue resumed.');
  }

  async function resetPinterestArchive() {
    const targetUrl = galleryMedia?.sourceUrl || url.trim();
    if (!looksLikeUrl(targetUrl)) {
      setError('Analyze a Pinterest board before resetting its archive.');
      return;
    }
    const confirmed = window.confirm('This will allow previously downloaded pins from this board to download again.');
    if (!confirmed) {
      return;
    }
    const archivePath = await window.clipForge.resetPinterestArchive(targetUrl);
    setStatus(`Pinterest archive reset: ${archivePath}`);
  }

  const SelectedIcon = isVideoDownloadSection ? outputIcons[outputTypes[0] ?? 'mp4'] : Images;
  const detectedPlatform = platformSections.find((section) => section.id === activeSection);
  const OutputHeadingIcon = looksLikeUrl(url.trim()) && detectedPlatform ? detectedPlatform.icon : SelectedIcon;
  const needsQuality = isVideoDownloadSection && outputTypes.some((type) => type === 'mp4' || type === 'webm');
  // "Home" is any platform view (not the Downloads/Settings/Watch tabs) — there
  // the title click is a no-op, so it should not show the clickable hover style.
  const isHome = activeSection !== 'downloads' && activeSection !== 'settings' && activeSection !== 'watch';
  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="brand-heading">
          <div className="brand-line">
            <p className="eyebrow">ClipForge</p>
            <div className="supported-platforms" aria-label="Supported social media platforms">
              <span className="brand-youtube" title="YouTube"><Youtube size={12} /></span>
              <span className="brand-instagram" title="Instagram"><Instagram size={12} /></span>
              <span className="brand-tiktok" title="TikTok"><TikTokIcon size={12} /></span>
              <span className="brand-facebook" title="Facebook"><Facebook size={12} /></span>
              <span className="brand-pinterest" title="Pinterest"><PinterestIcon size={12} /></span>
              <span className="brand-x" title="X / Twitter"><XIcon size={11} /></span>
              <span className="brand-reddit" title="Reddit"><RedditIcon size={12} /></span>
              <span className="brand-twitch" title="Twitch"><Twitch size={12} /></span>
            </div>
          </div>
          <h1>
            <button
              type="button"
              className={`app-title-button ${isHome ? 'is-home' : ''}`}
              onClick={goHome}
              disabled={isHome}
              title={isHome ? undefined : 'Go home'}
              aria-label="Go home"
            >
              Social Media Downloader
            </button>
          </h1>
        </div>
        <div className="topbar-actions">
          <button
            className={`icon-button ${activeSection === 'watch' ? 'selected' : ''}`}
            onClick={() => setActiveSection('watch')}
            title="Watch folders"
            aria-label="Watch folders"
          >
            <Folder size={21} />
          </button>
          <button
            className={`icon-button ${activeSection === 'downloads' ? 'selected' : ''}`}
            onClick={() => setActiveSection('downloads')}
            title="Downloads"
            aria-label="Downloads"
          >
            <Download size={21} />
          </button>
          <button
            className={`icon-button ${activeSection === 'settings' ? 'selected' : ''}`}
            onClick={() => setActiveSection('settings')}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={21} />
          </button>
          <button
            className={`icon-button ${activeSection !== 'downloads' && activeSection !== 'settings' && activeSection !== 'watch' ? 'selected' : ''}`}
            onClick={goHome}
            title="Home"
            aria-label="Home"
          >
            <Home size={21} />
          </button>
        </div>
      </section>

      <UrlInput value={url} onChange={setUrl} onPasteUrl={pasteAndDownload} onAnalyze={analyze} isAnalyzing={isAnalyzing} />

      {blockingMissingDependencies.length > 0 && (
        <section className="setup-message">
          <AlertCircle size={22} />
          <div>
            <h2>Setup needed</h2>
            <p>Install missing tools with python -m pip install yt-dlp gallery-dl instaloader. The app never asks for social media passwords.</p>
            <ul>
              {blockingMissingDependencies.map((dependency) => (
                <li key={dependency.name}>{dependency.message}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {ytdlpUpdate?.updateAvailable && (
        <section className="setup-message">
          <AlertCircle size={22} />
          <div>
            <h2>yt-dlp update available</h2>
            <p>
              Installed {ytdlpUpdate.current}, latest {ytdlpUpdate.latest}. Updating keeps YouTube and other downloads
              working when sites change.
            </p>
            <div className="action-row">
              <button
                className="secondary-button"
                onClick={() => {
                  setYtdlpUpdate(null);
                  void updateTool('yt-dlp');
                }}
              >
                Update yt-dlp
              </button>
              <button className="secondary-button" onClick={() => setYtdlpUpdate(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </section>
      )}

      {activeSection === 'settings' ? (
        <SettingsPanel
          dependencies={dependencies}
          cookieSource={cookieSource}
          cookieFilePath={cookieFilePath}
          onCookieSourceChange={setCookieSource}
          onChooseCookieFile={chooseCookieFile}
          onClearCookieFile={() => setCookieFilePath('')}
          onUpdateTool={updateTool}
          pinterestSettings={pinterestSettings}
          onPinterestSettingsChange={setPinterestSettings}
          pinterestRateState={pinterestRateState}
          onResumePinterestQueue={resumePinterestQueue}
          currentPinterestArchivePath={galleryMedia?.platform === 'pinterest' ? galleryMedia.archivePath : undefined}
          currentPinterestUrl={galleryMedia?.platform === 'pinterest' ? galleryMedia.sourceUrl : undefined}
          onResetPinterestArchive={resetPinterestArchive}
          subtitleLanguage={subtitleLanguage}
          subtitleOptions={subtitleOptions}
          onSubtitleLanguageChange={setSubtitleLanguage}
          whisperModelPath={whisperModelPath}
          onChooseWhisperModel={chooseWhisperModel}
          onClearWhisperModel={() => setWhisperModelPath('')}
          defaultSaveFolder={defaultSaveFolder}
          onChooseDefaultFolder={chooseDefaultFolder}
          onClearDefaultFolder={() => setDefaultSaveFolder('')}
          downloadConcurrency={downloadConcurrency}
          onDownloadConcurrencyChange={setDownloadConcurrency}
          filenameTemplate={filenameTemplate}
          onFilenameTemplateChange={setFilenameTemplate}
        />
      ) : activeSection === 'watch' ? (
        <WatchPanel
          watches={watchSubscriptions}
          saveFolder={saveFolder || undefined}
          onAddWatch={async (input: WatchSubscriptionInput) => {
            setWatchSubscriptions(await window.clipForge.addWatchSubscription(input));
          }}
          onUpdateWatch={(id, patch) => void window.clipForge.updateWatchSubscription(id, patch).then(setWatchSubscriptions)}
          onRemoveWatch={(id) => void window.clipForge.removeWatchSubscription(id).then(setWatchSubscriptions)}
          onSyncWatch={(id) => void window.clipForge.syncWatchSubscriptionNow(id).then(setWatchSubscriptions)}
          onOpenPath={(path) => void window.clipForge.openPath(path)}
          onChooseFolder={() => window.clipForge.chooseFolder()}
        />
      ) : activeSection === 'downloads' ? (
        <DownloadsPanel
          progress={progress}
          result={result}
          saveFolder={saveFolder || undefined}
          queue={queueState}
          history={downloadHistory}
          onCancelAll={() => void window.clipForge.cancelAllDownloads()}
          onRedownload={(entry) => pasteAndDownload(entry.url)}
          onRemoveEntry={(id) => void window.clipForge.removeDownloadHistoryEntry(id).then(setDownloadHistory)}
          onClearHistory={() => void window.clipForge.clearDownloadHistory().then(setDownloadHistory)}
          onOpenPath={(path) => void window.clipForge.openPath(path)}
          onShowInFolder={(path) => void window.clipForge.showInFolder(path)}
        />
      ) : (
        <section className="workspace">
          <div className="primary-column">
            {isVideoDownloadSection ? <PreviewCard media={media} /> : <GalleryPreviewCard media={galleryMedia} />}
            {hasGallery && galleryMedia && galleryMedia.items.length > 1 && (
              <>
                {galleryMedia.platform === 'pinterest' && (
                  <section className="pinterest-stats">
                    <span>Raw {galleryMedia.stats?.rawCount ?? galleryMedia.items.length}</span>
                    <span>Displayed {galleryMedia.stats?.displayedCount ?? galleryMedia.items.length}</span>
                    <span>Filtered {galleryMedia.stats?.filteredCount ?? 0}</span>
                    <span>Duplicates {galleryMedia.stats?.duplicateCount ?? 0}</span>
                  </section>
                )}
                <MediaItemGrid items={galleryMedia.items} selectedItems={selectedItems} onChange={setSelectedItems} />
              </>
            )}
            {error && (
              <div className="error-panel">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}
          </div>

          <aside className="control-panel">
            <div className="panel-heading">
              <span className={`output-heading-icon ${detectedPlatform && looksLikeUrl(url.trim()) ? 'platform' : ''}`}>
                <OutputHeadingIcon size={24} />
              </span>
              <div>
                <h2>{sectionTitle(activeSection)} Output</h2>
                <p>{status}</p>
              </div>
            </div>

            {isVideoDownloadSection ? (
              <>
                <FormatSelector
                  value={outputTypes}
                  onChange={(formats) => {
                    setActivePresetId('');
                    setOutputTypes(formats);
                  }}
                  onPresetsChange={setFormatPresets}
                  activePresetId={activePresetId}
                />
                {needsQuality && <QualitySelector value={qualityId} options={qualityOptions} onChange={setQualityId} />}
              </>
            ) : (
              <section className="gallery-actions-panel">
                <span className="media-type-badge">{galleryMedia?.mediaType ?? sectionTitle(activeSection)}</span>
                <p className="hint">
                  {activeSection === 'facebook'
                    ? 'Facebook photos and albums download via gallery-dl. Paste a video URL to get MP4/MP3/WAV format controls.'
                    : activeSection === 'instagram'
                      ? 'Instagram photos and carousels download via gallery-dl. Paste a reel or video URL to get MP4/MP3/WAV format controls.'
                      : activeSection === 'x'
                        ? 'Image tweets download via gallery-dl, using your browser (Brave) cookies for login-gated posts. Paste a video tweet to get MP4/MP3/WAV format controls.'
                        : activeSection === 'pinterest'
                          ? 'Pinterest pins, boards, and sections use gallery-dl.'
                          : activeSection === 'reddit'
                            ? 'Reddit image and gallery posts download via gallery-dl. Paste a v.redd.it video post to get MP4/MP3/WAV format controls.'
                            : 'General URLs try yt-dlp first, then gallery-dl.'}
                </p>
              </section>
            )}

            <SaveFolderPicker
              value={saveFolderOverride}
              onChoose={chooseFolder}
              onClear={() => setSaveFolderOverride('')}
              label="Save override"
              placeholder={defaultSaveFolder ? `Default: ${defaultSaveFolder}` : 'Set a default folder in Settings'}
            />

            {isVideoDownloadSection ? (
              <div className="action-row">
                <button className="primary-button" onClick={downloadVideo} disabled={!canDownloadVideo}>
                  <Download size={18} />
                  Download
                </button>
                <button className="secondary-button" onClick={cancelDownload} disabled={!downloadId}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="stacked-actions">
                <button className="primary-button" onClick={() => downloadGallery(false)} disabled={!canDownloadGallery || selectedItems.length === 0}>
                  <Download size={18} />
                  Download selected
                </button>
                <button className="secondary-button" onClick={() => downloadGallery(true)} disabled={!canDownloadGallery}>
                  Download all
                </button>
                {galleryMedia?.platform === 'pinterest' && (
                  <>
                    <button className="secondary-button" onClick={retryFailedPinterest} disabled={!canDownloadGallery || !galleryMedia.manifestId}>
                      Retry failed
                    </button>
                    <button className="secondary-button" onClick={copyPinterestDebugReport}>
                      Copy debug report
                    </button>
                    <button className="secondary-button" onClick={resetPinterestArchive} disabled={!galleryMedia.sourceUrl}>
                      Reset archive for this board
                    </button>
                    <button className="secondary-button" onClick={resumePinterestQueue} disabled={!pinterestRateState?.paused}>
                      Resume Pinterest queue
                    </button>
                  </>
                )}
                <button className="secondary-button" onClick={cancelDownload} disabled={!downloadId}>
                  Cancel
                </button>
              </div>
            )}

            <ProgressPanel progress={progress} result={result} saveFolder={saveFolder || undefined} onOpenFolder={(path) => window.clipForge.openPath(path)} />
          </aside>
        </section>
      )}
    </main>
  );
}

function TikTokIcon({ size = 24, className }: { size?: number; className?: string }) {
  const notePath = 'M14.6 3v10.1a4.4 4.4 0 1 1-3.5-4.3M14.6 3c.4 2.5 1.9 4 4.4 4.5';

  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={notePath} transform="translate(-1 0.8)" stroke="#25f4ee" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d={notePath} transform="translate(1 -0.3)" stroke="#fe2c55" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d={notePath} stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinterestIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.2a9.8 9.8 0 0 0-3.57 18.92c-.08-1.58-.02-3.47.4-5.25l1.26-5.33s-.32-.64-.32-1.58c0-1.48.86-2.59 1.93-2.59.91 0 1.35.68 1.35 1.5 0 .92-.58 2.29-.88 3.56-.25 1.06.53 1.93 1.58 1.93 1.9 0 3.36-2 3.36-4.89 0-2.55-1.84-4.34-4.46-4.34-3.04 0-4.82 2.28-4.82 4.63 0 .92.35 1.9.8 2.44.08.1.1.18.07.29l-.3 1.2c-.05.2-.16.24-.37.15-1.38-.64-2.24-2.66-2.24-4.28 0-3.49 2.53-6.69 7.31-6.69 3.84 0 6.82 2.74 6.82 6.39 0 3.81-2.4 6.88-5.73 6.88-1.12 0-2.17-.58-2.53-1.27l-.69 2.62c-.25.96-.92 2.17-1.37 2.91.99.31 2.04.48 3.13.48A9.8 9.8 0 1 0 12 2.2Z" />
    </svg>
  );
}

function RedditIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0Zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.745-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701ZM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249Zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249Zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095Z" />
    </svg>
  );
}

function XIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-6.39L6.48 22H3.36l7.27-8.31L2.98 2h6.4l4.42 5.84L18.9 2Zm-1.1 17.84h1.72L8.44 4.05H6.6L17.8 19.84Z" />
    </svg>
  );
}

function SettingsPanel({
  dependencies,
  cookieSource,
  cookieFilePath,
  onCookieSourceChange,
  onChooseCookieFile,
  onClearCookieFile,
  onUpdateTool,
  pinterestSettings,
  onPinterestSettingsChange,
  pinterestRateState,
  onResumePinterestQueue,
  currentPinterestArchivePath,
  currentPinterestUrl,
  onResetPinterestArchive,
  subtitleLanguage,
  subtitleOptions,
  onSubtitleLanguageChange,
  whisperModelPath,
  onChooseWhisperModel,
  onClearWhisperModel,
  defaultSaveFolder,
  onChooseDefaultFolder,
  onClearDefaultFolder,
  downloadConcurrency,
  onDownloadConcurrencyChange,
  filenameTemplate,
  onFilenameTemplateChange
}: {
  dependencies: DependencyStatus[];
  cookieSource: CookieSource;
  cookieFilePath: string;
  onCookieSourceChange: (source: CookieSource) => void;
  onChooseCookieFile: () => void;
  onClearCookieFile: () => void;
  onUpdateTool: (tool: 'yt-dlp' | 'gallery-dl' | 'instaloader') => void;
  pinterestSettings: PinterestSafeModeSettings;
  onPinterestSettingsChange: (settings: PinterestSafeModeSettings) => void;
  pinterestRateState: PinterestRateLimitState | null;
  onResumePinterestQueue: () => void;
  currentPinterestArchivePath?: string;
  currentPinterestUrl?: string;
  onResetPinterestArchive: () => void;
  subtitleLanguage: string;
  subtitleOptions: QualityOption[];
  onSubtitleLanguageChange: (language: string) => void;
  whisperModelPath: string;
  onChooseWhisperModel: () => void;
  onClearWhisperModel: () => void;
  defaultSaveFolder: string;
  onChooseDefaultFolder: () => void;
  onClearDefaultFolder: () => void;
  downloadConcurrency: number;
  onDownloadConcurrencyChange: (n: number) => void;
  filenameTemplate: string;
  onFilenameTemplateChange: (template: string) => void;
}) {
  function updatePinterestSetting<K extends keyof PinterestSafeModeSettings>(key: K, value: PinterestSafeModeSettings[K]) {
    onPinterestSettingsChange({ ...pinterestSettings, [key]: value });
  }

  return (
    <section className="workspace single-column">
      <div className="settings-panel">
        <div className="panel-heading">
          <Settings size={22} />
          <div>
            <h2>Settings</h2>
            <p>Tool paths are resolved from your PATH. Cookie options never collect or store passwords.</p>
          </div>
        </div>
        <div className="settings-grid">
          {dependencies.map((dependency) => (
            <div key={dependency.name}>
              <span>{dependency.name}</span>
              <code>{dependency.available ? dependency.version : dependency.optional ? 'Optional fallback missing' : 'Missing'}</code>
            </div>
          ))}
        </div>
        <CookieSourceSelector
          value={cookieSource}
          cookieFilePath={cookieFilePath}
          onChange={onCookieSourceChange}
          onChooseFile={onChooseCookieFile}
          onClearFile={onClearCookieFile}
        />
        <section className="pinterest-settings">
          <div className="panel-heading">
            <Folder size={20} />
            <div>
              <h2>Default download folder</h2>
              <p>All automatic and manual downloads use this folder unless a temporary Save override is selected.</p>
            </div>
          </div>
          <label className="field-label">
            Folder
            <input value={defaultSaveFolder || 'No default folder selected'} readOnly />
          </label>
          <div className="action-row">
            <button className="secondary-button" onClick={onChooseDefaultFolder}>
              Choose default folder
            </button>
            <button className="secondary-button" onClick={onClearDefaultFolder} disabled={!defaultSaveFolder}>
              Clear
            </button>
          </div>
        </section>
        <section className="pinterest-settings">
          <div className="panel-heading">
            <Download size={20} />
            <div>
              <h2>Downloads</h2>
              <p>Control how many downloads run at once and how downloaded files are named.</p>
            </div>
          </div>
          <label className="field-label">
            Parallel downloads
            <select value={downloadConcurrency} onChange={(event) => onDownloadConcurrencyChange(Number(event.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
            <span className="hint">How many downloads run at the same time. Pinterest downloads always run one at a time.</span>
          </label>
          <label className="field-label">
            Filename template
            <input
              type="text"
              value={filenameTemplate}
              placeholder="{title}"
              onChange={(event) => onFilenameTemplateChange(event.target.value)}
            />
            <span className="hint">
              Supported placeholders: {'{title}'} {'{uploader}'} {'{date}'} {'{id}'}. Leave blank for the default filename.
            </span>
          </label>
        </section>
        <section className="pinterest-settings">
          <div className="panel-heading">
            <FileText size={20} />
            <div>
              <h2>Transcripts</h2>
              <p>Set one whisper.cpp model for transcript fallbacks across YouTube, Instagram, TikTok, Facebook, and General URL videos.</p>
            </div>
          </div>
          <label className="field-label">
            Caption language
            <select value={subtitleLanguage} onChange={(event) => onSubtitleLanguageChange(event.target.value)}>
              {subtitleOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="hint">Source captions are used first when available. The selected language is used for caption and transcript downloads.</span>
          </label>
          <label className="field-label">
            Whisper.cpp model
            <input value={whisperModelPath || 'No model selected'} readOnly />
            <span className="hint">Choose a `.bin` ggml model. Source captions are still preferred when a platform provides them.</span>
          </label>
          <div className="action-row">
            <button className="secondary-button" onClick={onChooseWhisperModel}>
              Choose model
            </button>
            <button className="secondary-button" onClick={onClearWhisperModel} disabled={!whisperModelPath}>
              Clear model
            </button>
          </div>
        </section>
        <section className="pinterest-settings">
          <div className="panel-heading">
            <Images size={20} />
            <div>
              <h2>Pinterest</h2>
              <p>The default profile mirrors the terminal command that works reliably. Concurrent Pinterest downloads are forced to 1.</p>
            </div>
          </div>
          <label>
            <input
              type="checkbox"
              checked={pinterestSettings.useWorkingTerminalProfile ?? true}
              onChange={(event) => updatePinterestSetting('useWorkingTerminalProfile', event.target.checked)}
            />
            Use working terminal profile
          </label>
          <label className="field-label">
            Python executable
            <input
              value={pinterestSettings.pythonExecutablePath ?? ''}
              placeholder="Auto-detect"
              onChange={(event) => updatePinterestSetting('pythonExecutablePath', event.target.value)}
            />
          </label>
          <label className="field-label">
            Pinterest cookies
            <input value="Brave Keychain authorization on download" readOnly />
            <span className="hint">The app asks macOS for Brave Safe Storage access, then gives gallery-dl the resulting Pinterest cookies without a cookies.txt picker.</span>
          </label>
          <label>
            <input type="checkbox" checked={pinterestSettings.safeMode} onChange={(event) => updatePinterestSetting('safeMode', event.target.checked)} />
            Safe Mode
          </label>
          <div className="settings-grid">
            <label>
              Delay between downloads
              <input value={pinterestSettings.delayBetweenDownloads} onChange={(event) => updatePinterestSetting('delayBetweenDownloads', event.target.value)} />
            </label>
            <label>
              Delay between requests
              <input value={pinterestSettings.delayBetweenRequests} onChange={(event) => updatePinterestSetting('delayBetweenRequests', event.target.value)} />
            </label>
            <label>
              429 sleep seconds
              <input value={pinterestSettings.sleep429} onChange={(event) => updatePinterestSetting('sleep429', event.target.value)} />
            </label>
            <label>
              Max retries
              <input
                type="number"
                min={0}
                value={pinterestSettings.retries}
                onChange={(event) => updatePinterestSetting('retries', Number(event.target.value))}
              />
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={pinterestSettings.debugShowCommandArgs ?? false}
              onChange={(event) => updatePinterestSetting('debugShowCommandArgs', event.target.checked)}
            />
            Debug: show exact command args
          </label>
          <label className="field-label">
            Hidden archive location
            <input value={currentPinterestArchivePath || 'Analyze a Pinterest board to see its archive path.'} readOnly />
          </label>
          <div className="action-row">
            <button className="secondary-button" onClick={onResetPinterestArchive} disabled={!currentPinterestUrl}>
              Reset archive for this board
            </button>
            <button
              className="secondary-button"
              onClick={() => currentPinterestArchivePath && window.clipForge.openPath(parentDirectory(currentPinterestArchivePath))}
              disabled={!currentPinterestArchivePath}
            >
              Open archive folder
            </button>
          </div>
          {pinterestRateState?.paused && (
            <div className="error-panel">
              <AlertCircle size={18} />
              <span>
                Pinterest queue paused after rate limiting. Pending jobs: {pinterestRateState.pendingPinterestJobs}.{' '}
                {pinterestRateState.pausedUntil ? `Suggested wait until ${new Date(pinterestRateState.pausedUntil).toLocaleTimeString()}.` : ''}
              </span>
            </div>
          )}
          <button className="secondary-button" onClick={onResumePinterestQueue} disabled={!pinterestRateState?.paused}>
            Resume Pinterest queue
          </button>
        </section>
        <div className="update-actions">
          <button className="secondary-button" onClick={() => onUpdateTool('yt-dlp')}>Update yt-dlp</button>
          <button className="secondary-button" onClick={() => onUpdateTool('gallery-dl')}>Update gallery-dl</button>
          <button className="secondary-button" onClick={() => onUpdateTool('instaloader')}>Update instaloader</button>
        </div>
      </div>
    </section>
  );
}

function getQualityOptions(media: MediaInfo | null): QualityOption[] {
  const options = new Map<string, QualityOption>();
  options.set('best', { id: 'best', label: 'Best Available' });

  for (const format of media?.formats ?? []) {
    if (!format.height || format.vcodec === 'none') {
      continue;
    }
    const id = `height:${format.height}`;
    options.set(id, {
      id,
      height: format.height,
      label: `${format.height}p${format.fps ? ` ${format.fps}fps` : ''}`
    });
  }

  return Array.from(options.values()).sort((a, b) => (b.height ?? Number.POSITIVE_INFINITY) - (a.height ?? Number.POSITIVE_INFINITY));
}

function getSubtitleOptions(media: MediaInfo | null): QualityOption[] {
  const languages = new Set<string>();
  languages.add('en.*');
  Object.keys(media?.subtitles ?? {}).forEach((language) => languages.add(language));
  Object.keys(media?.automatic_captions ?? {}).forEach((language) => languages.add(language));

  const sorted = Array.from(languages).sort((a, b) => a.localeCompare(b));
  const english = ['en.*', ...sorted.filter((language) => language !== 'en.*' && language.startsWith('en'))];
  const remaining = sorted.filter((language) => language !== 'en.*' && !language.startsWith('en'));

  return [...english, ...remaining].map((language) => ({
    id: language,
    label: language === 'en.*' ? 'English captions' : language.startsWith('en') ? `${language} English` : language
  }));
}

function preferredSubtitleLanguage(media: MediaInfo | null): string {
  const options = getSubtitleOptions(media);
  return options.find((option) => option.id === 'en.*')?.id ?? options.find((option) => option.id.startsWith('en'))?.id ?? options[0]?.id ?? 'en.*';
}

function hasSourceCaptions(media: MediaInfo | null): boolean {
  return Object.keys(media?.subtitles ?? {}).length > 0 || Object.keys(media?.automatic_captions ?? {}).length > 0;
}

function errorMessage(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message.replace(/^Error invoking remote method '[^']+':\s*/, '');
  }
  return 'Something went wrong.';
}

function extractUrls(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((part) => part.trim()).filter(looksLikeUrl))];
}

function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasTool(name: DependencyStatus['name'], dependencies: DependencyStatus[]): boolean {
  return dependencies.some((dependency) => dependency.name === name && dependency.available);
}

function hasVideoFormats(media: MediaInfo): boolean {
  if (media.isPlaylist) {
    return true;
  }
  return media.formats.some((format) => format.vcodec && format.vcodec !== 'none');
}

// When a tweet has no native video, yt-dlp silently falls back to its generic
// extractor, which can resolve an unrelated video embedded on the page (for
// example a linked YouTube clip). Only treat a result as a real X video when it
// came from X's own extractor; otherwise the tweet is image-only and should use
// the gallery (cookie-aware) photo grid.
function isNativeTwitterVideo(media: MediaInfo): boolean {
  return (media.extractor ?? '').toLowerCase().includes('twitter');
}

function buildVideoDownloadRequest(
  media: MediaInfo,
  fallbackUrl: string,
  options: {
    outputTypes: OutputType[];
    outputPath: string;
    subtitleLanguage: string;
    cookieSource: CookieSource;
    cookieFilePath: string;
    whisperModelPath: string;
    qualityId?: string;
    forceOverwrite?: boolean;
    clipRange?: ClipRange;
    clipCrop?: ClipCrop;
    burnCaptions?: boolean;
    captionStyle?: CaptionStyle;
    outputTemplate?: string;
  }
): DownloadRequest {
  return {
    url: media.webpage_url || fallbackUrl,
    outputTypes: options.outputTypes,
    outputPath: options.outputPath,
    mediaTitle: media.title,
    mediaThumbnail: media.thumbnail,
    qualityId: options.qualityId ?? 'best',
    subtitleLanguage: options.subtitleLanguage,
    cookieSource: options.cookieSource,
    cookieFilePath: options.cookieFilePath || undefined,
    ytDlpStrategy: media.ytDlpStrategy,
    captionsAvailable: Boolean(media.isPlaylist) || hasSourceCaptions(media),
    isPlaylist: media.isPlaylist,
    extractor: media.extractor,
    whisperModelPath: options.whisperModelPath || undefined,
    forceOverwrite: options.forceOverwrite,
    clipRange: options.clipRange,
    clipCrop: options.clipCrop,
    burnCaptions: options.burnCaptions,
    captionStyle: options.captionStyle,
    outputTemplate: options.outputTemplate
  };
}

function extensionClipRange(request: ExtensionDownloadRequest): ClipRange | undefined {
  if (typeof request.clipStart === 'number' && typeof request.clipEnd === 'number' && request.clipEnd > request.clipStart) {
    return { start: request.clipStart, end: request.clipEnd };
  }
  return undefined;
}

function formatClipLabel(range: ClipRange): string {
  return `clip ${formatPlaybackTime(range.start)}–${formatPlaybackTime(range.end)}`;
}

function formatPlaybackTime(value: number): string {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function extensionFormatLabel(format: NonNullable<ExtensionDownloadRequest['format']>): string {
  return format === 'markdown' ? 'Markdown transcript' : format.toUpperCase();
}

function extensionRequestFormats(request: ExtensionDownloadRequest): OutputType[] {
  if (request.formats?.length) {
    return [...request.formats];
  }
  return request.format ? [request.format] : [];
}

function extensionRequestLabel(request: ExtensionDownloadRequest): string {
  const base = request.presetName
    ? `preset “${request.presetName}”`
    : request.format
      ? extensionFormatLabel(request.format)
      : 'selected formats';
  const clip = extensionClipRange(request);
  return clip ? `${base} (${formatClipLabel(clip)})` : base;
}

function sameOutputTypes(current: OutputType[], expected: OutputType[]): boolean {
  return current.length === expected.length && current.every((format) => expected.includes(format));
}

function sectionTitle(section: Section): string {
  if (section === 'downloads') {
    return 'Downloads';
  }
  if (section === 'settings') {
    return 'Settings';
  }
  return platformSections.find((candidate) => candidate.id === section)?.label ?? 'General URL';
}

function parentDirectory(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

export default App;
