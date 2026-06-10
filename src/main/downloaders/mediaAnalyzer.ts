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

  if (platform === 'tiktok' || platform === 'x') {
    return analyzeWithYtDlp(url, cookieSource, cookieFilePath);
  }

  if (platform === 'instagram') {
    if (intent === 'instagram-video') {
      return analyzeWithYtDlp(url, cookieSource, cookieFilePath);
    }
    // /p/ posts can be a photo, a carousel, or a video. gallery-dl handles all
    // three; fall back to yt-dlp for video posts it cannot read.
    try {
      return await analyzeWithGalleryDl(url, cookieSource, cookieFilePath);
    } catch (galleryError) {
      try {
        // yt-dlp reports photo carousels as empty "playlists"; only a real
        // video result is a usable fallback here.
        const ytdlp = await analyzeWithYtDlp(url, cookieSource, cookieFilePath);
        if (ytdlp.mediaType === 'video') {
          return ytdlp;
        }
      } catch {
        // Surface the gallery-dl error below; it has the friendlier message.
      }
      throw galleryError;
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
    } catch (galleryError) {
      try {
        // Like Instagram, only a real video result is a usable yt-dlp
        // fallback for photo/album links.
        const ytdlp = await analyzeWithYtDlp(url, cookieSource, cookieFilePath);
        if (ytdlp.mediaType === 'video') {
          return ytdlp;
        }
      } catch {
        // Surface the gallery-dl error below; it has the friendlier message.
      }
      throw galleryError;
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

