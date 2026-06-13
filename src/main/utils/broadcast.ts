import { BrowserWindow } from 'electron';

// Sends an event to every open renderer window. Used by stores whose state
// changes outside a specific download's window context (history, watch sync).
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
