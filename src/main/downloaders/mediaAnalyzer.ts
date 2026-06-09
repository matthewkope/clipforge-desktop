import type { CookieSource, MediaAnalyzerResult, PinterestSafeModeSettings } from '../../shared/media.js';
import { detectMediaIntent, detectPlatform } from '../urlRouter.js';
import { analyzeWithGalleryDl } from './galleryDlAdapter.js';
import { analyzeWithPinterest } from './pinterestAdapter.js';
import { analyzeWithYtDlp } from './ytdlpAdapter.js';

export async function analyzeMedia(
  url: string,
  cookieSource: CookieSource = 'none',
  cookieFilePath?: string,
  pinterestSettings?: PinterestSafeModeSettings
): Promise<MediaAnalyzerResult> {
  const platform = detectPlatform(url);
  const intent = detectMediaIntent(url);

  if (platform === 'youtube') {
    return analyzeWithYtDlp(url, cookieSource, cookieFilePath);
  }

  if (platform === 'tiktok') {
    return analyzeWithYtDlp(url, cookieSource, cookieFilePath);
  }

  if (platform === 'instagram') {
    try {
      const ytdlp = await analyzeWithYtDlp(url, cookieSource, cookieFilePath);
      if (ytdlp.mediaType === 'video' || ytdlp.mediaType === 'playlist') {
        return ytdlp;
      }
      throw new Error('The Instagram section currently supports videos and reels only.');
    } catch (ytdlpError) {
      if (intent === 'instagram-video') {
        throw ytdlpError;
      }
      return instagramInstaloaderFallback(url, ytdlpError);
    }
  }

  if (platform === 'facebook') {
    if (intent === 'facebook-video') {
      try {
        return await analyzeWithYtDlp(url, cookieSource, cookieFilePath);
      } catch {
        return analyzeWithGalleryDl(url, cookieSource, cookieFilePath);
      }
    }

    try {
      return await analyzeWithGalleryDl(url, cookieSource, cookieFilePath);
    } catch {
      return analyzeWithYtDlp(url, cookieSource, cookieFilePath);
    }
  }

  if (platform === 'pinterest') {
    try {
      return await analyzeWithPinterest(url, cookieSource, cookieFilePath, pinterestSettings);
    } catch (galleryError) {
      if (/video/i.test(url)) {
        return analyzeWithYtDlp(url, cookieSource, cookieFilePath);
      }
      throw galleryError;
    }
  }

  try {
    return await analyzeWithYtDlp(url, cookieSource, cookieFilePath);
  } catch {
    return analyzeWithGalleryDl(url, cookieSource, cookieFilePath);
  }
}

function instagramInstaloaderFallback(url: string, error: unknown): MediaAnalyzerResult {
  return {
    platform: 'instagram',
    intent: detectMediaIntent(url),
    sourceUrl: url,
    title: instagramTitle(url),
    mediaType: 'unknown',
    items: [
      {
        id: '1',
        index: 1,
        type: 'unknown',
        selected: true
      }
    ],
    availableOutputs: [
      {
        id: 'instaloader-post',
        label: 'Try instaloader fallback',
        type: 'unknown',
        tool: 'instaloader',
        commandArgs: ['instaloader', '--dirname-pattern', 'OUTPUT_PATH', url]
      }
    ],
    requiresCookies: true,
    rawTool: 'instaloader',
    rawJson: { galleryDlError: error instanceof Error ? error.message : String(error) }
  };
}

function instagramTitle(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.at(-1) || 'Instagram media';
  } catch {
    return 'Instagram media';
  }
}
