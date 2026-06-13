import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Images, UserRound } from 'lucide-react';
import type { MediaAnalyzerResult, MediaItem } from '../../shared/media';

interface GalleryPreviewCardProps {
  media: MediaAnalyzerResult | null;
}

function itemCountLabel(media: MediaAnalyzerResult): string {
  const photos = media.items.filter((item) => item.type === 'image').length;
  const videos = media.items.filter((item) => item.type === 'video').length;
  const parts = [
    photos > 0 ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : '',
    videos > 0 ? `${videos} ${videos === 1 ? 'video' : 'videos'}` : ''
  ].filter(Boolean);
  if (parts.length === 0) {
    return `${media.items.length} ${media.items.length === 1 ? 'item' : 'items'}`;
  }
  return parts.join(' · ');
}

function itemImage(item: MediaItem): string | undefined {
  return item.thumbnail || (item.type === 'image' ? item.url : undefined);
}

export function GalleryPreviewCard({ media }: GalleryPreviewCardProps) {
  const [slide, setSlide] = useState(0);
  const slides = media?.items.map(itemImage).filter((src): src is string => Boolean(src)) ?? [];

  useEffect(() => {
    setSlide(0);
  }, [media?.sourceUrl]);

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

  const currentSlide = Math.min(slide, Math.max(0, slides.length - 1));
  const cover = slides[currentSlide] ?? media.thumbnail;
  const showArrows = slides.length > 1;
  const cycle = (step: number) => {
    setSlide((current) => (current + step + slides.length) % slides.length);
  };

  return (
    <section className="preview-card">
      <div className="carousel-viewer">
        {cover ? <img src={cover} alt="" /> : <div className="thumbnail-placeholder" />}
        {showArrows && (
          <>
            <button type="button" className="carousel-arrow carousel-arrow-left" aria-label="Previous photo" onClick={() => cycle(-1)}>
              <ChevronLeft size={26} />
            </button>
            <button type="button" className="carousel-arrow carousel-arrow-right" aria-label="Next photo" onClick={() => cycle(1)}>
              <ChevronRight size={26} />
            </button>
            <span className="carousel-counter">
              {currentSlide + 1} / {slides.length}
            </span>
          </>
        )}
      </div>
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
            {itemCountLabel(media)}
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
