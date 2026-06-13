import fs from 'node:fs/promises';
import path from 'node:path';
import { listHistory } from '../historyStore.js';

// Guards for IPC handlers that touch the filesystem on a renderer-supplied path.
// The renderer should only ever ask to preview/open files this app actually
// produced (tracked in download history) or plain folders — never arbitrary
// files (which would be an info-leak / file-read oracle) or executable bundles
// (which shell.openPath would launch).

// macOS bundles and other directory types the OS treats as launchable.
const launchableDirSuffixes = ['.app', '.command', '.workflow', '.scpt', '.scptd', '.term', '.prefpane'];

async function knownDownloadFiles(): Promise<Set<string>> {
  const history = await listHistory();
  const files = new Set<string>();
  for (const entry of history) {
    for (const saved of entry.savedPaths) {
      if (saved) {
        files.add(path.resolve(saved));
      }
    }
  }
  return files;
}

// True only when filePath is a file this app downloaded (matches a history
// entry's savedPaths). Used to gate reading a file's bytes back to the renderer.
export async function isKnownDownloadFile(filePath: string): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  const resolved = path.resolve(filePath);
  return (await knownDownloadFiles()).has(resolved);
}

// True when it is safe to hand targetPath to shell.openPath / showItemInFolder:
// a plain (non-launchable) directory, or a file we actually downloaded.
export async function isSafeOpenTarget(targetPath: string): Promise<boolean> {
  if (!targetPath) {
    return false;
  }
  const resolved = path.resolve(targetPath);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return false;
  }

  if (stat.isDirectory()) {
    const lower = resolved.toLowerCase();
    return !launchableDirSuffixes.some((suffix) => lower.endsWith(suffix));
  }

  return (await knownDownloadFiles()).has(resolved);
}
