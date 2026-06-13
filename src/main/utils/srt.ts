import type { TranscriptSegment } from '../../shared/media.js';

// Timed caption cue helpers shared by clip caption burning (which must shift
// full-video SRT timestamps to clip-relative time) and the extension's
// transcript search endpoint. Handles both SRT (00:00:01,000) and VTT
// (00:00:01.000) timestamps.

const timestampPattern = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})|(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const cueLinePattern = /-->/;

export function parseTimedCues(content: string): TranscriptSegment[] {
  const cues: TranscriptSegment[] = [];
  const blocks = content.replace(/\r\n/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim());
    const timeLineIndex = lines.findIndex((line) => cueLinePattern.test(line));
    if (timeLineIndex === -1) {
      continue;
    }
    const [startRaw, endRaw] = lines[timeLineIndex].split('-->');
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);
    if (start === null || end === null) {
      continue;
    }
    const text = lines
      .slice(timeLineIndex + 1)
      .map(cleanCaptionText)
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      continue;
    }
    // YouTube auto captions often repeat the previous line as a rolling
    // window; drop cues whose text already appeared at the tail of the last.
    const previous = cues[cues.length - 1];
    if (previous && (previous.text === text || previous.text.endsWith(text))) {
      previous.end = Math.max(previous.end, end);
      continue;
    }
    cues.push({ start, end, text });
  }

  return cues;
}

// Re-times full-video cues for a clipped section: keeps cues overlapping
// [clipStart, clipEnd], shifts them so the clip starts at 0, and clamps edges.
export function clipShiftCues(cues: TranscriptSegment[], clipStart: number, clipEnd: number): TranscriptSegment[] {
  const shifted: TranscriptSegment[] = [];
  for (const cue of cues) {
    if (cue.end <= clipStart || cue.start >= clipEnd) {
      continue;
    }
    shifted.push({
      start: Math.max(0, cue.start - clipStart),
      end: Math.min(clipEnd, cue.end) - clipStart,
      text: cue.text
    });
  }
  return shifted;
}

export function serializeSrt(cues: TranscriptSegment[]): string {
  return (
    cues
      .map((cue, index) => `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}`)
      .join('\n\n') + '\n'
  );
}

export function cleanCaptionText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.trim().match(timestampPattern);
  if (!match) {
    return null;
  }
  if (match[1] !== undefined) {
    return (
      Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0')) / 1000
    );
  }
  return Number(match[5]) * 60 + Number(match[6]) + Number(match[7].padEnd(3, '0')) / 1000;
}

function formatSrtTimestamp(value: number): string {
  const clamped = Math.max(0, value);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}
