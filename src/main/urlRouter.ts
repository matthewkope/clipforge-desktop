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
    if (
      hostname === 'x.com' ||
      hostname.endsWith('.x.com') ||
      hostname === 'twitter.com' ||
      hostname.endsWith('.twitter.com') ||
      hostname === 't.co' // Twitter/X link shortener (mobile share links)
    ) {
      return 'x';
    }
    if (
      hostname === 'reddit.com' ||
      hostname.endsWith('.reddit.com') ||
      hostname === 'redd.it' ||
      hostname.endsWith('.redd.it') // v.redd.it/i.redd.it direct media hosts
    ) {
      return 'reddit';
    }
    if (hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv')) {
      return 'twitch';
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
    case 'x':
      return 'x-video';
    case 'reddit': {
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, '');
      // Best effort: comment threads and direct v.redd.it links usually carry
      // the post's video; everything else is treated as a generic post.
      if (hostname === 'v.redd.it' || path.includes('/comments/') || path.includes('/video/')) {
        return 'reddit-video';
      }
      return 'reddit-post';
    }
    case 'twitch': {
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, '');
      if (hostname === 'clips.twitch.tv' || path.includes('/clip/')) {
        return 'twitch-clip';
      }
      if (path.includes('/videos/')) {
        return 'twitch-video';
      }
      // Channel/live URLs still point at video content.
      return 'twitch-video';
    }
    case 'unknown':
      return 'unknown';
  }
}
