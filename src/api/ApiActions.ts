/**
 * Reusable API automation methods - the non-BDD equivalent of api.ts's step
 * bodies. Request bodies and expected-response shapes are passed as plain
 * JS objects directly (no Cucumber DataTable to convert).
 */
import { expect, type APIRequestContext } from '@playwright/test';
import type { CapturedApi } from './capture';
import { findCapturedApi, normalizeUrl, waitForCapturedApi } from './matcher';
import { extractTokenFromJson, buildAuthorizationHeader } from './token';
import { resolveApiUrl } from './api-config';

type PendingApiRequest = {
  method: string;
  url: string;
  normalizedUrl: string;
  body?: unknown;
};

type ApiLastResponse = {
  status: number;
  body: unknown;
};

type SyntheticApiResponse = {
  status: () => number;
  json: () => Promise<unknown>;
};

function createSyntheticResponse(captured: CapturedApi): SyntheticApiResponse {
  const status = Number(captured.status);
  return {
    status: () => status,
    json: async () => captured.responseBody,
  };
}

async function parseResponseBodyFromJsonOrText(resp: { json: () => Promise<unknown>; text: () => Promise<string> }): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    try {
      return await resp.text();
    } catch {
      return undefined;
    }
  }
}

async function assertJsonIncludesPaths(actual: unknown, expected: unknown): Promise<void> {
  if (expected === undefined) return;

  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

  if (expected === null || typeof expected !== 'object') {
    expect(actual ?? undefined).toEqual(expected);
    return;
  }

  if (Array.isArray(expected)) {
    const a = Array.isArray(actual) ? actual : [];
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] === undefined) continue;
      await assertJsonIncludesPaths((a as unknown[])[i], expected[i]);
    }
    return;
  }

  if (isRecord(expected)) {
    const a = isRecord(actual) ? actual : {};
    for (const [k, v] of Object.entries(expected)) {
      if (!(k in a)) throw new Error(`Missing field in response at path "${k}"`);
      await assertJsonIncludesPaths(a[k], v);
    }
    return;
  }
}

export class ApiActions {
  capturedApis: CapturedApi[] = [];
  private readonly consumedCapturedApiIndices = new Set<number>();
  private authToken?: string;
  private pendingRequest?: PendingApiRequest;
  private lastResponse?: ApiLastResponse;

  constructor(private readonly apiRequestContext: APIRequestContext) {}

  /** Registers a request to be executed/matched on the next expectStatus() call. */
  sendRequest(method: string, url: string, body?: unknown): void {
    const resolvedUrl = resolveApiUrl(url);
    this.pendingRequest = {
      method: String(method || '').toUpperCase(),
      url: resolvedUrl,
      normalizedUrl: normalizeUrl(resolvedUrl),
      body,
    };
  }

  /**
   * Executes the pending request (or replays a matching one captured from a
   * live UI session, if any) and asserts the response status code.
   */
  async expectStatus(expectedStatusCode: number): Promise<void> {
    const pending = this.pendingRequest;
    if (!pending) throw new Error('No pending API request. Call sendRequest(...) first.');

    const normalizedUrl = pending.normalizedUrl;
    const method = pending.method;

    const replay = findCapturedApi({
      capturedApis: this.capturedApis,
      consumedCapturedApiIndices: this.consumedCapturedApiIndices,
      method,
      normalizedUrl,
    });

    const doReplay = async (): Promise<boolean> => {
      const found =
        replay ??
        (await waitForCapturedApi({
          capturedApis: this.capturedApis,
          consumedCapturedApiIndices: this.consumedCapturedApiIndices,
          method,
          normalizedUrl,
          timeoutMs: this.capturedApis.length ? 10000 : 0,
          pollIntervalMs: 150,
        }));

      if (!found) return false;

      console.log(`[api] Using captured API: ${method} ${normalizedUrl}`);
      this.consumedCapturedApiIndices.add(found.index);
      const synthetic = createSyntheticResponse(found.api);
      const responseBody = await synthetic.json();
      const token = extractTokenFromJson(responseBody);
      if (token) this.authToken = token;
      this.lastResponse = { status: synthetic.status(), body: responseBody };
      return true;
    };

    if (replay) {
      const used = await doReplay();
      if (used) {
        expect(this.lastResponse?.status).toBe(expectedStatusCode);
        this.pendingRequest = undefined;
        return;
      }
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    Object.assign(headers, buildAuthorizationHeader(this.authToken));

    const data = pending.body !== undefined ? JSON.stringify(pending.body) : undefined;
    const response = await this.apiRequestContext.fetch(pending.url, {
      method: pending.method,
      headers,
      data,
    });

    const status = response.status();
    const body = await parseResponseBodyFromJsonOrText(response);
    const token = extractTokenFromJson(body);
    if (token) this.authToken = token;

    this.lastResponse = { status, body };
    this.pendingRequest = undefined;

    expect(status).toBe(expectedStatusCode);
  }

  /** Asserts the last response body contains (at minimum) the given fields, at any depth. */
  async validateResponseFields(expected: unknown): Promise<void> {
    const last = this.lastResponse;
    if (!last) throw new Error('No last API response found. Call expectStatus(...) first.');
    await assertJsonIncludesPaths(last.body, expected);
  }

  /** The full body of the last response, for assertions beyond validateResponseFields(). */
  get lastResponseBody(): unknown {
    return this.lastResponse?.body;
  }
}
