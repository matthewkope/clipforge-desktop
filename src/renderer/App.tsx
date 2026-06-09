import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  AlertCircle,
  Compass,
  Download,
  Facebook,
  FileAudio,
  FileText,
  Film,
  Images,
  Instagram,
  Pin,
  RotateCcw,
  Settings,
  Youtube
} from 'lucide-react';
import type {
  CookieSource,
  DependencyStatus,
  DownloadProgress,
  DownloadResult,
  MediaAnalyzerResult,
  MediaInfo,
  OutputType,
  PinterestRateLimitState,
  PinterestSafeModeSettings,
  Platform,
  QualityOption
} from '../shared/media';
import { CookieSourceSelector } from './components/CookieSourceSelector';
import { FormatSelector } from './components/FormatSelector';
import { GalleryPreviewCard } from './components/GalleryPreviewCard';
import { MediaItemGrid } from './components/MediaItemGrid';
import { PreviewCard } from './components/PreviewCard';
import { ProgressPanel } from './components/ProgressPanel';
import { QualitySelector } from './components/QualitySelector';
import { SaveFolderPicker } from './components/SaveFolderPicker';
import { UrlInput } from './components/UrlInput';

type Section = Platform | 'downloads' | 'settings';

type NavIcon = ComponentType<{ size?: number; className?: string }>;

const platformSections: Array<{ id: Platform; label: string; icon: NavIcon }> = [
  { id: 'youtube', label: 'YouTube', icon: Youtube },
  { id: 'instagram', label: 'Instagram', icon: Instagram },
  { id: 'tiktok', label: 'TikTok', icon: TikTokIcon },
  { id: 'facebook', label: 'Facebook', icon: Facebook },
  { id: 'pinterest', label: 'Pinterest', icon: Pin },
  { id: 'unknown', label: 'General URL', icon: Compass }
];

const outputIcons: Record<OutputType, typeof Film> = {
  mp4: Film,
  webm: Film,
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

function App() {
  const [activeSection, setActiveSection] = useState<Section>('youtube');
  const [url, setUrl] = useState('');
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [galleryMedia, setGalleryMedia] = useState<MediaAnalyzerResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [dependencies, setDependencies] = useState<DependencyStatus[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [outputTypes, setOutputTypes] = useState<OutputType[]>(['mp4']);
  const [qualityId, setQualityId] = useState('best');
  const [subtitleLanguage, setSubtitleLanguage] = useState('en.*');
  const [cookieSource, setCookieSource] = useState<CookieSource>('none');
  const [cookieFilePath, setCookieFilePath] = useState('');
  const [pinterestSettings, setPinterestSettings] = useState<PinterestSafeModeSettings>(defaultPinterestSettings);
  const [pinterestRateState, setPinterestRateState] = useState<PinterestRateLimitState | null>(null);
  const [whisperModelPath, setWhisperModelPath] = useState(() => window.localStorage.getItem(whisperModelStorageKey) ?? '');
  const [saveFolder, setSaveFolder] = useState('');
  const [status, setStatus] = useState('Paste a URL to begin.');
  const [error, setError] = useState('');
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ status: 'idle' });
  const [result, setResult] = useState<DownloadResult | null>(null);
  const lastAutoAnalyzedUrl = useRef('');
  const analyzeRunId = useRef(0);

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

    return () => {
      unsubscribeProgress();
      unsubscribeComplete();
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

  const blockingMissingDependencies = dependencies.filter((dependency) => !dependency.available && !dependency.optional);
  const qualityOptions = useMemo(() => getQualityOptions(media), [media]);
  const subtitleOptions = useMemo(() => getSubtitleOptions(media), [media]);
  const sourceCaptionsAvailable = hasSourceCaptions(media);
  const captionsAvailable = Boolean(media?.isPlaylist) || sourceCaptionsAvailable;
  const isVideoDownloadSection = activeSection === 'youtube' || activeSection === 'instagram' || activeSection === 'tiktok' || (activeSection === 'facebook' && media !== null);
  const hasGallery = Boolean(galleryMedia && activeSection !== 'youtube' && activeSection !== 'instagram' && activeSection !== 'tiktok');
  const canDownloadVideo = Boolean(media && saveFolder && outputTypes.length > 0 && !downloadId && hasTool('yt-dlp', dependencies));
  const canDownloadGallery = Boolean(galleryMedia && saveFolder && !downloadId && hasTool(galleryMedia.rawTool, dependencies));

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
    return cookieSource;
  }

  function effectiveCookieFilePath(platform: Platform): string | undefined {
    if (platform === 'pinterest') {
      return undefined;
    }
    return cookieFilePath || undefined;
  }

  async function analyze(targetUrl = url.trim()) {
    const currentRunId = analyzeRunId.current + 1;
    analyzeRunId.current = currentRunId;
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

      if (detected.platform === 'youtube' || detected.platform === 'instagram' || detected.platform === 'tiktok') {
        const info = await window.clipForge.analyzeUrl(targetUrl, cookieSource, cookieFilePath || undefined);
        if (detected.platform === 'instagram' && !hasVideoFormats(info)) {
          throw new Error('The Instagram section is currently focused on videos and reels. Photo posts and carousels are hidden for now.');
        }
        if (detected.platform === 'tiktok' && !hasVideoFormats(info)) {
          throw new Error('The TikTok section is currently focused on videos.');
        }
        if (currentRunId !== analyzeRunId.current) {
          return;
        }
        setMedia(info);
        setQualityId('best');
        setSubtitleLanguage(preferredSubtitleLanguage(info));
      } else if (detected.platform === 'facebook' && detected.intent === 'facebook-video') {
        // Facebook video URLs: try yt-dlp for full format/quality controls, fall back to gallery-dl
        try {
          const info = await window.clipForge.analyzeUrl(targetUrl, cookieSource, cookieFilePath || undefined);
          if (currentRunId !== analyzeRunId.current) {
            return;
          }
          setMedia(info);
          setQualityId('best');
          setSubtitleLanguage(preferredSubtitleLanguage(info));
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
      setSaveFolder(folder);
    }
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
      const started = await window.clipForge.startDownload({
        url: media.webpage_url || url.trim(),
        outputTypes,
        outputPath: saveFolder,
        mediaTitle: media.title,
        qualityId,
        subtitleLanguage,
        cookieSource,
        cookieFilePath: cookieFilePath || undefined,
        ytDlpStrategy: media.ytDlpStrategy,
        captionsAvailable,
        isPlaylist: media.isPlaylist,
        extractor: media.extractor,
        whisperModelPath: whisperModelPath || undefined
      });
      setDownloadId(started.downloadId);
    } catch (caught) {
      setError(errorMessage(caught));
      setProgress({ status: 'error', message: errorMessage(caught) });
      setStatus('Download could not start.');
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
  const needsQuality = isVideoDownloadSection && outputTypes.some((type) => type === 'mp4' || type === 'webm');
  const needsCaptions = isVideoDownloadSection && outputTypes.some((type) => type === 'subtitles' || type === 'markdown' || type === 'timed-transcript');
  const needsWhisperFallback =
    isVideoDownloadSection && outputTypes.some((type) => type === 'markdown' || type === 'timed-transcript') && !captionsAvailable && !media?.isPlaylist;

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">ClipForge</p>
          <h1>Social Media Downloader</h1>
        </div>
        <div className="topbar-actions">
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
          <button className="icon-button" onClick={refreshDependencies} title="Recheck dependencies" aria-label="Recheck dependencies">
            <RotateCcw size={20} />
          </button>
        </div>
      </section>

      <UrlInput value={url} onChange={setUrl} onAnalyze={analyze} isAnalyzing={isAnalyzing} />

      <nav className="platform-nav" aria-label="Media platforms">
        {platformSections.map((section) => {
          const SectionIcon = section.icon;
          return (
            <button
              key={section.id}
              className={activeSection === section.id ? 'selected' : ''}
              onClick={() => setActiveSection(section.id)}
              aria-label={section.label}
              title={section.label}
            >
              <SectionIcon size={27} />
              <span className="visually-hidden">{section.label}</span>
            </button>
          );
        })}
      </nav>

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
          whisperModelPath={whisperModelPath}
          onChooseWhisperModel={chooseWhisperModel}
          onClearWhisperModel={() => setWhisperModelPath('')}
        />
      ) : activeSection === 'downloads' ? (
        <section className="workspace single-column">
          <ProgressPanel progress={progress} result={result} saveFolder={saveFolder || undefined} onOpenFolder={(path) => window.clipForge.openPath(path)} />
        </section>
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
              <SelectedIcon size={22} />
              <div>
                <h2>{sectionTitle(activeSection)} Output</h2>
                <p>{status}</p>
              </div>
            </div>

            {isVideoDownloadSection ? (
              <>
                <FormatSelector value={outputTypes} onChange={setOutputTypes} />
                {needsQuality && <QualitySelector value={qualityId} options={qualityOptions} onChange={setQualityId} />}

                {needsCaptions && (
                  <label className="field-label">
                    Caption language
                    <select value={subtitleLanguage} onChange={(event) => setSubtitleLanguage(event.target.value)}>
                      {subtitleOptions.length === 0 && <option value="en.*">English captions if available</option>}
                      {subtitleOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="hint">Source captions are used first when available. whisper.cpp is used as a fallback when captions are unavailable.</span>
                  </label>
                )}

                {needsWhisperFallback && (
                  <section className="save-picker">
                    <label>Whisper.cpp model</label>
                    <div>
                      <input value={whisperModelPath || 'Choose a ggml model file in Settings'} readOnly />
                      <button onClick={chooseWhisperModel}>Choose</button>
                    </div>
                    <span className="hint">This shared model is used for YouTube, Instagram, TikTok, Facebook, and General URL transcript fallbacks.</span>
                  </section>
                )}
              </>
            ) : (
              <section className="gallery-actions-panel">
                <span className="media-type-badge">{galleryMedia?.mediaType ?? sectionTitle(activeSection)}</span>
                <p className="hint">
                  {activeSection === 'facebook'
                    ? 'Facebook photos and albums download via gallery-dl. Paste a video URL to get MP4/MP3/WAV format controls.'
                    : activeSection === 'pinterest'
                      ? 'Pinterest pins, boards, and sections use gallery-dl.'
                      : 'General URLs try yt-dlp first, then gallery-dl.'}
                </p>
              </section>
            )}

            <SaveFolderPicker value={saveFolder} onChoose={chooseFolder} />

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
  whisperModelPath,
  onChooseWhisperModel,
  onClearWhisperModel
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
  whisperModelPath: string;
  onChooseWhisperModel: () => void;
  onClearWhisperModel: () => void;
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
            <FileText size={20} />
            <div>
              <h2>Transcripts</h2>
              <p>Set one whisper.cpp model for transcript fallbacks across YouTube, Instagram, TikTok, Facebook, and General URL videos.</p>
            </div>
          </div>
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
