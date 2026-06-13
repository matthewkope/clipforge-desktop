import assert from 'node:assert/strict';
import test from 'node:test';
import { detectMediaIntent, detectPlatform } from '../dist/main/urlRouter.js';
import { buildDownloadArgs, classifyYtDlpError } from '../dist/main/ytdlp.js';

test('detects Reddit URLs', () => {
  assert.equal(detectPlatform('https://www.reddit.com/r/videos/comments/abc123/some_clip/'), 'reddit');
  assert.equal(detectPlatform('https://redd.it/abc123'), 'reddit');
  assert.equal(detectPlatform('https://v.redd.it/xyz789'), 'reddit');
  assert.equal(detectMediaIntent('https://www.reddit.com/r/videos/comments/abc123/some_clip/'), 'reddit-video');
  assert.equal(detectMediaIntent('https://v.redd.it/xyz789'), 'reddit-video');
  assert.equal(detectMediaIntent('https://www.reddit.com/r/pics/'), 'reddit-post');
});

test('detects Twitch URLs', () => {
  assert.equal(detectPlatform('https://www.twitch.tv/videos/123456789'), 'twitch');
  assert.equal(detectPlatform('https://clips.twitch.tv/FunnyClipSlug'), 'twitch');
  assert.equal(detectMediaIntent('https://www.twitch.tv/videos/123456789'), 'twitch-video');
  assert.equal(detectMediaIntent('https://clips.twitch.tv/FunnyClipSlug'), 'twitch-clip');
  assert.equal(detectMediaIntent('https://www.twitch.tv/somestreamer/clip/FunnyClipSlug'), 'twitch-clip');
});

test('GIF output downloads a 480p-capped MP4 with clip sections', () => {
  const args = buildDownloadArgs(
    {
      url: 'https://www.youtube.com/watch?v=example',
      outputTypes: ['gif'],
      outputPath: '/tmp',
      clipRange: { start: 5, end: 15 }
    },
    'gif'
  );
  assert.equal(args.includes('bv*[height<=480]+ba/b[height<=480]'), true);
  assert.equal(args.includes('--merge-output-format'), true);
  assert.equal(args.includes('--download-sections'), true);
  assert.equal(args.includes('*5-15'), true);
});

test('custom output templates substitute placeholders and sanitize literals', () => {
  const args = buildDownloadArgs(
    {
      url: 'https://www.youtube.com/watch?v=example',
      outputTypes: ['mp4'],
      outputPath: '/tmp',
      mediaTitle: 'My: Video',
      outputTemplate: '{uploader} - {title} ({date}) 100%'
    },
    'mp4'
  );
  const outputIndex = args.indexOf('-o');
  assert.equal(args[outputIndex + 1], '/tmp/%(uploader)s - My Video (%(upload_date)s) 100 percent.%(ext)s');
});

test('custom output templates keep the clip suffix and fall back to %(title)s', () => {
  const args = buildDownloadArgs(
    {
      url: 'https://www.youtube.com/watch?v=example',
      outputTypes: ['mp4'],
      outputPath: '/tmp',
      outputTemplate: '{title} [{id}]',
      clipRange: { start: 0, end: 10 }
    },
    'mp4'
  );
  const outputIndex = args.indexOf('-o');
  assert.equal(args[outputIndex + 1], '/tmp/%(title)s [%(id)s] [clip 0.00-0.10].%(ext)s');
});

test('classifies age-restricted, geo-blocked, and missing-format errors', () => {
  assert.match(classifyYtDlpError('ERROR: Sign in to confirm your age'), /age-restricted/i);
  assert.match(classifyYtDlpError('This video is age restricted'), /age-restricted/i);
  assert.match(classifyYtDlpError('The uploader has not made this video available in your country'), /region/i);
  assert.match(classifyYtDlpError('ERROR: Requested format is not available'), /quality/i);
});
