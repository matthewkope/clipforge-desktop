import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  bundledBinaryPath,
  isManaged,
  managedBinaryPath,
  managedBinDir,
  resolveToolPath
} from './toolResolver.js';

// Provisions and keeps the core download tools fresh so a freshly-installed app
// works on a machine that has none of them, and so yt-dlp self-heals as sites
// change. Only yt-dlp is downloaded at runtime (a small, reliably-published
// single binary that needs frequent updates); ffmpeg/ffprobe are bundled with
// the app, and gallery-dl stays an optional PATH/pip install for photo galleries.

const ytDlpAsset =
  process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
const ytDlpDownloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAsset}`;
const ytDlpLatestApi = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

// Make sure yt-dlp exists and is a managed (writable, updatable) copy. Safe to
// call on every launch; it does nothing once a managed copy is in place.
export async function provisionCoreTools(): Promise<void> {
  try {
    if (isManaged('yt-dlp')) {
      return;
    }

    // Promote a bundled copy into the writable managed dir so it can be updated.
    const bundled = bundledBinaryPath('yt-dlp');
    if (await pathExists(bundled)) {
      await copyToManaged(bundled);
      return;
    }

    // A developer machine with Homebrew/pip yt-dlp on PATH needs nothing.
    if (toolOnPath('yt-dlp')) {
      return;
    }

    // Nothing available anywhere — fetch the latest standalone binary.
    await downloadYtDlp();
  } catch {
    // Never block startup on provisioning; deps:check surfaces a missing tool.
  }
}

// Refresh the managed yt-dlp in the background if a newer release exists. Only
// touches the app-owned copy; a Homebrew/pip install is left to its own manager.
export async function autoUpdateYtDlp(): Promise<void> {
  try {
    if (!isManaged('yt-dlp')) {
      return;
    }
    const [current, latest] = await Promise.all([installedYtDlpVersion(), latestYtDlpVersion()]);
    if (latest && current !== latest) {
      await downloadYtDlp();
    }
  } catch {
    // Offline or rate-limited: keep the existing binary.
  }
}

async function downloadYtDlp(): Promise<void> {
  await fs.mkdir(managedBinDir(), { recursive: true });
  const dest = managedBinaryPath('yt-dlp');
  const tmp = `${dest}.download`;

  const response = await fetch(ytDlpDownloadUrl, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`yt-dlp download failed: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(tmp, buffer);
  await fs.chmod(tmp, 0o755).catch(() => undefined);
  await fs.rename(tmp, dest);
}

async function copyToManaged(source: string): Promise<void> {
  await fs.mkdir(managedBinDir(), { recursive: true });
  const dest = managedBinaryPath('yt-dlp');
  await fs.copyFile(source, dest);
  await fs.chmod(dest, 0o755).catch(() => undefined);
}

function installedYtDlpVersion(): string | null {
  const result = spawnSync(resolveToolPath('yt-dlp'), ['--version'], { encoding: 'utf8', shell: false });
  if (result.status === 0) {
    return result.stdout.trim() || null;
  }
  return null;
}

async function latestYtDlpVersion(): Promise<string | null> {
  const response = await fetch(ytDlpLatestApi, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ClipForge' }
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { tag_name?: string };
  return data.tag_name ?? null;
}

function toolOnPath(tool: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [tool], { shell: false }).status === 0;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}
