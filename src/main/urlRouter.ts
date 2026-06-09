import type { MediaIntent, Platform } from '../shared/media.js';

export function detectPlatform(input: string): Platform {
  try {
    const hostname = new URL(input).hostname.toLowerCase().replace(/^www\./u, '');
    if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      return 'youtube';
    }
    if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) {
      return 'instagram';
    }
    if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com') || hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com') {
      return 'tiktok';
    }
    if (hostname === 'facebook.com' || hostname.endsWith('.facebook.com') || hostname === 'fb.watch') {
      return 'facebook';
    }
    if (hostname === 'pinterest.com' || hostname.endsWith('.pinterest.com') || hostname === 'pin.it') {
      return 'pinterest';
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

export function detectMediaIntent(input: string): MediaIntent {
  const platform = detectPlatform(input);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return 'unknown';
  }

  const path = parsed.pathname.toLowerCase();
  switch (platform) {
    case 'youtube':
      if (path.includes('/shorts/')) {
        return 'youtube-shorts';
      }
      if (parsed.searchParams.has('list') && !parsed.searchParams.has('v')) {
        return 'youtube-playlist';
      }
      return 'youtube-video';
    case 'instagram':
      if (path.includes('/reel/') || path.includes('/tv/')) {
        return 'instagram-video';
      }
      if (path.includes('/p/')) {
        return 'instagram-image';
      }
      return 'unknown';
    case 'tiktok':
      return 'tiktok-video';
    case 'facebook':
      if (
        path.includes('/videos/') ||
        path.includes('/watch') ||
        path.includes('/reel/') ||
        path.includes('/reels/') ||
        path.includes('/stories/') ||
        parsed.hostname.toLowerCase().includes('fb.watch')
      ) {
        return 'facebook-video';
      }
      if (path.includes('/photos/') || path.includes('/photo.php')) {
        return 'facebook-image';
      }
      if (path.includes('/media/set') || path.includes('/albums/')) {
        return 'facebook-album';
      }
      return 'unknown';
    case 'pinterest':
      if (path.includes('/pin/')) {
        return 'pinterest-pin';
      }
      if (path.includes('/_saved/') || path.split('/').filter(Boolean).length >= 2) {
        return path.split('/').filter(Boolean).length >= 3 ? 'pinterest-section' : 'pinterest-board';
      }
      return 'unknown';
    case 'unknown':
      return 'unknown';
  }
}
