/**
 * Reusable API automation methods - the non-BDD equivalent of api.ts's step
 * bodies. Request bodies and expected-response shapes are passed as plain
 * JS objects directly (no Cucumber DataTable to convert).
 *
 * Fluent/chainable (see Chainable / WebActions): sendRequest/expectStatus/
 * validateResponseFields all queue and run in written order, so
 *
 *   await apiActions
 *     .sendRequest('POST', url, body)
 *     .expectStatus(201)
 *     .validateResponseFields({ title: 'foo' });
 *
 * is one statement instead of three. sendRequest must be queued (not
 * immediate) too - otherwise a second sendRequest() call chained before the
 * first expectStatus() has actually run would overwrite the pending request
 * out of order.
 */
import { expect, type APIRequestContext } from '@playwright/test';
import { Chainable } from '../core/Chainable';
import { ScenarioCache, getByPath } from '../cache/ScenarioCache';
import { logApiCall } from '../utils/logger';
import { autoMap, type AutoMapOptions } from '../utils/autoMap';
import { analyzeApiChain, type ApiChainReport } from './chainAnalyzer';
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

export class ApiActions extends Chainable<ApiActions> {
  capturedApis: CapturedApi[] = [];
  private readonly consumedCapturedApiIndices = new Set<number>();
  private authToken?: string;
  private pendingRequest?: PendingApiRequest;
  private lastRequest?: { method: string; url: string; body?: unknown };
  private lastResponse?: ApiLastResponse;

  constructor(
    private readonly apiRequestContext: APIRequestContext,
    readonly context: ScenarioCache = new ScenarioCache(),
  ) {
    super();
  }

  /** Cache key every response is auto-saved under: "<METHOD> <normalized-url>", e.g. "GET /posts/1". */
  private cacheKeyFor(method: string, normalizedUrl: string): string {
    return `${String(method || '').toUpperCase()} ${normalizedUrl}`;
  }

  /**
   * Reads a previously-received response body by method+URL - every response
   * is cached automatically as it's received, so this works without an
   * explicit saveResponseField()/saveResponseBody() call for that response.
   * Immediate (not queued): call after awaiting the request that produced it.
   */
  getCachedResponse<T = unknown>(method: string, url: string): T {
    const normalizedUrl = normalizeUrl(resolveApiUrl(url));
    return this.context.get<T>(this.cacheKeyFor(method, normalizedUrl));
  }

  /**
   * Registers a request to be executed/matched on the next expectStatus()
   * call. `url`/`body` can be a plain value, or a zero-arg function that's
   * only called when this queued action actually runs - so it can safely
   * reference a value saved earlier in the same chain (see saveResponseField()).
   */
  sendRequest(method: string, url: string | (() => string), body?: unknown | (() => unknown)): ApiActions {
    return this.enqueue(async () => {
      const resolvedRawUrl = typeof url === 'function' ? url() : url;
      const resolvedBody = typeof body === 'function' ? (body as () => unknown)() : body;
      const resolvedUrl = resolveApiUrl(resolvedRawUrl);
      this.pendingRequest = {
        method: String(method || '').toUpperCase(),
        url: resolvedUrl,
        normalizedUrl: normalizeUrl(resolvedUrl),
        body: resolvedBody,
      };
    });
  }

  /**
   * Builds a payload by auto-copying fields from `source` (defaults to the
   * last response body) wherever field NAMES match - every `'<AUTO>'` leaf in
   * `template` is filled from the source, so a chained call only spells out
   * the fields that don't carry over. Immediate (not queued) - use it to build
   * the body you pass to sendRequest(). See src/utils/autoMap.ts.
   */
  autoMapBody(template: unknown, source?: unknown, options?: AutoMapOptions): Record<string, unknown> {
    return autoMap(template, source ?? this.lastResponse?.body, options);
  }

  /**
   * sendRequest() whose body is auto-mapped from the last response: every
   * `'<AUTO>'` leaf in `template` is filled by matching field name against the
   * previous call's response (see autoMapBody). Queued, so the mapping runs
   * after the previous expectStatus() has produced that response.
   */
  sendRequestAutoMapped(method: string, url: string | (() => string), template: unknown, options?: AutoMapOptions): ApiActions {
    return this.sendRequest(method, url, () => this.autoMapBody(template, undefined, options));
  }

  /** Analyzes this test's captured API calls, surfacing which response field of one call feeds a request field of a later call. See chainAnalyzer. */
  analyzeChain(): ApiChainReport {
    return analyzeApiChain(this.capturedApis);
  }

  /** Saves a field from the last response body (dot-path, e.g. "user.token") under `key`, for reuse in a later step. */
  saveResponseField(path: string, key: string): ApiActions {
    return this.enqueue(async () => {
      if (!this.lastResponse) throw new Error('No last API response found. Call expectStatus(...) first.');
      const value = getByPath(this.lastResponse.body, path);
      this.context.set(key, value);
    });
  }

  /** Saves the entire last response body under `key`, for reuse in a later step. */
  saveResponseBody(key: string): ApiActions {
    return this.enqueue(async () => {
      if (!this.lastResponse) throw new Error('No last API response found. Call expectStatus(...) first.');
      this.context.set(key, this.lastResponse.body);
    });
  }

  /**
   * Executes the pending request (or replays a matching one captured from a
   * live UI session, if any) and asserts the response status code.
   */
  expectStatus(expectedStatusCode: number): ApiActions {
    return this.enqueue(async () => {
      const pending = this.pendingRequest;
      if (!pending) throw new Error('No pending API request. Call sendRequest(...) first.');

      this.lastRequest = { method: pending.method, url: pending.url, body: pending.body };

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
        this.context.set(this.cacheKeyFor(method, normalizedUrl), responseBody);
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
      const startedAt = Date.now();
      const response = await this.apiRequestContext.fetch(pending.url, {
        method: pending.method,
        headers,
        data,
      });
      const durationMs = Date.now() - startedAt;

      const status = response.status();
      const body = await parseResponseBodyFromJsonOrText(response);
      const token = extractTokenFromJson(body);
      if (token) this.authToken = token;

      logApiCall({ method: pending.method, url: pending.url, requestHeaders: headers, status, durationMs });

      this.lastResponse = { status, body };
      this.context.set(this.cacheKeyFor(method, normalizedUrl), body);
      this.pendingRequest = undefined;

      expect(status).toBe(expectedStatusCode);
    });
  }

  /** Asserts the last response body contains (at minimum) the given fields, at any depth. */
  validateResponseFields(expected: unknown): ApiActions {
    return this.enqueue(async () => {
      const last = this.lastResponse;
      if (!last) throw new Error('No last API response found. Call expectStatus(...) first.');
      await assertJsonIncludesPaths(last.body, expected);
    });
  }

  /** The full body of the last response - read after awaiting the chain. */
  get lastResponseBody(): unknown {
    return this.lastResponse?.body;
  }

  /** The body that was actually sent on the last request - read after awaiting expectStatus(), for validating the request itself (see validateApiRequest()). */
  get lastRequestBody(): unknown {
    return this.lastRequest?.body;
  }
}
