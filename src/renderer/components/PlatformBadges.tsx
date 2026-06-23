import { useEffect, useRef, useState, type ComponentType } from 'react';

type BadgeIcon = ComponentType<{ size?: number; className?: string }>;

export interface PlatformBadge {
  id: string;
  label: string;
  icon: BadgeIcon;
}

interface PlatformCapability {
  summary: string;
  rows: Array<[string, string]>;
}

const videoFormats = 'MP4, WEBM, MP3, WAV, M4A, subtitles, and timed/markdown transcripts';

// What ClipForge can do per platform — shown when a brand icon is clicked.
// Kept in sync with the routing in App.tsx analyze() and CLAUDE.md.
const capabilities: Record<string, PlatformCapability> = {
  youtube: {
    summary: 'Videos, Shorts, and playlists.',
    rows: [
      ['Download', 'Single videos, Shorts, and full playlists'],
      ['Formats', videoFormats],
      ['Quality', 'Pick a resolution up to the source'],
      [
        'Clip picker',
        'Browser extension: choose a range on the timeline, 9:16 crop, burn-in captions, transcript search, GIF export, and one-click Reels/Shorts/X presets'
      ]
    ]
  },
  instagram: {
    summary: 'Reels, video posts, photos, and carousels.',
    rows: [
      ['Download', 'Reels and video posts; photo posts and carousels'],
      ['Video formats', videoFormats],
      ['Photos', 'Carousels open as a selectable gallery grid (gallery-dl)'],
      ['Sign-in', 'Uses Brave cookies for posts that require a login']
    ]
  },
  tiktok: {
    summary: 'Videos.',
    rows: [
      ['Download', 'TikTok videos'],
      ['Formats', videoFormats],
      ['Quality', 'Resolution selection with an opening-frame preview']
    ]
  },
  facebook: {
    summary: 'Videos, photos, and albums.',
    rows: [
      ['Download', 'Videos; photos and albums'],
      ['Video formats', videoFormats],
      ['Photos', 'Albums open as a selectable gallery grid (gallery-dl)']
    ]
  },
  pinterest: {
    summary: 'Pins, boards, and sections.',
    rows: [
      ['Download', 'Pins, boards, and sections (images)'],
      ['Method', 'gallery-dl with Brave cookies via the macOS Keychain'],
      ['Safe mode', 'Rate-limit-aware queue, per-board archive, retry failed, and reset archive']
    ]
  },
  x: {
    summary: 'Video tweets, images, and carousels.',
    rows: [
      ['Download', 'Video tweets; image and carousel tweets'],
      ['Video formats', videoFormats],
      ['Photos', 'Image tweets open as a selectable gallery grid']
    ]
  },
  reddit: {
    summary: 'Videos and image posts.',
    rows: [
      ['Download', 'v.redd.it videos; image and gallery posts'],
      ['Video formats', `${videoFormats} (audio and video are merged)`],
      ['Photos', 'Gallery posts open as a selectable grid']
    ]
  },
  twitch: {
    summary: 'VODs and clips.',
    rows: [
      ['Download', 'Twitch VODs and clips'],
      ['Formats', videoFormats],
      ['Clip picker', 'Scissor button in the player control bar to pick a range']
    ]
  },
  soundcloud: {
    summary: 'Tracks, sets, and playlists.',
    rows: [
      ['Download', 'Single tracks and full sets/playlists'],
      ['Formats', 'MP3, WAV, and M4A audio'],
      ['Sign-in', 'Uses browser cookies for tracks that require a login']
    ]
  }
};

// The brand-icon strip beside the ClipForge wordmark. Each icon is a button
// that opens a popover describing what ClipForge supports for that platform.
export function PlatformBadges({ platforms }: { platforms: PlatformBadge[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenId(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenId(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openId]);

  const openPlatform = platforms.find((platform) => platform.id === openId) ?? null;
  const info = openPlatform ? capabilities[openPlatform.id] : null;
  const HeaderIcon = openPlatform?.icon;

  return (
    <div className="supported-platforms" aria-label="Supported social media platforms" ref={containerRef}>
      {platforms.map((platform) => {
        const Icon = platform.icon;
        const isOpen = openId === platform.id;
        return (
          <button
            key={platform.id}
            type="button"
            className={`platform-badge brand-${platform.id}${isOpen ? ' is-open' : ''}`}
            title={`${platform.label} — what ClipForge supports`}
            aria-label={`${platform.label} options`}
            aria-expanded={isOpen}
            onClick={() => setOpenId(isOpen ? null : platform.id)}
          >
            <Icon size={12} />
          </button>
        );
      })}

      {openPlatform && info && HeaderIcon && (
        <div className="platform-popover" role="dialog" aria-label={`${openPlatform.label} options`}>
          <div className="platform-popover-header">
            <span className={`platform-popover-icon brand-${openPlatform.id}`}>
              <HeaderIcon size={16} />
            </span>
            <div className="platform-popover-title">
              <strong>{openPlatform.label}</strong>
              <p>{info.summary}</p>
            </div>
            <button
              type="button"
              className="platform-popover-close"
              onClick={() => setOpenId(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <dl className="platform-popover-rows">
            {info.rows.map(([label, text]) => (
              <div key={label} className="platform-popover-row">
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
