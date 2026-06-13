import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import type { DownloadTool, YtDlpUpdateInfo } from '../shared/media.js';
import { isManaged, resolveToolPath } from './toolResolver.js';
import { updateManagedYtDlp } from './binaryManager.js';

// yt-dlp breaks whenever YouTube changes its player; surfacing "you are out of
// date" in the app is the cheapest reliability win available. Versions are
// date-shaped (2026.05.10) so plain string inequality is a safe comparison.
export async function checkYtDlpUpdate(): Promise<YtDlpUpdateInfo | null> {
  try {
    const current = (await runCapture(resolveToolPath('yt-dlp'), ['--version'], 10_000)).trim();
    if (!current) {
      return null;
    }
    const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ClipForge' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      return null;
    }
    const release = (await response.json()) as { tag_name?: string };
    const latest = (release.tag_name ?? '').replace(/^v/i, '').trim();
    if (!latest) {
      return null;
    }
    return { current, latest, updateAvailable: latest !== current };
  } catch {
    // Offline or rate-limited; the check is best-effort and silent.
    return null;
  }
}

// Updates must match how the tool was installed: Homebrew installs reject both
// `yt-dlp -U` and pip, and this machine has no global `python`. Resolve the
// binary's real path to pick the right package manager instead of assuming pip.
export async function updateDownloadTool(tool: DownloadTool): Promise<string> {
  if (!['yt-dlp', 'gallery-dl', 'instaloader'].includes(tool)) {
    throw new Error('Unsupported tool update request.');
  }

  // Packaged builds own a managed yt-dlp copy with no Homebrew/pip behind it —
  // update it by re-downloading the latest release.
  if (tool === 'yt-dlp' && isManaged('yt-dlp')) {
    return updateManagedYtDlp();
  }

  const binaryPath = await resolveBinaryRealPath(tool);
  if (binaryPath && (binaryPath.includes('/Cellar/') || binaryPath.includes('/homebrew/'))) {
    const output = await runCapture('brew', ['upgrade', tool], 300_000);
    return output.trim() || `${tool} updated via Homebrew.`;
  }

  if (tool === 'yt-dlp') {
    // Standalone-release binaries self-update; pip installs fall through below.
    try {
      const output = await runCapture('yt-dlp', ['-U'], 120_000);
      if (!/pip|package manager/i.test(output)) {
        return output.trim() || 'yt-dlp updated.';
      }
    } catch {
      // Fall through to pip.
    }
  }

  let lastError: Error | null = null;
  for (const python of ['python3', 'python']) {
    try {
      const output = await runCapture(python, ['-m', 'pip', 'install', '-U', tool], 300_000);
      return output.trim() || `${tool} updated.`;
    } catch (caught) {
      lastError = caught instanceof Error ? caught : new Error(String(caught));
    }
  }
  throw lastError ?? new Error(`${tool} update failed.`);
}

async function resolveBinaryRealPath(tool: string): Promise<string | null> {
  try {
    const located = (await runCapture('/usr/bin/which', [tool], 10_000)).trim().split('\n')[0];
    if (!located) {
      return null;
    }
    return await realpath(located);
  } catch {
    return null;
  }
}

function runCapture(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`${command} timed out.`));
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
