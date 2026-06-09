export type PinterestUrlType = 'pin' | 'board' | 'section' | 'profile' | 'unknown';

export interface PinterestTarget {
  normalizedUrl: string;
  type: PinterestUrlType;
  owner?: string;
  boardSlug?: string;
  sectionSlug?: string;
  pinId?: string;
}

export function normalizePinterestUrl(input: string): PinterestTarget {
  const parsed = new URL(input);
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, '');
  const canonicalHost = hostname === 'pin.it' ? 'pin.it' : 'www.pinterest.com';
  const parts = parsed.pathname
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  let type: PinterestUrlType = 'unknown';
  let owner: string | undefined;
  let boardSlug: string | undefined;
  let sectionSlug: string | undefined;
  let pinId: string | undefined;
  let pathname = '/';

  if (hostname === 'pin.it') {
    type = 'unknown';
    pathname = `/${parts.join('/')}`;
  } else if (parts[0] === 'pin' && parts[1]) {
    type = 'pin';
    pinId = parts[1];
    pathname = `/pin/${pinId}/`;
  } else if (parts.length >= 3) {
    type = 'section';
    owner = parts[0];
    boardSlug = parts[1];
    sectionSlug = parts[2];
    pathname = `/${owner}/${boardSlug}/${sectionSlug}/`;
  } else if (parts.length >= 2) {
    type = 'board';
    owner = parts[0];
    boardSlug = parts[1];
    pathname = `/${owner}/${boardSlug}/`;
  } else if (parts.length === 1) {
    type = 'profile';
    owner = parts[0];
    pathname = `/${owner}/`;
  }

  return {
    normalizedUrl: `https://${canonicalHost}${pathname}`,
    type,
    owner,
    boardSlug,
    sectionSlug,
    pinId
  };
}

export function normalizeMediaUrl(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value.split('?')[0]?.split('#')[0];
  }
}

export function slugifyPinterestValue(value?: string): string | undefined {
  return value
    ?.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function extractPinterestPinId(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const pinMatch = value.match(/\/pin\/(\d+)/iu);
  if (pinMatch?.[1]) {
    return pinMatch[1];
  }

  const numeric = value.match(/\b(\d{8,})\b/u);
  return numeric?.[1];
}
