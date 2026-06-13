import { app } from 'electron';
import fsSync from 'node:fs';
import path from 'node:path';

// Central resolver for the external command-line tools the app shells out to.
//
// Resolution order for each tool:
//   1. An explicit env override (e.g. YT_DLP_PATH) — power users / CI.
//   2. A "managed" copy the app downloaded into userData/bin (writable, so it
//      can be auto-updated — this is how yt-dlp stays current).
//   3. A copy bundled inside the packaged app (extraResources → resources/bin).
//   4. The bare tool name, i.e. whatever is on PATH (Homebrew, pip, etc.).
//
// Step 4 means a developer with Homebrew tools sees no behaviour change, while a
// downloaded/packaged build uses the bundled or auto-updated binaries instead.

export type ManagedTool = 'yt-dlp' | 'gallery-dl' | 'ffmpeg' | 'ffprobe' | 'instaloader';

const isWindows = process.platform === 'win32';

export function managedBinDir(): string {
  return path.join(app.getPath('userData'), 'bin');
}

export function bundledBinDir(): string {
  // process.resourcesPath is the app's resources dir in a packaged build; in dev
  // it points at Electron's own resources (where resources/bin won't exist), so
  // this branch simply doesn't match and we fall through to PATH.
  return path.join(process.resourcesPath ?? '', 'bin');
}

export function managedBinaryName(tool: ManagedTool): string {
  return isWindows ? `${tool}.exe` : tool;
}

function envOverride(tool: ManagedTool): string | undefined {
  const key = `${tool.toUpperCase().replace(/-/g, '_')}_PATH`;
  const value = process.env[key];
  return value && fsSync.existsSync(value) ? value : undefined;
}

export function managedBinaryPath(tool: ManagedTool): string {
  return path.join(managedBinDir(), managedBinaryName(tool));
}

export function bundledBinaryPath(tool: ManagedTool): string {
  return path.join(bundledBinDir(), managedBinaryName(tool));
}

// Resolve the path/command to spawn for a tool. Never throws — worst case it
// returns the bare tool name so the OS resolves it on PATH (or fails the spawn
// with a clear ENOENT the existing error handling already classifies).
export function resolveToolPath(tool: ManagedTool): string {
  return (
    envOverride(tool) ??
    existing(managedBinaryPath(tool)) ??
    existing(bundledBinaryPath(tool)) ??
    tool
  );
}

function existing(candidate: string): string | undefined {
  try {
    return fsSync.existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

// True when the app owns a writable managed copy of the tool (vs. relying on a
// PATH/Homebrew install). Auto-update only ever touches managed copies.
export function isManaged(tool: ManagedTool): boolean {
  return Boolean(existing(managedBinaryPath(tool)));
}
