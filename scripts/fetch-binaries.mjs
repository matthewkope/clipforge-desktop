// Build-time helper: assembles the external binaries bundled with the packaged
// app into resources/bin, so a downloaded ClipForge works without the user
// installing anything. Run automatically before `npm run pack` / `npm run dist`.
//
// Bundles yt-dlp (downloaded from its GitHub release for the host platform) plus
// ffmpeg and ffprobe (sourced from the ffmpeg-static / ffprobe-static dev
// dependencies). gallery-dl is intentionally NOT bundled — its latest release
// ships no standalone binary; it stays an optional pip/Homebrew install used
// only for photo galleries.
//
// NOTE: this fetches binaries for the CURRENT platform only. To build installers
// for another OS, run this on that OS (or extend it to fetch per-target assets).

import { createRequire } from 'node:module';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const binDir = path.join(projectRoot, 'resources', 'bin');

const isWindows = process.platform === 'win32';
const exe = (name) => (isWindows ? `${name}.exe` : name);

const ytDlpAsset = isWindows ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
const ytDlpUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAsset}`;

async function main() {
  await rm(binDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });

  await downloadTo(ytDlpUrl, path.join(binDir, exe('yt-dlp')));
  await copyStatic('ffmpeg-static', path.join(binDir, exe('ffmpeg')));
  await copyStatic('ffprobe-static', path.join(binDir, exe('ffprobe')));

  await writeFile(
    path.join(binDir, 'README.txt'),
    'Bundled by scripts/fetch-binaries.mjs. yt-dlp from its GitHub release; ffmpeg/ffprobe from ffmpeg-static/ffprobe-static. Regenerated on each package build.\n'
  );

  console.log(`Bundled binaries into ${binDir}`);
}

async function downloadTo(url, dest) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, buffer);
  await chmod(dest, 0o755);
  console.log(`  -> ${dest} (${(buffer.length / 1_000_000).toFixed(1)} MB)`);
}

async function copyStatic(pkg, dest) {
  const resolved = require(pkg);
  const source = typeof resolved === 'string' ? resolved : resolved?.path;
  if (!source || !existsSync(source)) {
    throw new Error(`${pkg} did not provide a binary path (install it as a devDependency).`);
  }
  await copyFile(source, dest);
  await chmod(dest, 0o755);
  console.log(`  ${pkg} -> ${dest}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
