import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, Notification } from 'electron';
import type { WatchOutputType, WatchSubscription, WatchSubscriptionInput } from '../shared/media.js';
import { recordHistoryEntry, removeHistoryEntry, updateHistoryEntry } from './historyStore.js';
import { broadcast } from './utils/broadcast.js';

// Watch folders: "download anything new from this channel/playlist/profile
// into this folder." Each subscription keeps a hidden yt-dlp download archive
// under userData, so a sync only fetches items it has never downloaded.
// The first sync grabs just the few most recent uploads (not the whole
// backlog); later syncs scan the newest entries and skip archived ones.

const checkIntervalMs = 60_000;
const firstSyncItemCap = 3;
const incrementalScanCap = 25;
const allowedOutputTypes = new Set<WatchOutputType>(['mp4', 'mp3', 'm4a', 'wav']);

let subscriptions: WatchSubscription[] | null = null;
let writeChain: Promise<void> = Promise.resolve();
let schedulerTimer: NodeJS.Timeout | null = null;
const syncing = new Set<string>();

function subscriptionsFilePath(): string {
  return path.join(app.getPath('userData'), 'watch-subscriptions.json');
}

function archivePathFor(id: string): string {
  return path.join(app.getPath('userData'), 'archives', 'watch', `${id}.txt`);
}

async function loadSubscriptions(): Promise<WatchSubscription[]> {
  if (subscriptions) {
    return subscriptions;
  }
  try {
    const raw = await fs.readFile(subscriptionsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as WatchSubscription[];
    subscriptions = Array.isArray(parsed) ? parsed : [];
  } catch {
    subscriptions = [];
  }
  return subscriptions;
}

function persist(): void {
  const snapshot = JSON.stringify(subscriptions ?? [], null, 2);
  writeChain = writeChain
    .then(() => fs.writeFile(subscriptionsFilePath(), snapshot, 'utf8'))
    .catch(() => undefined);
}

function withRuntimeState(subscription: WatchSubscription): WatchSubscription {
  return { ...subscription, syncing: syncing.has(subscription.id) };
}

function notify(): void {
  broadcast('watch:changed', (subscriptions ?? []).map(withRuntimeState));
}

export async function listWatchSubscriptions(): Promise<WatchSubscription[]> {
  return (await loadSubscriptions()).map(withRuntimeState);
}

export async function addWatchSubscription(input: WatchSubscriptionInput): Promise<WatchSubscription[]> {
  validateInput(input);
  const all = await loadSubscriptions();
  all.push({
    id: randomUUID(),
    url: input.url.trim(),
    label: input.label?.trim() || defaultLabel(input.url),
    outputType: input.outputType,
    outputPath: input.outputPath,
    intervalMinutes: Math.max(15, Math.round(input.intervalMinutes) || 60),
    enabled: true,
    createdAt: new Date().toISOString()
  });
  persist();
  notify();
  return listWatchSubscriptions();
}

export async function updateWatchSubscription(
  id: string,
  patch: Partial<WatchSubscriptionInput> & { enabled?: boolean }
): Promise<WatchSubscription[]> {
  const all = await loadSubscriptions();
  const subscription = all.find((candidate) => candidate.id === id);
  if (subscription) {
    if (typeof patch.enabled === 'boolean') {
      subscription.enabled = patch.enabled;
    }
    if (typeof patch.intervalMinutes === 'number' && Number.isFinite(patch.intervalMinutes)) {
      subscription.intervalMinutes = Math.max(15, Math.round(patch.intervalMinutes));
    }
    if (typeof patch.label === 'string' && patch.label.trim()) {
      subscription.label = patch.label.trim();
    }
    if (typeof patch.outputPath === 'string' && patch.outputPath.trim()) {
      subscription.outputPath = patch.outputPath;
    }
    if (patch.outputType && allowedOutputTypes.has(patch.outputType)) {
      subscription.outputType = patch.outputType;
    }
    persist();
    notify();
  }
  return listWatchSubscriptions();
}

export async function removeWatchSubscription(id: string): Promise<WatchSubscription[]> {
  const all = await loadSubscriptions();
  subscriptions = all.filter((candidate) => candidate.id !== id);
  persist();
  notify();
  await fs.rm(archivePathFor(id), { force: true }).catch(() => undefined);
  return listWatchSubscriptions();
}

export async function syncWatchSubscriptionNow(id: string): Promise<WatchSubscription[]> {
  const all = await loadSubscriptions();
  const subscription = all.find((candidate) => candidate.id === id);
  if (subscription) {
    void runSync(subscription);
  }
  return listWatchSubscriptions();
}

export function startWatchScheduler(): void {
  if (schedulerTimer) {
    return;
  }
  schedulerTimer = setInterval(() => {
    void checkDueSubscriptions();
  }, checkIntervalMs);
  // First pass shortly after launch so overdue subscriptions catch up.
  setTimeout(() => void checkDueSubscriptions(), 15_000);
}

export function stopWatchScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

async function checkDueSubscriptions(): Promise<void> {
  const all = await loadSubscriptions();
  const now = Date.now();
  for (const subscription of all) {
    if (!subscription.enabled || syncing.has(subscription.id)) {
      continue;
    }
    const lastChecked = subscription.lastCheckedAt ? Date.parse(subscription.lastCheckedAt) : 0;
    if (now - lastChecked >= subscription.intervalMinutes * 60_000) {
      // Sequential on purpose: one watch sync at a time keeps yt-dlp from
      // competing with itself (and with user downloads) for bandwidth.
      await runSync(subscription);
    }
  }
}

async function runSync(subscription: WatchSubscription): Promise<void> {
  if (syncing.has(subscription.id)) {
    return;
  }
  syncing.add(subscription.id);
  notify();

  const historyId = randomUUID();
  await recordHistoryEntry({
    id: historyId,
    url: subscription.url,
    title: subscription.label,
    label: `Watch · ${subscription.outputType.toUpperCase()}`,
    outputPath: subscription.outputPath,
    status: 'downloading',
    savedPaths: [],
    source: 'watch',
    createdAt: new Date().toISOString()
  });

  try {
    const archivePath = archivePathFor(subscription.id);
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    const firstSync = !(await fileExists(archivePath));
    const args = buildSyncArgs(subscription, archivePath, firstSync);
    const savedPaths = await runYtDlpSync(args);

    subscription.lastCheckedAt = new Date().toISOString();
    subscription.lastResult =
      savedPaths.length > 0 ? `${savedPaths.length} new file${savedPaths.length === 1 ? '' : 's'}` : 'Nothing new';
    if (savedPaths.length > 0) {
      await updateHistoryEntry(historyId, {
        status: 'finished',
        savedPaths,
        completedAt: new Date().toISOString()
      });
      showWatchNotification(savedPaths.length, subscription.label);
    } else {
      // No new uploads: drop the entry instead of spamming history.
      await removeHistoryEntry(historyId);
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Watch sync failed.';
    subscription.lastCheckedAt = new Date().toISOString();
    subscription.lastResult = `Error: ${message.slice(0, 160)}`;
    await updateHistoryEntry(historyId, {
      status: 'error',
      error: message.slice(0, 400),
      completedAt: new Date().toISOString()
    });
  } finally {
    syncing.delete(subscription.id);
    persist();
    notify();
  }
}

// System notification when a watch sync lands new files, so the user hears
// about background downloads without keeping the app window open.
function showWatchNotification(fileCount: number, label: string): void {
  try {
    if (!Notification.isSupported()) {
      return;
    }
    new Notification({
      title: 'ClipForge watch',
      body: `${fileCount} new file${fileCount === 1 ? '' : 's'} from ${label}`
    }).show();
  } catch {
    // Notifications are best-effort; a sync should never fail because of one.
  }
}

function buildSyncArgs(subscription: WatchSubscription, archivePath: string, firstSync: boolean): string[] {
  const args = [
    '--newline',
    '--no-warnings',
    '--yes-playlist',
    '--lazy-playlist',
    '--playlist-end',
    String(firstSync ? firstSyncItemCap : incrementalScanCap),
    '--download-archive',
    archivePath,
    '-o',
    path.join(subscription.outputPath, '%(title)s.%(ext)s')
  ];
  if (subscription.outputType === 'mp4') {
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  } else {
    args.push('-x', '--audio-format', subscription.outputType);
  }
  args.push(subscription.url);
  return args;
}

function runYtDlpSync(args: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const savedPaths: string[] = [];

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) {
        const merged = line.match(/\[Merger\] Merging formats into "(.+?)"/u)?.[1];
        const extracted = line.match(/\[ExtractAudio\] Destination: (.+)/u)?.[1];
        const destination = line.match(/\[download\] Destination: (.+)/u)?.[1];
        for (const candidate of [merged, extracted, destination]) {
          const trimmed = candidate?.trim();
          if (trimmed && !savedPaths.includes(trimmed)) {
            savedPaths.push(trimmed);
          }
        }
      }
    };
    child.stdout.on('data', handleOutput);
    child.stderr.on('data', handleOutput);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(finalMediaPaths(savedPaths));
      } else {
        reject(new Error(output.trim().split('\n').slice(-4).join(' ') || 'yt-dlp sync failed.'));
      }
    });
  });
}

// Drop intermediate format fragments the same way the download manager does.
function finalMediaPaths(paths: string[]): string[] {
  return paths.filter(
    (filePath) => !/\.f\d+\.[a-z0-9]+$/iu.test(filePath) && !/\.(?:part|ytdl)$/iu.test(filePath)
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function validateInput(input: WatchSubscriptionInput): void {
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    throw new Error('Enter a valid channel, playlist, or profile URL to watch.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Watch URLs must use http or https.');
  }
  if (!input.outputPath?.trim()) {
    throw new Error('Choose a folder for this watch subscription.');
  }
  if (!allowedOutputTypes.has(input.outputType)) {
    throw new Error('Choose MP4, MP3, M4A, or WAV for watch downloads.');
  }
}

function defaultLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.at(-1) || parsed.hostname;
  } catch {
    return url;
  }
}
