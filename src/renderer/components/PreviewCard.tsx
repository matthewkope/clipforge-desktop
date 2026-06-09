import { Clock, ListVideo, UserRound } from 'lucide-react';
import type { MediaInfo } from '../../shared/media';

interface PreviewCardProps {
  media: MediaInfo | null;
}

export function PreviewCard({ media }: PreviewCardProps) {
  if (!media) {
    return (
      <section className="preview-empty">
        <div className="thumbnail-placeholder" />
        <div>
          <h2>No media analyzed yet</h2>
          <p>Metadata, formats, and captions will appear here after yt-dlp reads the URL.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="preview-card">
      {media.thumbnail ? <img src={media.thumbnail} alt="" /> : <div className="thumbnail-placeholder" />}
      <div className="preview-body">
        <p className="source">{media.extractor || 'Media source'}</p>
        <h2>{media.title}</h2>
        <div className="meta-grid">
          <span>
            <UserRound size={16} />
            {media.uploader || 'Unknown creator'}
          </span>
          <span>
            {media.isPlaylist ? <ListVideo size={16} /> : <Clock size={16} />}
            {media.isPlaylist ? `${media.playlist_count ?? media.entries?.length ?? 0} videos` : formatDuration(media.duration)}
          </span>
        </div>
        <dl>
          {media.isPlaylist ? (
            <>
              <div>
                <dt>Playlist</dt>
                <dd>{playlistSummary(media)}</dd>
              </div>
              <div>
                <dt>Download behavior</dt>
                <dd>Selected outputs will run for the full playlist.</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Video qualities</dt>
                <dd>{videoQualitySummary(media)}</dd>
              </div>
              <div>
                <dt>Audio formats</dt>
                <dd>{audioSummary(media)}</dd>
              </div>
              <div>
                <dt>Captions</dt>
                <dd>{captionSummary(media)}</dd>
              </div>
            </>
          )}
          {media.ytDlpStrategy && media.ytDlpStrategy !== 'standard' && (
            <div>
              <dt>Access mode</dt>
              <dd>Automatic YouTube compatibility</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}

function formatDuration(duration?: number): string {
  if (!duration) {
    return 'Unknown duration';
  }

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;
  return [hours, minutes, seconds]
    .filter((value, index) => index > 0 || value > 0)
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function videoQualitySummary(media: MediaInfo): string {
  const heights = new Set(media.formats.filter((format) => format.height && format.vcodec !== 'none').map((format) => `${format.height}p`));
  return Array.from(heights).slice(0, 8).join(', ') || 'No video formats found';
}

function audioSummary(media: MediaInfo): string {
  const formats = new Set(media.formats.filter((format) => format.acodec && format.acodec !== 'none').map((format) => format.ext || format.acodec));
  return Array.from(formats).slice(0, 8).join(', ') || 'No audio formats found';
}

function captionSummary(media: MediaInfo): string {
  const manual = Object.keys(media.subtitles ?? {});
  const automatic = Object.keys(media.automatic_captions ?? {});
  if (manual.length === 0 && automatic.length === 0) {
    return 'None reported';
  }
  return `${manual.length} manual, ${automatic.length} automatic`;
}

function playlistSummary(media: MediaInfo): string {
  const entries = media.entries ?? [];
  const names = entries
    .slice(0, 3)
    .map((entry) => entry.title)
    .filter(Boolean);

  if (names.length === 0) {
    return `${media.playlist_count ?? entries.length ?? 0} videos found`;
  }

  return `${names.join(', ')}${entries.length > names.length ? ', ...' : ''}`;
}
