import type { MediaItem } from '../../shared/media.js';
import { normalizeMediaUrl } from './pinterestNormalize.js';

export function dedupeMediaItems(items: MediaItem[]): { items: MediaItem[]; duplicateCount: number } {
  const byPinId = new Map<string, MediaItem>();
  const byMediaUrl = new Map<string, MediaItem>();
  const byThumbnailUrl = new Map<string, MediaItem>();
  const output: MediaItem[] = [];
  let duplicateCount = 0;

  for (const item of items) {
    const pinKey = item.pinId || undefined;
    const mediaKey = normalizeMediaUrl(item.mediaUrl || item.url);
    const thumbKey = normalizeMediaUrl(item.thumbnailUrl || item.thumbnail);
    const existing =
      (pinKey && byPinId.get(pinKey)) ||
      (mediaKey && byMediaUrl.get(mediaKey)) ||
      (mediaKey && byThumbnailUrl.get(mediaKey)) ||
      (thumbKey && byThumbnailUrl.get(thumbKey)) ||
      (thumbKey && byMediaUrl.get(thumbKey));

    if (existing) {
      duplicateCount += 1;
      const replacement = highestQuality(existing, item);
      if (replacement !== existing) {
        const existingIndex = output.indexOf(existing);
        if (existingIndex >= 0) {
          output[existingIndex] = replacement;
        }
      }
      remember(replacement, byPinId, byMediaUrl, byThumbnailUrl);
      continue;
    }

    output.push(item);
    remember(item, byPinId, byMediaUrl, byThumbnailUrl);
  }

  return {
    items: output.map((item, index) => ({ ...item, index: index + 1 })),
    duplicateCount
  };
}

function remember(
  item: MediaItem,
  byPinId: Map<string, MediaItem>,
  byMediaUrl: Map<string, MediaItem>,
  byThumbnailUrl: Map<string, MediaItem>
): void {
  if (item.pinId) {
    byPinId.set(item.pinId, item);
  }
  const mediaKey = normalizeMediaUrl(item.mediaUrl || item.url);
  const thumbKey = normalizeMediaUrl(item.thumbnailUrl || item.thumbnail);
  if (mediaKey) {
    byMediaUrl.set(mediaKey, item);
  }
  if (thumbKey) {
    byThumbnailUrl.set(thumbKey, item);
  }
}

function highestQuality(a: MediaItem, b: MediaItem): MediaItem {
  const areaA = (a.width ?? 0) * (a.height ?? 0);
  const areaB = (b.width ?? 0) * (b.height ?? 0);
  if (areaB > areaA) {
    return { ...b, index: a.index };
  }
  if (!a.mediaUrl && b.mediaUrl) {
    return { ...b, index: a.index };
  }
  return a;
}
