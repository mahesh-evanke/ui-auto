/**
 * API execution and captured-API replay step definitions.
 */
import { Given, Then } from '@cucumber/cucumber';
import type { DataTable } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { AutomationWorld } from './world';
import { dataTableToJson } from '../utils/datatable';
import { extractTokenFromJson, buildAuthorizationHeader } from '../utils/token';
import { findCapturedApi, normalizeUrl, waitForCapturedApi } from '../utils/matcher';

type SyntheticApiResponse = {
  status: () => number;
  json: () => Promise<unknown>;
};

function stripJsonIfQuoted(value: unknown): unknown {
  // Not used currently, kept as hook for potential future feature.
  return value;
}

async function parseResponseBodyFromJsonOrText(resp: any): Promise<unknown> {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((actual as any) ?? undefined).toEqual(expected);
    return;
  }

  if (Array.isArray(expected)) {
    const a = Array.isArray(actual) ? actual : [];
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] === undefined) continue;
      // eslint-disable-next-line no-await-in-loop
      await assertJsonIncludesPaths((a as unknown[])[i], expected[i]);
    }
    return;
  }

  if (isRecord(expected)) {
    const a = isRecord(actual) ? actual : {};
    for (const [k, v] of Object.entries(expected)) {
      // eslint-disable-next-line no-await-in-loop
      if (!(k in a)) throw new Error(`Missing field in response at path "${k}"`);
      await assertJsonIncludesPaths(a[k], v);
    }
    return;
  }
}

function createSyntheticResponse(captured: any): SyntheticApiResponse {
  const status = Number(captured.status);
  return {
    status: () => status,
    json: async () => captured.responseBody as unknown,
  };
}

Given('User sends {word} request to {string}', async function (this: AutomationWorld, method: string, url: string) {
  const normalizedUrl = normalizeUrl(url);
  this.apiState.pendingRequest = {
    method: String(method || '').toUpperCase(),
    url,
    normalizedUrl,
  };
});

Given('User sends {word} request to {string} with body:', async function (this: AutomationWorld, method: string, url: string, dataTable: DataTable) {
  const bodyJson = dataTableToJson(dataTable);
  const normalizedUrl = normalizeUrl(url);
  this.apiState.pendingRequest = {
    method: String(method || '').toUpperCase(),
    url,
    normalizedUrl,
    body: stripJsonIfQuoted(bodyJson),
  };
});

Then('User expects status code {int}', async function (this: AutomationWorld, expectedStatusCode: number) {
  const pending = this.apiState.pendingRequest;
  if (!pending) throw new Error('No pending API request. Add Given User sends ... request step first.');

  const normalizedUrl = pending.normalizedUrl;
  const method = pending.method;

  const browserEnabled = !!this.page;

  // 1) Replay from captured API if present (method + normalized URL).
  const replay = findCapturedApi({
    capturedApis: this.apiState.capturedApis,
    consumedCapturedApiIndices: this.apiState.consumedCapturedApiIndices,
    method,
    normalizedUrl,
  });

  const doReplay = async (): Promise<boolean> => {
    const found = replay ?? (await waitForCapturedApi({
      capturedApis: this.apiState.capturedApis,
      consumedCapturedApiIndices: this.apiState.consumedCapturedApiIndices,
      method,
      normalizedUrl,
      timeoutMs: browserEnabled ? 10000 : 0,
      pollIntervalMs: 150,
    }));

    if (!found) {
      return false;
    }

    // Log per requirement.
    // eslint-disable-next-line no-console
    console.log(`[api] Using captured API: ${method} ${normalizedUrl}`);

    this.apiState.consumedCapturedApiIndices.add(found.index);
    const synthetic = createSyntheticResponse(found.api) as SyntheticApiResponse;
    const responseBody = await synthetic.json();
    const token = extractTokenFromJson(responseBody);
    if (token) this.apiState.authToken = token;
    this.apiState.lastSyntheticResponse = synthetic;
    this.apiState.lastResponse = { status: synthetic.status(), body: responseBody };
    return true;
  };

  // 1) If browser is enabled: always try captured first.
  // 2) If browser is not enabled: execute directly (captured list is empty anyway).
  if (browserEnabled) {
    const used = await doReplay();
    if (used) {
      expect(this.apiState.lastResponse?.status).toBe(expectedStatusCode);
      this.apiState.pendingRequest = undefined;
      return;
    }
  } else if (replay) {
    const used = await doReplay();
    if (used) {
      expect(this.apiState.lastResponse?.status).toBe(expectedStatusCode);
      this.apiState.pendingRequest = undefined;
      return;
    }
  }

  // Replay not found: execute the API call directly using the feature URL (exactly as provided).

  // 2) Execute via Playwright APIRequestContext.fetch().
  if (!this.apiRequestContext) throw new Error('APIRequestContext not initialized.');
  const fetchUrl = pending.url;

  const headers: Record<string, string> = {};
  headers['content-type'] = 'application/json';
  Object.assign(headers, buildAuthorizationHeader(this.apiState.authToken));

  const methodUpper = String(pending.method || '').toUpperCase();
  const data = pending.body !== undefined ? JSON.stringify(pending.body) : undefined;

  const response = await this.apiRequestContext.fetch(fetchUrl, {
    method: methodUpper,
    headers,
    data,
  });

  const status = response.status();
  const body = await parseResponseBodyFromJsonOrText(response);
  const token = extractTokenFromJson(body);
  if (token) this.apiState.authToken = token;

  this.apiState.lastResponse = { status, body };
  this.apiState.lastSyntheticResponse = undefined;
  this.apiState.pendingRequest = undefined;

  expect(status).toBe(expectedStatusCode);
});

Then('User validates response has fields:', async function (this: AutomationWorld, dataTable: DataTable) {
  const last = this.apiState.lastResponse;
  if (!last) throw new Error('No last API response found. Call Then User expects status code first.');

  const expected = dataTableToJson(dataTable);
  await assertJsonIncludesPaths(last.body, expected);
});

