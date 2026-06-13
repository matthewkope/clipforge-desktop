import assert from 'node:assert/strict';
import test from 'node:test';
import { clipShiftCues, parseTimedCues, serializeSrt } from '../dist/main/utils/srt.js';

const sampleSrt = `1
00:00:01,000 --> 00:00:03,500
Hello there.

2
00:00:04,000 --> 00:00:06,000
<i>General</i> Kenobi!

3
00:00:07,250 --> 00:00:09,000
[music]
You are a bold one.
`;

test('parses SRT cues with timestamps and cleaned text', () => {
  const cues = parseTimedCues(sampleSrt);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { start: 1, end: 3.5, text: 'Hello there.' });
  assert.equal(cues[1].text, 'General Kenobi!');
  assert.equal(cues[2].text, 'You are a bold one.');
});

test('parses VTT-style timestamps with dots', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
First line
`;
  const cues = parseTimedCues(vtt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 2);
});

test('merges rolling duplicate auto-caption cues', () => {
  const rolling = `1
00:00:01,000 --> 00:00:02,000
hello world

2
00:00:02,000 --> 00:00:03,000
hello world
`;
  const cues = parseTimedCues(rolling);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].end, 3);
});

test('clipShiftCues keeps overlapping cues and re-times them to clip start', () => {
  const cues = parseTimedCues(sampleSrt);
  const clipped = clipShiftCues(cues, 4, 8);
  assert.equal(clipped.length, 2);
  assert.deepEqual(clipped[0], { start: 0, end: 2, text: 'General Kenobi!' });
  assert.equal(clipped[1].start, 3.25);
  assert.equal(clipped[1].end, 4);
});

test('serializeSrt round-trips through parseTimedCues', () => {
  const cues = [
    { start: 0, end: 2, text: 'First.' },
    { start: 2.5, end: 4.25, text: 'Second.' }
  ];
  const reparsed = parseTimedCues(serializeSrt(cues));
  assert.deepEqual(reparsed, cues);
});
