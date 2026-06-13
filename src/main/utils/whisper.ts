import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { delimiter } from 'node:path';
import { classifyYtDlpError } from '../ytdlp.js';

// whisper.cpp binary/model resolution plus a generic "audio in, SRT out" run
// helper. Shared by the download manager's transcript outputs and the
// caption/transcript whisper fallbacks (clip caption burning, extension
// transcript endpoint).

export interface WhisperRunOptions {
  audioPath: string;
  modelPath?: string;
  onChild?: (child: ChildProcess) => void;
  onProgressLine?: (line: string) => void;
  isCancelled?: () => boolean;
}

// Transcribes a WAV file with whisper.cpp and returns the path of the SRT it
// wrote next to the audio file.
export async function runWhisperCpp(options: WhisperRunOptions): Promise<string> {
  const modelPath = options.modelPath || (await resolveWhisperCppModel());
  const binary = await resolveWhisperCppBinary();
  const outputDirectory = path.dirname(options.audioPath);
  const outputBase = path.join(outputDirectory, path.basename(options.audioPath).replace(/\.[^.]+$/u, ''));
  const child = spawn(binary, ['-m', modelPath, '-f', options.audioPath, '-osrt', '-of', outputBase], {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  options.onChild?.(child);
  let combinedOutput = '';

  const handleOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    combinedOutput += text;
    if (options.onProgressLine) {
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        options.onProgressLine(line.trim());
      }
    }
  };

  child.stdout?.on('data', handleOutput);
  child.stderr?.on('data', handleOutput);

  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      reject(new Error(classifyYtDlpError(error.message)));
    });

    child.on('close', (code, signal) => {
      if (options.isCancelled?.() || signal || code === null) {
        reject(new Error('Download cancelled.'));
        return;
      }

      if (code !== 0) {
        reject(new Error(classifyYtDlpError(combinedOutput || 'whisper.cpp command not found')));
        return;
      }

      resolve(`${outputBase}.srt`);
    });
  });
}

export async function resolveWhisperCppBinary(): Promise<string> {
  const configured = process.env.WHISPER_CPP_BIN;
  if (configured && (await fileExists(configured))) {
    return configured;
  }

  const candidates = ['whisper-cli', 'main'];
  const pathDirectories = [
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/homebrew/opt/whisper-cpp/bin',
    '/usr/local/opt/whisper-cpp/bin',
    ...(await homebrewWhisperCppBinDirectories())
  ];
  for (const candidate of candidates) {
    for (const directory of pathDirectories) {
      const fullPath = path.join(directory, candidate);
      if (await fileExists(fullPath)) {
        return fullPath;
      }
    }
  }

  throw new Error('whisper.cpp was not found. Install whisper.cpp and make whisper-cli available on PATH, or set WHISPER_CPP_BIN.');
}

export async function resolveWhisperCppModel(): Promise<string> {
  const configured = process.env.WHISPER_CPP_MODEL;
  if (configured && (await fileExists(configured))) {
    return configured;
  }

  const candidates = [
    '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
    '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
    '/usr/local/share/whisper-cpp/models/ggml-base.en.bin',
    '/usr/local/share/whisper-cpp/models/ggml-base.bin',
    path.join(process.env.HOME ?? '', 'models/ggml-base.en.bin'),
    path.join(process.env.HOME ?? '', 'models/ggml-base.bin'),
    path.join(process.env.HOME ?? '', 'Downloads/ggml-base.en.bin'),
    path.join(process.env.HOME ?? '', 'Downloads/ggml-base.bin')
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error('Choose a whisper.cpp model file before generating a transcript without source captions.');
}

async function homebrewWhisperCppBinDirectories(): Promise<string[]> {
  const roots = ['/opt/homebrew/Cellar/whisper-cpp', '/usr/local/Cellar/whisper-cpp'];
  const directories: string[] = [];
  for (const root of roots) {
    try {
      const versions = await fs.readdir(root);
      directories.push(...versions.map((version) => path.join(root, version, 'bin')));
    } catch {
      // Homebrew may not be installed in this prefix.
    }
  }
  return directories;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
