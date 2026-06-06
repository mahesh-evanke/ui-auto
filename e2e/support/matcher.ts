/**
 * URL normalization and captured-API matching.
 */

import type { CapturedApi } from './capture';

function stripTrailingSlash(p: string): string {
  if (p.length <= 1) return p;
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

/**
 * Normalize URL by removing host/scheme.
 * Example:
 *   https://api.example.com/auth/login?x=1 -> /auth/login?x=1
 */
export function normalizeUrl(inputUrl: string): string {
  const raw = String(inputUrl || '').trim();
  if (!raw) return '';

  try {
    const u = new URL(raw);
    const pathname = stripTrailingSlash(u.pathname || '/');
    return `${pathname}${u.search || ''}`;
  } catch {
    // Best-effort for non-absolute URLs.
    // Requirement: ONLY normalize for matching; never modify actual request URL.
    const withoutSchemeHost = raw.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/[^/]+/i, '');
    const qIndex = withoutSchemeHost.indexOf('?');
    const base = qIndex >= 0 ? withoutSchemeHost.slice(0, qIndex) : withoutSchemeHost;
    const query = qIndex >= 0 ? withoutSchemeHost.slice(qIndex) : '';
    const normalizedBase = base.startsWith('/') ? stripTrailingSlash(base) : stripTrailingSlash('/' + base);
    return `${normalizedBase}${query}`;
  }
}

export function urlToHostPlaceholder(normalizedUrl: string): string {
  const n = String(normalizedUrl || '').trim();
  if (!n) return 'http://host/';
  const path = n.startsWith('/') ? n : `/${n}`;
  return `http://host${path}`;
}

export function findCapturedApi(args: {
  capturedApis: CapturedApi[];
  consumedCapturedApiIndices: Set<number>;
  method: string;
  normalizedUrl: string;
}): { index: number; api: CapturedApi } | undefined {
  const method = String(args.method || '').trim().toUpperCase();
  const url = String(args.normalizedUrl || '');
  if (!method || !url) return undefined;

  for (let i = 0; i < args.capturedApis.length; i++) {
    if (args.consumedCapturedApiIndices.has(i)) continue;
    const c = args.capturedApis[i];
    if (!c) continue;
    if (String(c.method || '').trim().toUpperCase() !== method) continue;
    if (String(c.url || '') !== url) continue;
    return { index: i, api: c };
  }
  return undefined;
}

export async function waitForCapturedApi(args: {
  capturedApis: CapturedApi[];
  consumedCapturedApiIndices: Set<number>;
  method: string;
  normalizedUrl: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ index: number; api: CapturedApi } | undefined> {
  const timeoutMs = args.timeoutMs ?? 10000;
  const pollIntervalMs = args.pollIntervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = findCapturedApi({
      capturedApis: args.capturedApis,
      consumedCapturedApiIndices: args.consumedCapturedApiIndices,
      method: args.method,
      normalizedUrl: args.normalizedUrl,
    });
    if (found) return found;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return undefined;
}

