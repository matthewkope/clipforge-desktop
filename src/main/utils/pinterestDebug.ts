import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

export async function logPinterestDebug(message: string, details?: unknown): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}${details === undefined ? '' : ` ${JSON.stringify(details)}`}\n`;
  await fs.mkdir(path.dirname(pinterestDebugPath()), { recursive: true });
  await fs.appendFile(pinterestDebugPath(), line, 'utf8');
}

export async function readPinterestDebugReport(): Promise<string> {
  try {
    return await fs.readFile(pinterestDebugPath(), 'utf8');
  } catch {
    return 'No Pinterest debug log has been written yet.';
  }
}

function pinterestDebugPath(): string {
  return path.join(app.getPath('logs'), 'pinterest-debug.log');
}
