import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BRAVE_SAFE_STORAGE_SERVICES = ['Brave Safe Storage', 'Brave Browser Safe Storage', 'Chromium Safe Storage'];

const BRAVE_COOKIES_CANDIDATES = [
  path.join('BraveSoftware', 'Brave-Browser', 'Default', 'Cookies'),
  path.join('BraveSoftware', 'Brave-Browser', 'Profile 1', 'Cookies'),
  path.join('BraveSoftware', 'Brave-Browser', 'Profile 2', 'Cookies'),
  path.join('BraveSoftware', 'Brave-Browser', 'Profile 3', 'Cookies'),
];

let cachedCookieFilePath: string | undefined;

export async function getOrExtractBraveCookiesPath(domain: string): Promise<string | undefined> {
  if (cachedCookieFilePath && fsSync.existsSync(cachedCookieFilePath)) {
    return cachedCookieFilePath;
  }
  cachedCookieFilePath = undefined;
  const result = await extractBraveCookiesToFile(domain);
  if (result) {
    cachedCookieFilePath = result;
  }
  return result;
}

export async function clearExtractedCookiesCache(): Promise<void> {
  const p = cachedCookieFilePath;
  cachedCookieFilePath = undefined;
  if (p) {
    await fs.rm(p, { force: true }).catch(() => {});
  }
}

async function extractBraveCookiesToFile(domain: string): Promise<string | undefined> {
  try {
    const password = getBraveSafeStoragePassword();
    if (!password) {
      return undefined;
    }

    const aesKey = deriveBraveAesKey(password);
    const sourcePath = findBraveCookiesDb();
    if (!sourcePath) {
      return undefined;
    }

    const tempDb = path.join(os.tmpdir(), `clipforge-cookies-${Date.now()}.db`);
    try {
      await fs.copyFile(sourcePath, tempDb);
      const rows = queryCookiesDb(tempDb, domain);
      if (!rows.length) {
        return undefined;
      }

      const lines = rows
        .map((row) => decryptAndFormatRow(row, aesKey))
        .filter((line): line is string => line !== null);

      if (!lines.length) {
        return undefined;
      }

      const cookiesFile = path.join(os.tmpdir(), `clipforge-pinterest-cookies-${Date.now()}.txt`);
      const content = '# Netscape HTTP Cookie File\n' + lines.join('\n') + '\n';
      // 0600: the file holds decrypted session cookies — keep it readable only by the current user.
      await fs.writeFile(cookiesFile, content, { encoding: 'utf8', mode: 0o600 });
      return cookiesFile;
    } finally {
      await fs.rm(tempDb, { force: true }).catch(() => {});
    }
  } catch {
    return undefined;
  }
}

function getBraveSafeStoragePassword(): string | undefined {
  for (const service of BRAVE_SAFE_STORAGE_SERVICES) {
    const result = spawnSync('security', ['find-generic-password', '-w', '-s', service], {
      shell: false,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status === 0) {
      const pw = result.stdout.trim();
      if (pw) {
        return pw;
      }
    }
  }
  return undefined;
}

function deriveBraveAesKey(password: string): Buffer {
  return crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from('saltysalt', 'utf8'), 1003, 16, 'sha1');
}

function findBraveCookiesDb(): string | undefined {
  const libApp = path.join(os.homedir(), 'Library', 'Application Support');
  for (const candidate of BRAVE_COOKIES_CANDIDATES) {
    const full = path.join(libApp, candidate);
    if (fsSync.existsSync(full)) {
      return full;
    }
  }
  return undefined;
}

interface CookieRow {
  host_key: string;
  name: string;
  path: string;
  expires_utc: string;
  is_secure: string;
  is_httponly: string;
  encrypted_value_hex: string;
}

function queryCookiesDb(dbPath: string, domain: string): CookieRow[] {
  const cleanDomain = domain.replace(/^\.+/, '');
  // Defense in depth: the domain is interpolated into SQL below, so reject anything
  // that is not a plain hostname (letters, digits, dots, hyphens). Prevents SQL
  // injection if a caller ever passes an untrusted domain.
  if (!/^[a-z0-9.-]+$/i.test(cleanDomain)) {
    return [];
  }
  // Use hex() so the blob is safe as text; avoid binary in stdout
  const query = `SELECT host_key, name, path, expires_utc, is_secure, is_httponly, hex(encrypted_value) FROM cookies WHERE host_key LIKE '%.${cleanDomain}' OR host_key = '${cleanDomain}'`;

  // Try JSON mode first (sqlite3 3.33+, available on macOS 12+)
  const jsonResult = spawnSync('/usr/bin/sqlite3', ['-json', dbPath, query], {
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (jsonResult.status === 0 && jsonResult.stdout.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(jsonResult.stdout.trim()) as Array<Record<string, string>>;
      return parsed.map((row) => ({
        host_key: row['host_key'] ?? '',
        name: row['name'] ?? '',
        path: row['path'] ?? '/',
        expires_utc: row['expires_utc'] ?? '0',
        is_secure: row['is_secure'] ?? '0',
        is_httponly: row['is_httponly'] ?? '0',
        encrypted_value_hex: row['hex(encrypted_value)'] ?? ''
      }));
    } catch {
      // fall through to pipe-separated fallback
    }
  }

  // Fallback: pipe-separated — safe for host_key/name/path which won't contain |
  const pipeResult = spawnSync('/usr/bin/sqlite3', ['-separator', '|', dbPath, query], {
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (pipeResult.status !== 0 || !pipeResult.stdout.trim()) {
    return [];
  }

  return pipeResult.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|');
      return {
        host_key: parts[0] ?? '',
        name: parts[1] ?? '',
        path: parts[2] ?? '/',
        expires_utc: parts[3] ?? '0',
        is_secure: parts[4] ?? '0',
        is_httponly: parts[5] ?? '0',
        encrypted_value_hex: parts[6] ?? ''
      };
    });
}

function decryptAndFormatRow(row: CookieRow, aesKey: Buffer): string | null {
  if (!row.name || !row.host_key || !row.encrypted_value_hex) {
    return null;
  }

  const encrypted = Buffer.from(row.encrypted_value_hex, 'hex');
  if (encrypted.length <= 3) {
    return null;
  }

  const version = encrypted.slice(0, 3).toString('utf8');
  if (version !== 'v10' && version !== 'v11') {
    return null;
  }

  const value = decryptAesCbc(aesKey, encrypted.slice(3));
  // U+FFFD replacement chars indicate the AES decryption produced non-UTF-8 bytes (wrong key or corrupt data).
  // Cookie values with replacement chars would cause UnicodeEncodeError in gallery-dl's latin-1 stdout.
  if (value === null || value.includes('�')) {
    return null;
  }

  // Chrome stores expiry as microseconds since Windows epoch (Jan 1 1601)
  const chromeMicros = Number(row.expires_utc);
  const unixSeconds = chromeMicros > 0 ? Math.floor(chromeMicros / 1_000_000) - 11_644_473_600 : 0;

  const domain = row.host_key;
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const secure = row.is_secure === '1' ? 'TRUE' : 'FALSE';

  // Netscape/curl cookies.txt: domain  flag  path  secure  expiry  name  value
  return `${domain}\t${includeSubdomains}\t${row.path}\t${secure}\t${unixSeconds}\t${row.name}\t${value}`;
}

function decryptAesCbc(key: Buffer, ciphertext: Buffer): string | null {
  try {
    const iv = Buffer.alloc(16, 0x20); // 16 ASCII space chars — Chrome/Brave's fixed IV
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}
