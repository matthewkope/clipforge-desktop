import { spawn } from 'node:child_process';
import type { DependencyStatus } from '../shared/media.js';

const checks = [
  { name: 'yt-dlp' as const, args: ['--version'] },
  { name: 'ffmpeg' as const, args: ['-version'] },
  { name: 'ffprobe' as const, args: ['-version'] },
  { name: 'instaloader' as const, args: ['--version'], optional: true }
];

function runVersion(command: string, args: string[], optional = false): Promise<DependencyStatus> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false });
    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        name: command as DependencyStatus['name'],
        available: false,
        optional,
        message: friendlyMissingMessage(command, error.message)
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          name: command as DependencyStatus['name'],
          available: true,
          optional,
          version: firstLine(output || errorOutput)
        });
        return;
      }

      resolve({
        name: command as DependencyStatus['name'],
        available: false,
        optional,
        message: friendlyMissingMessage(command, errorOutput || `Exited with code ${code}`)
      });
    });
  });
}

export async function checkDependencies(): Promise<DependencyStatus[]> {
  const [base, galleryDl] = await Promise.all([
    Promise.all(checks.map((check) => runVersion(check.name, check.args, check.optional))),
    checkGalleryDl()
  ]);
  return [base[0], galleryDl, ...base.slice(1)];
}

async function checkGalleryDl(): Promise<DependencyStatus> {
  // Probe the executable and the python module in parallel; prefer the executable.
  const pythonModulePromise = runVersion('python', ['-m', 'gallery_dl', '--version']);
  const executable = await runVersion('gallery-dl', ['--version']);
  if (executable.available) {
    return executable;
  }

  const pythonModule = await pythonModulePromise;
  if (pythonModule.available) {
    return {
      name: 'gallery-dl',
      available: true,
      version: `python -m gallery_dl ${pythonModule.version ?? ''}`.trim()
    };
  }

  return {
    name: 'gallery-dl',
    available: false,
    message: friendlyMissingMessage('gallery-dl', pythonModule.message || executable.message || 'Not found.')
  };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find(Boolean)?.trim() ?? '';
}

function friendlyMissingMessage(command: string, detail: string): string {
  if (command === 'yt-dlp') {
    return `yt-dlp is required to analyze and download media. Install it with Homebrew, pipx, or bundle it with the app. ${detail}`;
  }
  if (command === 'gallery-dl') {
    return `gallery-dl is required for Instagram, Facebook, and Pinterest photos, albums, boards, and carousels. Install it with python -m pip install gallery-dl. ${detail}`;
  }
  if (command === 'instaloader') {
    return `instaloader is optional and only used as a future Instagram fallback. Install it with python -m pip install instaloader if needed. ${detail}`;
  }

  return `${command} is required for merging video/audio and audio conversion. Install ffmpeg, or bundle ffmpeg and ffprobe with the app. ${detail}`;
}
