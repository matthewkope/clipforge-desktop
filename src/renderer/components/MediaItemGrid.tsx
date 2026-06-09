import { Check, ImageIcon, Video } from 'lucide-react';
import type { MediaItem } from '../../shared/media';

interface MediaItemGridProps {
  items: MediaItem[];
  selectedItems: number[];
  onChange: (items: number[]) => void;
}

export function MediaItemGrid({ items, selectedItems, onChange }: MediaItemGridProps) {
  const selected = new Set(selectedItems);

  function toggle(index: number) {
    if (selected.has(index)) {
      onChange(selectedItems.filter((item) => item !== index));
      return;
    }
    onChange([...selectedItems, index].sort((a, b) => a - b));
  }

  return (
    <section className="media-grid-panel">
      <div className="media-grid-heading">
        <div>
          <h3>Media items</h3>
          <p>{selectedItems.length} selected</p>
        </div>
        <div className="media-grid-actions">
          <button type="button" onClick={() => onChange(items.map((item) => item.index))}>
            Select all
          </button>
          <button type="button" onClick={() => onChange([])}>
            Deselect all
          </button>
        </div>
      </div>
      <div className="media-grid">
        {items.map((item) => {
          const isSelected = selected.has(item.index);
          const TypeIcon = item.type === 'video' ? Video : ImageIcon;
          const previewUrl = mediaPreviewUrl(item);
          const canAnimateVideo = previewUrl && /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(previewUrl);
          return (
            <button
              key={`${item.index}-${item.id}`}
              type="button"
              className={isSelected ? 'selected' : ''}
              onClick={() => toggle(item.index)}
              aria-pressed={isSelected}
            >
              {canAnimateVideo ? (
                <video src={previewUrl} muted loop playsInline autoPlay />
              ) : previewUrl ? (
                <img src={previewUrl} alt="" />
              ) : (
                <span className="media-placeholder" />
              )}
              <span className="media-badge">
                {isSelected ? <Check size={14} /> : <TypeIcon size={14} />}
                {item.index}
              </span>
              <small>{mediaLabel(item)}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function mediaPreviewUrl(item: MediaItem): string | undefined {
  if (item.mediaUrl && /\.(?:gif)(?:[?#]|$)/i.test(item.mediaUrl)) {
    return item.mediaUrl;
  }
  if (item.mediaUrl && /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(item.mediaUrl)) {
    return item.mediaUrl;
  }
  return item.thumbnail || item.thumbnailUrl || item.url || item.mediaUrl;
}

function mediaLabel(item: MediaItem): string {
  const value = `${item.extension ?? ''} ${item.mediaUrl ?? ''}`.toLowerCase();
  if (/\bgif\b|\.gif(?:[?#]|$)/i.test(value)) {
    return 'GIF';
  }
  if (/\.m3u8(?:[?#]|$)|\bm3u8\b/i.test(value)) {
    return 'Video';
  }
  return item.type === 'unknown' ? 'Image' : item.type;
}
