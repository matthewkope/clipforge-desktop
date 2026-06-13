import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CaptionStyle, DownloadRequest } from '../../shared/media.js';
import { resolveToolPath } from '../toolResolver.js';
import { cleanCaptionText } from './srt.js';

// Word-by-word ("karaoke") caption support for clip burning. YouTube auto
// captions are the only source the pipeline can rely on for word-level timing:
// each auto-caption VTT cue embeds inline timing tags like
// `<00:00:01.234><c> word</c>`. The existing SRT-based path (--sub-format srt)
// strips these, so this module fetches VTT explicitly and parses the inline
// timing, then emits an ASS file using `{\kf...}` karaoke tags for the sweep.
//
// IMPORTANT: this is a best-effort enhancement. When no VTT with word timing is
// available (e.g. caption-less videos that would otherwise hit the whisper
// fallback, which does NOT yield reliable word timing), callers must fall back
// to the existing block-subtitle behavior.

// A single word with absolute (full-video) start/end times in seconds.
interface TimedWord {
  start: number;
  end: number;
  text: string;
}

// A caption line: a run of words to display together as one Dialogue line.
interface KaraokeCue {
  start: number;
  end: number;
  words: TimedWord[];
}

const WORDS_PER_LINE = 6;

// Builds the yt-dlp args to fetch the VTT auto/manual subtitle for a clip's
// source video into the given output template. Mirrors the cookie/strategy
// handling in src/main/ytdlp.ts but is kept inline here because that file is
// owned by another agent and must not be edited. Unlike the SRT fetch, this
// requests `--sub-format vtt` so inline word timing survives.
function buildVttFetchArgs(request: DownloadRequest, outputTemplate: string): string[] {
  const args: string[] = [];

  // Cookies: an explicit cookies.txt file wins, otherwise a browser source
  // (anything but 'none'). Never log the resolved cookie value.
  if (request.cookieFilePath) {
    args.push('--cookies', request.cookieFilePath);
  } else if (request.cookieSource && request.cookieSource !== 'none') {
    args.push('--cookies-from-browser', request.cookieSource);
  }

  // YouTube needs the default-no-web extractor client to avoid the sign-in /
  // bot-check page, matching the rest of the app's YouTube handling.
  if (isYouTubeUrl(request.url)) {
    args.push('--extractor-args', 'youtube:player_client=default,-web');
  }

  // 'en.*' pulls every translated English variant and trips YouTube's subtitle
  // rate limit; one track is enough, so collapse it (and the empty default) to
  // the same 'en,en-orig' the existing SRT path uses.
  const subLang = request.subtitleLanguage === 'en.*' || !request.subtitleLanguage ? 'en,en-orig' : request.subtitleLanguage;

  args.push(
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    subLang,
    '--sub-format',
    'vtt',
    '-o',
    outputTemplate,
    '--',
    request.url
  );

  return args;
}

function isYouTubeUrl(input: string): boolean {
  try {
    const hostname = new URL(input).hostname.toLowerCase();
    return hostname === 'youtu.be' || hostname.endsWith('.youtube.com') || hostname === 'youtube.com';
  } catch {
    return false;
  }
}

// Fetches the VTT auto-caption track and returns word-level cues clipped/shifted
// to the requested clip range, or null when no usable word timing is found
// (caller should then fall back to block subtitles). The yt-dlp exit code is
// tolerated as long as a .vtt landed (a rate-limited later language variant can
// fail the run after the first track is already written).
export async function fetchKaraokeCues(request: DownloadRequest, tempDir: string): Promise<KaraokeCue[] | null> {
  try {
    const args = buildVttFetchArgs(request, path.join(tempDir, 'karaoke.%(ext)s'));
    await runCommand(resolveToolPath('yt-dlp'), args, 120_000).catch(() => undefined);

    const files = await readdir(tempDir);
    // Prefer the auto-caption (a11y) track since manual subtitles rarely carry
    // inline word timing; among matches keep the first vtt.
    const vttFile = files
      .filter((file) => /\.vtt$/i.test(file))
      .sort((a, b) => Number(/orig|auto/i.test(b)) - Number(/orig|auto/i.test(a)))[0];
    if (!vttFile) {
      return null;
    }

    const words = parseVttWordTiming(await readFile(path.join(tempDir, vttFile), 'utf8'));
    if (words.length === 0) {
      // No inline word timing (e.g. a plain manual subtitle); let the caller
      // fall back to the block-subtitle path rather than burning untimed text.
      return null;
    }

    const clipped = request.clipRange ? clipShiftWords(words, request.clipRange.start, request.clipRange.end) : words;
    if (clipped.length === 0) {
      return null;
    }

    return groupWordsIntoCues(clipped);
  } catch {
    return null;
  }
}

// Parses YouTube auto-caption VTT inline word timing. Each cue body looks like:
//   word0<00:00:01.234><c> word1</c><00:00:01.567><c> word2</c>
// The cue's own start time precedes the first token; every `<timestamp>` marks
// the start of the word that follows it. A word's end is the next word's start
// (or the cue end for the last word). Auto captions emit heavily overlapping
// rolling cues, so identical (start,text) words are de-duplicated.
export function parseVttWordTiming(content: string): TimedWord[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const words: TimedWord[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const lines = block.split('\n');
    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex === -1) {
      continue;
    }
    const [startRaw, endRaw] = lines[timeLineIndex].split('-->');
    const cueStart = parseVttTimestamp(startRaw);
    const cueEnd = parseVttTimestamp(endRaw);
    if (cueStart === null || cueEnd === null) {
      continue;
    }

    const body = lines.slice(timeLineIndex + 1).join('\n');
    if (!body.includes('<')) {
      // No inline timestamps in this cue; skip (a block-only cue carries no
      // word timing we can use for the karaoke sweep).
      continue;
    }

    const cueWords = parseCueBodyWords(body, cueStart, cueEnd);
    for (const word of cueWords) {
      const key = `${word.start.toFixed(3)}|${word.text}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      words.push(word);
    }
  }

  // Auto-caption rolling windows can interleave; sort by start and repair any
  // end times that overlap the following word's start.
  words.sort((a, b) => a.start - b.start);
  for (let i = 0; i < words.length - 1; i += 1) {
    if (words[i].end > words[i + 1].start) {
      words[i].end = words[i + 1].start;
    }
  }
  return words.filter((word) => word.end > word.start && word.text.length > 0);
}

// Splits one VTT cue body into timed words. The first run before any timestamp
// inherits the cue's start; each subsequent `<HH:MM:SS.mmm>` sets the start of
// the text that follows it.
function parseCueBodyWords(body: string, cueStart: number, cueEnd: number): TimedWord[] {
  // Tokenize into timestamp markers and text fragments (stripping <c>/</c> and
  // other tags from the fragments via cleanCaptionText).
  const tokens = body.split(/(<\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}>)/);
  const result: TimedWord[] = [];
  let currentStart = cueStart;
  let pendingText = '';

  const flush = (nextStart: number) => {
    const text = cleanCaptionText(pendingText);
    pendingText = '';
    if (text) {
      // A cue may carry multiple space-separated words after a single
      // timestamp; spread them evenly across the interval so each highlights.
      const pieces = text.split(/\s+/).filter(Boolean);
      const span = Math.max(0, nextStart - currentStart);
      const step = pieces.length > 0 ? span / pieces.length : 0;
      pieces.forEach((piece, index) => {
        result.push({
          start: currentStart + step * index,
          end: index === pieces.length - 1 ? nextStart : currentStart + step * (index + 1),
          text: piece
        });
      });
    }
    currentStart = nextStart;
  };

  for (const token of tokens) {
    const stampMatch = token.match(/^<(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})>$/);
    if (stampMatch) {
      const stamp = parseVttTimestamp(stampMatch[1]);
      if (stamp !== null) {
        flush(stamp);
      }
      continue;
    }
    pendingText += token;
  }
  // Final run runs to the cue end.
  flush(cueEnd);

  return result;
}

// Keeps words overlapping [clipStart, clipEnd], shifts them so the clip starts
// at 0, and clamps edges — the word-level analogue of clipShiftCues.
function clipShiftWords(words: TimedWord[], clipStart: number, clipEnd: number): TimedWord[] {
  const shifted: TimedWord[] = [];
  for (const word of words) {
    if (word.end <= clipStart || word.start >= clipEnd) {
      continue;
    }
    shifted.push({
      start: Math.max(0, word.start - clipStart),
      end: Math.min(clipEnd, word.end) - clipStart,
      text: word.text
    });
  }
  return shifted;
}

// Groups a flat word stream into display lines of ~WORDS_PER_LINE words. A large
// gap between words also forces a new line so cues don't span silence.
function groupWordsIntoCues(words: TimedWord[]): KaraokeCue[] {
  const cues: KaraokeCue[] = [];
  let current: TimedWord[] = [];

  const push = () => {
    if (current.length === 0) {
      return;
    }
    cues.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    const gap = previous ? word.start - previous.end : 0;
    if (current.length >= WORDS_PER_LINE || gap > 1.5) {
      push();
    }
    current.push(word);
  }
  push();

  return cues;
}

// Generates an ASS subtitle file with karaoke `{\kf}` highlighting and writes it
// to disk, returning the path. The PrimaryColour is the highlighted/active fill
// (bright yellow) and SecondaryColour is the not-yet-spoken text (white); \kf
// sweeps the fill across each word over its spoken duration.
export async function writeKaraokeAss(cues: KaraokeCue[], style: CaptionStyle | undefined, outputPath: string): Promise<string> {
  await writeFile(outputPath, buildAss(cues, style), 'utf8');
  return outputPath;
}

export function buildAss(cues: KaraokeCue[], style?: CaptionStyle): string {
  const fontSize = style?.size === 'small' ? 14 : style?.size === 'large' ? 28 : 20;
  const alignment = style?.position === 'top' ? 8 : style?.position === 'middle' ? 5 : 2;

  // ASS colours are &HAABBGGRR&. Primary = active highlight (yellow), Secondary
  // = not-yet-spoken text (white). Outline/shadow keep text readable on busy
  // footage, mirroring the block-subtitle force_style.
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1280',
    'PlayResY: 720',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Karaoke,Arial,${fontSize},&H0000FFFF&,&H00FFFFFF&,&H00000000&,&H64000000&,-1,0,0,0,100,100,0,0,1,2,1,${alignment},20,20,30,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, MarginL, MarginR, MarginV, Effect, Text'
  ].join('\n');

  const dialogues = cues.map((cue) => {
    const text = cue.words
      .map((word) => {
        // Centiseconds the highlight fill should take to sweep this word.
        const cs = Math.max(1, Math.round((word.end - word.start) * 100));
        return `{\\kf${cs}}${escapeAssText(word.text)} `;
      })
      .join('')
      .trimEnd();
    return `Dialogue: 0,${formatAssTimestamp(cue.start)},${formatAssTimestamp(cue.end)},Karaoke,,0,0,0,,${text}`;
  });

  return `${header}\n${dialogues.join('\n')}\n`;
}

// ASS text escaping: braces start override blocks and backslashes start tags,
// so neutralize any that appear in caption words.
function escapeAssText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, ' ');
}

// ASS timestamps are H:MM:SS.cc (centiseconds, single-digit hours).
function formatAssTimestamp(value: number): string {
  const clamped = Math.max(0, value);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const centis = Math.round((clamped - Math.floor(clamped)) * 100);
  // Rounding can push centiseconds to 100; carry into seconds defensively.
  const carrySeconds = centis === 100 ? seconds + 1 : seconds;
  const cc = centis === 100 ? 0 : centis;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(carrySeconds).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}

function parseVttTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0')) / 1000;
}

// Minimal spawn-based runner mirroring clipPostprocess/ytdlp: argument array +
// shell:false, resolves stdout/stderr, rejects on non-zero exit so callers can
// tolerate failures with .catch().
function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`${command} took too long while fetching word-level captions.`));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(output.trim() || `${command} exited with code ${code}.`));
      }
    });
  });
}
