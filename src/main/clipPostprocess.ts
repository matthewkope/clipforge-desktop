import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CaptionStyle, DownloadRequest } from '../shared/media.js';
import { buildSubtitleFetchArgs, buildWhisperAudioArgs } from './ytdlp.js';
import { clipShiftCues, parseTimedCues, serializeSrt } from './utils/srt.js';
import { runWhisperCpp } from './utils/whisper.js';

interface PostprocessOptions {
  request: DownloadRequest;
  inputPath: string;
  onProgress: (message: string) => void;
}

// Applies the requested ffmpeg treatments (9:16 center crop and/or burned-in
// captions) to a downloaded clip, replacing the file in place so the rest of
// the pipeline keeps reporting the same saved path.
export async function postprocessClip({ request, inputPath, onProgress }: PostprocessOptions): Promise<string> {
  const wantsCrop = request.clipCrop === 'vertical';
  const wantsCaptions = Boolean(request.burnCaptions);
  if (!wantsCrop && !wantsCaptions) {
    return inputPath;
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'clipforge-clip-'));
  try {
    const filters: string[] = [];
    if (wantsCrop) {
      // Center crop to 9:16; min() keeps already-vertical sources untouched.
      filters.push("crop='min(iw,ih*9/16)':ih");
    }

    if (wantsCaptions) {
      onProgress('Clip: fetching captions to burn in...');
      const subtitlePath = await fetchClipSubtitle(request, tempDir);
      if (subtitlePath) {
        filters.push(`subtitles=${escapeFilterPath(subtitlePath)}:force_style='${captionForceStyle(request.captionStyle)}'`);
      } else {
        onProgress('Clip: no captions were available, continuing without burned-in captions.');
        if (!wantsCrop) {
          return inputPath;
        }
      }
    }

    onProgress(`Clip: applying ${filters.length === 2 ? '9:16 crop and captions' : wantsCrop ? '9:16 crop' : 'captions'} with ffmpeg...`);
    const processedPath = path.join(tempDir, `processed${path.extname(inputPath) || '.mp4'}`);
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vf',
      filters.join(','),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'copy',
      processedPath
    ]);

    const finalPath = renamedOutputPath(inputPath, wantsCrop, wantsCaptions);
    await rename(processedPath, finalPath).catch(async () => {
      // Cross-device rename (tmp on another volume): fall back to copy.
      await writeFile(finalPath, await readFile(processedPath));
    });
    if (finalPath !== inputPath) {
      await unlink(inputPath).catch(() => undefined);
    }
    return finalPath;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// Downloads the source SRT for the clip's video and re-times it so cue
// timestamps line up with the clipped section (which starts at 0). When no
// source captions land, falls back to transcribing the clip's audio section
// with whisper.cpp (those cues are already clip-relative).
async function fetchClipSubtitle(request: DownloadRequest, tempDir: string): Promise<string | null> {
  try {
    const subtitleRequest =
      request.subtitleLanguage === 'en.*' || !request.subtitleLanguage
        ? // 'en.*' pulls every translated English variant and trips YouTube's
          // subtitle rate limit; one track is enough to burn in.
          { ...request, subtitleLanguage: 'en,en-orig' }
        : request;
    const args = buildSubtitleFetchArgs(subtitleRequest, path.join(tempDir, 'captions.%(ext)s'));
    // Tolerate a failed exit (e.g. rate limit on a later language variant) as
    // long as some subtitle file was written first.
    await runCommand('yt-dlp', args, 120_000).catch(() => undefined);
    const files = await readdir(tempDir);
    const subtitleFile = files
      .filter((file) => /\.(?:srt|vtt)$/i.test(file))
      .sort((a, b) => Number(/orig|auto/i.test(a)) - Number(/orig|auto/i.test(b)))[0];
    if (!subtitleFile) {
      return whisperClipSubtitle(request, tempDir);
    }

    const cues = parseTimedCues(await readFile(path.join(tempDir, subtitleFile), 'utf8'));
    const clipped = request.clipRange ? clipShiftCues(cues, request.clipRange.start, request.clipRange.end) : cues;
    if (clipped.length === 0) {
      return null;
    }

    const shiftedPath = path.join(tempDir, 'burn.srt');
    await writeFile(shiftedPath, serializeSrt(clipped), 'utf8');
    return shiftedPath;
  } catch {
    return null;
  }
}

// Whisper fallback for caption burning: downloads only the clip's audio
// section, so whisper transcribes just the clip and the resulting cues need
// no clipShiftCues re-timing.
async function whisperClipSubtitle(request: DownloadRequest, tempDir: string): Promise<string | null> {
  const audioRequest: DownloadRequest = {
    ...request,
    outputPath: tempDir,
    mediaTitle: 'whisper-clip-audio',
    isPlaylist: false,
    clipRange: undefined,
    outputTemplate: undefined
  };
  const args = buildWhisperAudioArgs(audioRequest, request.clipRange);
  await runCommand('yt-dlp', args, 600_000);
  const files = await readdir(tempDir);
  const audioFile = files.find((file) => /\.wav$/i.test(file));
  if (!audioFile) {
    return null;
  }

  const srtPath = await runWhisperCpp({
    audioPath: path.join(tempDir, audioFile),
    modelPath: request.whisperModelPath
  });
  const cues = parseTimedCues(await readFile(srtPath, 'utf8'));
  if (cues.length === 0) {
    return null;
  }

  const burnPath = path.join(tempDir, 'burn.srt');
  await writeFile(burnPath, serializeSrt(cues), 'utf8');
  return burnPath;
}

// libass styling for burned-in captions. Outline/shadow keep text readable on
// busy footage regardless of the chosen size/position.
function captionForceStyle(style?: CaptionStyle): string {
  const fontSize = style?.size === 'small' ? 14 : style?.size === 'large' ? 28 : 20;
  const alignment = style?.position === 'top' ? 8 : style?.position === 'middle' ? 5 : 2;
  return `Fontsize=${fontSize},Alignment=${alignment},Outline=1,Shadow=1`;
}

// Converts a downloaded MP4 clip to a GIF using ffmpeg's palette approach
// (palettegen + paletteuse in one filter_complex pass), then removes the
// intermediate video file.
export async function convertVideoToGif(inputPath: string): Promise<string> {
  const gifPath = `${inputPath.replace(/\.[^.]+$/u, '')}.gif`;
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-filter_complex',
    '[0:v]fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
    gifPath
  ]);
  await unlink(inputPath).catch(() => undefined);
  return gifPath;
}

function renamedOutputPath(inputPath: string, cropped: boolean, captioned: boolean): string {
  const extension = path.extname(inputPath);
  const base = inputPath.slice(0, inputPath.length - extension.length);
  const tags = [cropped ? '9x16' : null, captioned ? 'captions' : null].filter(Boolean).join(' ');
  return `${base} [${tags}]${extension}`;
}

// The subtitles filter parses its argument with ffmpeg's filter grammar.
// Quoting the path makes : and , literal; the burn.srt path is a temp path we
// control, so embedded quotes (closed-quote escape dance) never occur.
function escapeFilterPath(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

function runFfmpeg(args: string[]): Promise<void> {
  return runCommand('ffmpeg', args, 600_000).then(() => undefined);
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`${command} took too long while post-processing the clip.`));
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
