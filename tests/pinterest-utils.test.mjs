import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupeMediaItems } from '../dist/main/utils/dedupeMediaItems.js';
import { extractPinterestPinId, normalizeMediaUrl, normalizePinterestUrl } from '../dist/main/utils/pinterestNormalize.js';
import { buildRange } from '../dist/main/utils/rangeBuilder.js';
import { detectMediaIntent, detectPlatform } from '../dist/main/urlRouter.js';
import { isPinterestPinObject, shouldTryPublicPinterestAnalysis } from '../dist/main/downloaders/pinterestAdapter.js';
import { buildDownloadArgs } from '../dist/main/ytdlp.js';

test('detects Pinterest board and pin URLs', () => {
  assert.equal(detectPlatform('https://www.pinterest.com/matt/ideas/'), 'pinterest');
  assert.equal(detectMediaIntent('https://www.pinterest.com/pin/123456789/'), 'pinterest-pin');
  assert.equal(detectMediaIntent('https://www.pinterest.com/matt/ideas/'), 'pinterest-board');
});

test('detects TikTok video URLs', () => {
  assert.equal(detectPlatform('https://www.tiktok.com/@clipforge/video/1234567890'), 'tiktok');
  assert.equal(detectPlatform('https://vm.tiktok.com/ZMexample/'), 'tiktok');
  assert.equal(detectMediaIntent('https://www.tiktok.com/@clipforge/video/1234567890'), 'tiktok-video');
});

test('detects X and Twitter video URLs', () => {
  assert.equal(detectPlatform('https://x.com/clipforge/status/1234567890'), 'x');
  assert.equal(detectPlatform('https://twitter.com/clipforge/status/1234567890'), 'x');
  assert.equal(detectMediaIntent('https://x.com/clipforge/status/1234567890'), 'x-video');
});

test('extension downloads can force a fresh output for the same URL', () => {
  const args = buildDownloadArgs(
    {
      url: 'https://www.youtube.com/watch?v=example',
      outputTypes: ['mp3'],
      outputPath: '/tmp',
      forceOverwrite: true
    },
    'mp3'
  );
  assert.equal(args.includes('--force-overwrites'), true);
  assert.equal(args.includes('--no-continue'), true);
});

test('normalizes Pinterest board URLs without tracking params', () => {
  const normalized = normalizePinterestUrl('https://pinterest.com/matt/ideas/?utm_source=test&invite_code=abc');
  assert.equal(normalized.normalizedUrl, 'https://www.pinterest.com/matt/ideas/');
  assert.equal(normalized.type, 'board');
  assert.equal(normalized.owner, 'matt');
  assert.equal(normalized.boardSlug, 'ideas');
});

test('preserves Pinterest section URLs', () => {
  const normalized = normalizePinterestUrl('https://www.pinterest.com/matt/ideas/section-one/?x=1');
  assert.equal(normalized.normalizedUrl, 'https://www.pinterest.com/matt/ideas/section-one/');
  assert.equal(normalized.type, 'section');
});

test('extracts pin IDs', () => {
  assert.equal(extractPinterestPinId('https://www.pinterest.com/pin/987654321/'), '987654321');
  assert.equal(extractPinterestPinId('pin 1234567890 media'), '1234567890');
});

test('uses the public fast path for individual Pinterest pins only', () => {
  assert.equal(shouldTryPublicPinterestAnalysis({ type: 'pin' }), true);
  assert.equal(shouldTryPublicPinterestAnalysis({ type: 'board' }), false);
  assert.equal(shouldTryPublicPinterestAnalysis({ type: 'section' }), false);
});

test('dedupes by pin ID and normalized media URL', () => {
  const { items, duplicateCount } = dedupeMediaItems([
    { id: 'a', pinId: '1', index: 1, type: 'image', mediaUrl: 'https://i.pinimg.com/a.jpg?x=1', selected: true, width: 100, height: 100 },
    { id: 'b', pinId: '1', index: 2, type: 'image', mediaUrl: 'https://i.pinimg.com/a.jpg?x=2', selected: true, width: 200, height: 200 },
    { id: 'c', index: 3, type: 'image', mediaUrl: 'https://i.pinimg.com/c.jpg?x=1', selected: true },
    { id: 'd', index: 4, type: 'image', mediaUrl: 'https://i.pinimg.com/c.jpg?x=2', selected: true }
  ]);
  assert.equal(duplicateCount, 2);
  assert.equal(items.length, 2);
  assert.equal(items[0].width, 200);
  assert.equal(normalizeMediaUrl('https://i.pinimg.com/c.jpg?x=1'), 'https://i.pinimg.com/c.jpg');
});

test('dedupes when one item media URL is another item thumbnail URL', () => {
  const { items, duplicateCount } = dedupeMediaItems([
    {
      id: 'gif',
      index: 1,
      type: 'image',
      mediaUrl: 'https://i.pinimg.com/originals/a.gif?format=gif',
      thumbnailUrl: 'https://i.pinimg.com/236x/a.jpg',
      selected: true
    },
    {
      id: 'preview',
      index: 2,
      type: 'image',
      mediaUrl: 'https://i.pinimg.com/236x/a.jpg?x=1',
      selected: true
    }
  ]);
  assert.equal(duplicateCount, 1);
  assert.equal(items.length, 1);
});

test('range builder remains available for non-Pinterest tools', () => {
  assert.equal(buildRange([1, 2, 3, 7, 9, 10, 11]), '1-3,7,9-11');
});

test('Pinterest parser accepts pin-level objects but rejects nested image variants', () => {
  const pin = {
    id: '123456789012',
    images: {
      orig: { url: 'https://i.pinimg.com/originals/a.jpg' },
      '736x': { url: 'https://i.pinimg.com/736x/a.jpg' }
    }
  };
  const nestedVariant = { url: 'https://i.pinimg.com/736x/a.jpg', width: 736, height: 1000 };
  const board = { id: '222222222222', name: 'board-name' };

  assert.equal(isPinterestPinObject(pin), true);
  assert.equal(isPinterestPinObject(nestedVariant), false);
  assert.equal(isPinterestPinObject(board), false);
});

test('Pinterest parser accepts GIF pin objects with nested animated media', () => {
  const gifPin = {
    id: '987654321098',
    images: {
      '236x': { url: 'https://i.pinimg.com/236x/preview.jpg' }
    },
    videos: {
      video_list: {
        V_HLSV4: { url: 'https://v.pinimg.com/videos/animated.m3u8' }
      }
    }
  };

  assert.equal(isPinterestPinObject(gifPin), true);
});

test('Pinterest parser accepts emitted board items with media even when pin ID is missing', () => {
  const emittedGifItem = {
    videos: {
      video_list: {
        V_HLSV4: { url: 'https://v.pinimg.com/videos/animated.m3u8' }
      }
    },
    images: {
      '236x': { url: 'https://i.pinimg.com/236x/preview.jpg' }
    }
  };
  const nestedVideoVariant = { url: 'https://v.pinimg.com/videos/animated.m3u8' };

  assert.equal(isPinterestPinObject(emittedGifItem, ['items', '7']), true);
  assert.equal(isPinterestPinObject(nestedVideoVariant, ['items', '7', 'videos', 'video_list', 'V_HLSV4']), false);
});
