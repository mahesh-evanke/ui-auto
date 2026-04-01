/**
 * Playwright network capture for request/response replay.
 */
import type { Page, Request, Response } from 'playwright';
import { normalizeUrl } from './matcher';

export type CapturedApi = {
  method: string;
  /** Full URL captured from Playwright (includes scheme + host). */
  fullUrl: string;
  /** Normalized URL (host removed). */
  url: string;
  /** Request headers (redacted). */
  headers: Record<string, string>;
  requestBody: unknown;
  /** Parsed response JSON or string. */
  responseBody: unknown;
  status: number;
  timestamp: number;
};

export type ApiCaptureOptions = {
  /** Maximum response body size to store (chars). */
  maxBodyChars?: number;
  /** Timeout for parsing response bodies (ms). */
  bodyParseTimeoutMs?: number;
  /** Max number of merged APIs to keep. */
  maxCaptures?: number;
  /** Callback invoked after a merged request+response is captured. */
  onCaptured?: (api: CapturedApi) => void;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function redactHeaderValue(key: string, value: string): string {
  const k = key.toLowerCase();
  if (k === 'authorization') return '[REDACTED_AUTHORIZATION]';
  if (k === 'cookie' || k === 'set-cookie') return '[REDACTED_COOKIE]';
  return value;
}

function redactHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k] = redactHeaderValue(k, String(v));
  }
  return out;
}

function tryParseJson(raw: string): unknown | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (!(t.startsWith('{') || t.startsWith('[') || t === 'null' || t === 'true' || t === 'false' || /^[0-9\-]/.test(t))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function contentTypeLooksJson(contentType?: string): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes('application/json') || contentType.toLowerCase().includes('+json');
}

async function withTimeout<T>(p: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const wrapped = new Promise<T>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('parse timeout')), timeoutMs);
    p.then(resolve).catch(reject);
  });
  try {
    return await wrapped;
  } catch {
    return onTimeout();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function makeRequestKey(req: Request): string {
  const method = String(req.method() || '').toUpperCase();
  const normalizedUrl = normalizeUrl(req.url());
  const headers = req.headers();
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  const postData = req.postData();
  const postLen = postData ? String(postData).length : 0;
  const ct = contentType ? String(contentType) : '';
  // Key is not perfect under concurrency; we still use closest timestamp in matching.
  return `${method}|${normalizedUrl}|${ct}|${postLen}`;
}

export function attachApiCapture(page: Page, targetCapturedApis: CapturedApi[], options?: ApiCaptureOptions): { stop: () => void } {
  const maxBodyChars = options?.maxBodyChars ?? 120000;
  const bodyParseTimeoutMs = options?.bodyParseTimeoutMs ?? 5000;
  const maxCaptures = options?.maxCaptures ?? 2000;
  const onCaptured = options?.onCaptured;

  // Store partial request info so we can merge at response time.
  const inflightByKey = new Map<string, Array<{ timestamp: number; request: Request; headers: Record<string, string>; requestBody: unknown }>>();

  const onRequest = (req: Request) => {
    if (targetCapturedApis.length >= maxCaptures) return;
    const key = makeRequestKey(req);
    const headers = redactHeaders(req.headers() as Record<string, string | undefined>);
    const postData = req.postData();
    const contentType = (req.headers()['content-type'] as string | undefined) ?? undefined;
    let parsed: unknown | undefined;
    if (postData) {
      parsed = contentTypeLooksJson(contentType) ? tryParseJson(postData) : tryParseJson(postData);
    }
    const requestBody = parsed !== undefined ? parsed : postData ?? undefined;

    const entry = { timestamp: Date.now(), request: req, headers, requestBody };
    const list = inflightByKey.get(key) ?? [];
    list.push(entry);
    inflightByKey.set(key, list);
  };

  const onResponse = async (resp: Response) => {
    if (targetCapturedApis.length >= maxCaptures) return;

    const status = resp.status();
    const req = resp.request();
    const method = String(req.method() || '').toUpperCase();
    const fullUrl = resp.url();
    const url = normalizeUrl(fullUrl);

    const key = makeRequestKey(req);
    const inflight = inflightByKey.get(key) ?? [];

    // Find the closest request entry by timestamp.
    let chosenIdx = -1;
    let chosen: (typeof inflight)[number] | undefined;
    const respTs = Date.now();
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < inflight.length; i++) {
      const d = Math.abs(inflight[i].timestamp - respTs);
      if (d < bestDelta) {
        bestDelta = d;
        chosenIdx = i;
        chosen = inflight[i];
      }
    }
    // Remove chosen from inflight to avoid memory growth.
    if (chosenIdx >= 0) inflight.splice(chosenIdx, 1);
    inflightByKey.set(key, inflight);

    const headers = chosen?.headers ?? redactHeaders(req.headers() as Record<string, string | undefined>);

    const requestBodyFromReq = (() => {
      if (chosen) return chosen.requestBody;
      const postData = req.postData();
      if (!postData) return undefined;
      const contentType = (req.headers()['content-type'] as string | undefined) ?? undefined;
      const parsed = tryParseJson(postData);
      if (contentTypeLooksJson(contentType)) return parsed !== undefined ? parsed : postData;
      return parsed !== undefined ? parsed : postData;
    })();

    const responseBody = await withTimeout(
      (async () => {
        const ct = resp.headers()['content-type'] as string | undefined;
        const looksJson = contentTypeLooksJson(ct);
        if (looksJson) {
          try {
            return await resp.json();
          } catch {
            // fallback to text below
          }
        }
        try {
          const text = await resp.text();
          if (text && text.length > maxBodyChars) return text.slice(0, maxBodyChars) + '...[TRUNCATED]';
          const maybe = tryParseJson(text);
          if (maybe !== undefined) return maybe;
          return text;
        } catch {
          return undefined;
        }
      })(),
      bodyParseTimeoutMs,
      () => undefined,
    );

    const merged: CapturedApi = {
      method,
      fullUrl,
      url,
      headers,
      requestBody: requestBodyFromReq,
      responseBody,
      status,
      timestamp: respTs,
    };
    targetCapturedApis.push(merged);
    try {
      onCaptured?.(merged);
    } catch {
      // ignore
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  const stop = () => {
    try {
      page.off('request', onRequest);
    } catch {
      // ignore
    }
    try {
      page.off('response', onResponse);
    } catch {
      // ignore
    }
  };

  return { stop };
}

