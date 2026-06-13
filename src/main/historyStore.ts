import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { DownloadHistoryEntry } from '../shared/media.js';
import { broadcast } from './utils/broadcast.js';

// Persisted download history under userData. Every download (manual,
// extension, batch, gallery, watch sync) gets an entry that moves through
// queued → downloading → finished/error/cancelled; the Downloads tab renders
// this list live, so in-flight downloads appear alongside past ones.

const maxEntries = 300;
let entries: DownloadHistoryEntry[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

function historyFilePath(): string {
  return path.join(app.getPath('userData'), 'download-history.json');
}

async function loadEntries(): Promise<DownloadHistoryEntry[]> {
  if (entries) {
    return entries;
  }
  try {
    const raw = await fs.readFile(historyFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as DownloadHistoryEntry[];
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }
  // Downloads interrupted by an app quit can never resume; reflect that.
  for (const entry of entries) {
    if (entry.status === 'queued' || entry.status === 'downloading') {
      entry.status = 'cancelled';
      entry.error = 'Interrupted when ClipForge closed.';
    }
  }
  return entries;
}

function persist(): void {
  const snapshot = JSON.stringify(entries ?? [], null, 2);
  writeChain = writeChain
    .then(() => fs.writeFile(historyFilePath(), snapshot, 'utf8'))
    .catch(() => undefined);
}

function notify(): void {
  broadcast('history:changed', entries ?? []);
}

export async function listHistory(): Promise<DownloadHistoryEntry[]> {
  return [...(await loadEntries())];
}

export async function recordHistoryEntry(entry: DownloadHistoryEntry): Promise<void> {
  const all = await loadEntries();
  all.unshift(entry);
  if (all.length > maxEntries) {
    all.length = maxEntries;
  }
  persist();
  notify();
}

export async function updateHistoryEntry(id: string, patch: Partial<DownloadHistoryEntry>): Promise<void> {
  const all = await loadEntries();
  const entry = all.find((candidate) => candidate.id === id);
  if (!entry) {
    return;
  }
  Object.assign(entry, patch);
  persist();
  notify();
}

export async function removeHistoryEntry(id: string): Promise<DownloadHistoryEntry[]> {
  const all = await loadEntries();
  entries = all.filter((candidate) => candidate.id !== id);
  persist();
  notify();
  return [...entries];
}

export async function clearHistory(): Promise<DownloadHistoryEntry[]> {
  const all = await loadEntries();
  // Keep in-flight entries; clearing history should not orphan live downloads.
  entries = all.filter((candidate) => candidate.status === 'queued' || candidate.status === 'downloading');
  persist();
  notify();
  return [...entries];
}
