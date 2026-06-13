#!/usr/bin/env node
// ClipForge native messaging host.
// The browser spawns this on demand, sends one framed JSON message on stdin,
// and reads one framed JSON reply on stdout (Chrome native-messaging format:
// 4-byte little-endian length + UTF-8 JSON). This process is a thin relay: it
// forwards the message to the running desktop app over its Unix-domain socket
// and pipes the reply back. No network is involved.

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const MAX_FRAME = 1_000_000;
const RESPONSE_TIMEOUT_MS = 300_000;

// Must match extensionSocketPath() in src/main/extensionBridge.ts. The launcher
// installed by scripts/install-native-host.mjs also sets CLIPFORGE_SOCKET.
const SOCKET_PATH =
  process.env.CLIPFORGE_SOCKET ||
  path.join(os.homedir(), 'Library', 'Application Support', 'clipforge-desktop', 'clipforge.sock');

function readNativeMessage() {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let expected = null;
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (expected === null) {
        if (buffer.length < 4) {
          return;
        }
        expected = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
        if (expected > MAX_FRAME) {
          cleanup();
          reject(new Error('Message too large.'));
          return;
        }
      }
      if (buffer.length >= expected) {
        const frame = buffer.subarray(0, expected);
        cleanup();
        try {
          resolve(JSON.parse(frame.toString('utf8')));
        } catch (error) {
          reject(error);
        }
      }
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('stdin closed before a full message arrived.'));
    };
    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
    };
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
  });
}

function writeNativeMessage(value) {
  return new Promise((resolve) => {
    const json = Buffer.from(JSON.stringify(value), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(json.length, 0);
    process.stdout.write(Buffer.concat([header, json]), resolve);
  });
}

// Forwards the message to the desktop app and returns its `{ ok, body }` reply.
// Any connection problem (app not running, socket missing) resolves to a
// friendly "open the app" error rather than rejecting.
function relayToApp(message) {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    let expected = null;
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(
      () => finish({ ok: false, body: { error: 'ClipForge did not respond in time.' } }),
      RESPONSE_TIMEOUT_MS
    );

    const socket = net.connect(SOCKET_PATH);
    socket.on('connect', () => {
      const json = Buffer.from(JSON.stringify(message), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32LE(json.length, 0);
      socket.write(Buffer.concat([header, json]));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (expected === null) {
        if (buffer.length < 4) {
          return;
        }
        expected = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
      }
      if (buffer.length >= expected) {
        try {
          finish(JSON.parse(buffer.subarray(0, expected).toString('utf8')));
        } catch {
          finish({ ok: false, body: { error: 'ClipForge sent an invalid response.' } });
        }
      }
    });
    socket.on('error', () => finish({ ok: false, body: { error: 'Open the ClipForge desktop app first.' } }));
  });
}

async function main() {
  let message;
  try {
    message = await readNativeMessage();
  } catch {
    await writeNativeMessage({ ok: false, body: { error: 'ClipForge host could not read the request.' } });
    process.exit(0);
  }
  const response = await relayToApp(message);
  await writeNativeMessage(response);
  process.exit(0);
}

void main();
