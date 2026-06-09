import type { CookieSource, DownloadOption, MediaAnalyzerResult, MediaInfo, MediaItem, NormalizedMediaType, Platform } from '../../shared/media.js';
import { detectMediaIntent, detectPlatform } from '../urlRouter.js';
import { analyzeUrl } from '../ytdlp.js';

export async function analyzeWithYtDlp(url: string, cookieSource: CookieSource = 'none', cookieFilePath?: string): Promise<MediaAnalyzerResult> {
  const info = await analyzeUrl(url, cookieSource, cookieFilePath);
  const platform = detectPlatform(url);
  const mediaType = mediaTypeFromInfo(info);
  const items = itemsFromInfo(info);

  return {
    platform,
    intent: detectMediaIntent(url),
    sourceUrl: info.webpage_url || url,
    title: info.title || 'Media',
    creator: info.uploader,
    thumbnail: info.thumbnail,
    duration: info.duration,
    mediaType,
    items,
    availableOutputs: ytdlpOptions(platform, mediaType, url),
    requiresCookies: false,
    rawTool: 'yt-dlp',
    rawJson: info
  };
}

function mediaTypeFromInfo(info: MediaInfo): NormalizedMediaType {
  if (info.isPlaylist) {
    return 'playlist';
  }
  if (info.formats.some((format) => format.vcodec && format.vcodec !== 'none')) {
    return 'video';
  }
  if (info.formats.some((format) => format.acodec && format.acodec !== 'none')) {
    return 'audio';
  }
  return 'unknown';
}

function itemsFromInfo(info: MediaInfo): MediaItem[] {
  if (info.isPlaylist && info.entries?.length) {
    return info.entries.map((entry, index) => ({
      id: entry.id || String(index + 1),
      index: index + 1,
      type: 'video',
      url: entry.webpage_url || entry.url,
      thumbnail: entry.thumbnail,
      filename: entry.title,
      duration: entry.duration,
      selected: true
    }));
  }

  return [
    {
      id: info.id || '1',
      index: 1,
      type: mediaTypeFromInfo(info) === 'audio' ? 'audio' : mediaTypeFromInfo(info) === 'video' ? 'video' : 'unknown',
      url: info.webpage_url,
      thumbnail: info.thumbnail,
      filename: info.title,
      duration: info.duration,
      selected: true
    }
  ];
}

function ytdlpOptions(platform: Platform, mediaType: NormalizedMediaType, url: string): DownloadOption[] {
  const options: DownloadOption[] = [];
  if (mediaType === 'video' || mediaType === 'playlist' || platform === 'youtube' || platform === 'instagram' || platform === 'tiktok' || platform === 'facebook') {
    options.push({
      id: 'mp4',
      label: 'MP4 Video',
      type: 'mp4',
      tool: 'yt-dlp',
      commandArgs: ['yt-dlp', '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '-o', 'OUTPUT_PATH/%(title)s.%(ext)s', url]
    });
  }
  options.push({
    id: 'source',
    label: 'Best available media',
    type: mediaType,
    tool: 'yt-dlp',
    commandArgs: ['yt-dlp', '-o', 'OUTPUT_PATH/%(title)s.%(ext)s', url]
  });
  return options;
}
