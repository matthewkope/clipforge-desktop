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

  if (platform === 'x') {
    // Video tweets analyze with yt-dlp; image/carousel tweets have no video,
    // so fall back to gallery-dl for a selectable image grid.
    try {
      const result = await analyzeWithYtDlp(url, cookieSource, cookieFilePath);
      // When a tweet has no native video, yt-dlp silently falls back to its
      // generic extractor, which can resolve an *unrelated* video embedded on
      // the page (e.g. a linked YouTube trailer). That is not the tweet's media,
      // so treat a foreign extractor as "no video here" and use the image grid.
      if (isForeignExtractorResult(result, 'x')) {
        return await analyzeWithGalleryDl(url, cookieSource, cookieFilePath);
      }
      return result;
    } catch (ytdlpError) {
      try {
        return await analyzeWithGalleryDl(url, cookieSource, cookieFilePath);
      } catch (galleryError) {
        throw looksLikeNoVideoError(ytdlpError) ? galleryError : ytdlpError;
      }
    }
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

// yt-dlp's "no video in this tweet" means the tweet is image-only; in that
// case the gallery-dl error is the relevant one to surface.
function looksLikeNoVideoError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no video|no media|unsupported url|not contain/i.test(message);
}

// The yt-dlp extractor name expected for each platform's own media. If yt-dlp
// returns a result from any other extractor (most often "generic", or a site it
// followed a link to), it did not extract the post's own media.
const NATIVE_EXTRACTOR: Partial<Record<string, string>> = {
  x: 'twitter',
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  youtube: 'youtube'
};

function isForeignExtractorResult(result: MediaAnalyzerResult, platform: string): boolean {
  const expected = NATIVE_EXTRACTOR[platform];
  if (!expected) {
    return false;
  }
  const rawJson = result.rawJson as { extractor?: unknown } | null | undefined;
  const extractor = typeof rawJson?.extractor === 'string' ? rawJson.extractor.toLowerCase() : '';
  if (!extractor) {
    return false;
  }
  // yt-dlp uses keys like "twitter", "twitter:broadcast", "TwitterIE" — match the family.
  return !extractor.includes(expected);
}

