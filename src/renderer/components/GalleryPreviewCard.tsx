import { Images, UserRound } from 'lucide-react';
import type { MediaAnalyzerResult } from '../../shared/media';

interface GalleryPreviewCardProps {
  media: MediaAnalyzerResult | null;
}

export function GalleryPreviewCard({ media }: GalleryPreviewCardProps) {
  if (!media) {
    return (
      <section className="preview-empty">
        <div className="thumbnail-placeholder" />
        <div>
          <h2>No gallery analyzed yet</h2>
          <p>Photos, albums, boards, and carousel items will appear after analysis.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="preview-card">
      {media.thumbnail ? <img src={media.thumbnail} alt="" /> : <div className="thumbnail-placeholder" />}
      <div className="preview-body">
        <p className="source">{media.platform}</p>
        <h2>{media.title}</h2>
        <div className="meta-grid">
          <span>
            <UserRound size={16} />
            {media.creator || 'Unknown creator'}
          </span>
          <span>
            <Images size={16} />
            {media.items.length} {media.items.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <dl>
          <div>
            <dt>Media type</dt>
            <dd>{media.mediaType}</dd>
          </div>
          <div>
            <dt>Tool</dt>
            <dd>{media.rawTool}</dd>
          </div>
          {media.requiresCookies && (
            <div>
              <dt>Access</dt>
              <dd>This link may require cookies.</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
