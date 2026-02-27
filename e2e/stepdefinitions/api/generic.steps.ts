/**
 * API step definitions – generic request/response steps.
 *
 * URLs, request body, and response expectations are provided by the user in feature files.
 * Step defs do not hardcode any API URLs, request payloads, or response shapes.
 *
 * For @webui-api scenarios, "User sends ... request to URL" uses the browser-captured response
 * when a matching request was already triggered by the UI (avoids duplicate request and 401).
 */

import { Before, Given, Then } from '@wdio/cucumber-framework';
import axios, { type AxiosResponse } from 'axios';
import * as assert from 'assert';
import { getCapturedApis, waitForNetworkIdle } from '../../support/networkCapture.js';

type ApiState = {  //Stores the last API response and authentication token between test steps
    lastResponse?: AxiosResponse;
    authToken?: string;
};

let apiState: ApiState = {};  //Global state for API testing

Before(() => {
    apiState = {};
});

function looksLikeJwt(token: string): boolean {
    // Very lightweight heuristic: three base64-ish segments separated by dots.
    return /^[A-Za-z0-9\-_]+=*\.[A-Za-z0-9\-_]+=*\.[A-Za-z0-9\-_+=\/]*$/.test(token);
}

/**
 * Hybrid mode helper: when CDP capture is unavailable (e.g. Appium mobile web),
 * try to get an auth token from the active browser session so axios calls don't 401.
 *
 * This is intentionally best-effort and silent on failure.
 */
async function tryHydrateAuthTokenFromBrowserSession(): Promise<void> {
    if (apiState.authToken) return;
    const b: any = (global as any).browser;
    if (!b || typeof b.execute !== 'function') return;

    try {
        const token = await b.execute(() => {
            const g: any = globalThis as any;
            const candidateKeys = [
                'token',
                'authToken',
                'accessToken',
                'access_token',
                'jwt',
                'idToken',
                'id_token',
                'authorization',
                'Authorization',
                'auth',
            ];

            function tryParseJson(s: string): any | null {
                try {
                    const t = (s || '').trim();
                    if (!t) return null;
                    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
                        return JSON.parse(t);
                    }
                    return null;
                } catch {
                    return null;
                }
            }

            function extractTokenFromObject(obj: any): string | null {
                if (!obj || typeof obj !== 'object') return null;
                const keys = ['token', 'authToken', 'accessToken', 'access_token', 'jwt', 'idToken', 'id_token'];
                for (const k of keys) {
                    const v = obj[k];
                    if (typeof v === 'string' && v.trim()) return v.trim();
                }
                return null;
            }

            function searchStorage(storage: Storage | null): string | null {
                if (!storage) return null;
                for (const k of candidateKeys) {
                    const v = storage.getItem(k);
                    if (typeof v === 'string' && v.trim()) {
                        const parsed = tryParseJson(v);
                        const nested = parsed ? extractTokenFromObject(parsed) : null;
                        return (nested || v).trim();
                    }
                }
                // last resort: scan everything for something token-like
                for (let i = 0; i < storage.length; i++) {
                    const key = storage.key(i);
                    if (!key) continue;
                    const v = storage.getItem(key);
                    if (!v || typeof v !== 'string') continue;
                    const parsed = tryParseJson(v);
                    const nested = parsed ? extractTokenFromObject(parsed) : null;
                    const candidate = (nested || v).trim();
                    if (candidate) return candidate;
                }
                return null;
            }

            const fromLocal = searchStorage(g.localStorage || null);
            if (fromLocal) return fromLocal;
            const fromSession = searchStorage(g.sessionStorage || null);
            if (fromSession) return fromSession;

            // Cookie fallback (very basic): token=... or access_token=...
            try {
                const cookie = (g.document && g.document.cookie) ? String(g.document.cookie) : '';
                const parts = cookie.split(';').map((p) => p.trim());
                for (const p of parts) {
                    const eq = p.indexOf('=');
                    if (eq <= 0) continue;
                    const k = p.slice(0, eq);
                    const v = decodeURIComponent(p.slice(eq + 1));
                    if (candidateKeys.includes(k) && v && v.trim()) return v.trim();
                }
            } catch {
                // ignore
            }

            return null;
        });

        if (typeof token === 'string' && token.trim().length > 0) {
            const t = token.trim();
            // If app stored "Bearer <token>" in storage, normalize to raw token.
            const normalized = t.toLowerCase().startsWith('bearer ') ? t.slice('bearer '.length).trim() : t;
            apiState.authToken = normalized;
        }
    } catch {
        // ignore
    }
}

/** Normalize URL for matching: pathname + search only (ignore host/port so localhost vs 127.0.0.1 match). */
function normalizeUrlForMatch(u: string): string {
    try {
        const url = new URL(u);
        const path = url.pathname.replace(/\/$/, '') || '/';
        return (path + (url.search || '')).toLowerCase();
    } catch {
        const s = String(u).toLowerCase().replace(/\/$/, '');
        const q = s.indexOf('?');
        return q >= 0 ? s : s;
    }
}

/**
 * If a captured network response matches method+URL, return a synthetic AxiosResponse so we
 * validate what the browser received instead of sending a duplicate request (which may get 401).
 */
function tryGetCapturedResponse(method: string, url: string): AxiosResponse | null {
    try {
        const apis = getCapturedApis();
        const methodUpper = (method || 'GET').toUpperCase();
        const normalized = normalizeUrlForMatch(url);
        const match = apis.filter(
            (a) => (a.method || 'GET').toUpperCase() === methodUpper && normalizeUrlForMatch(a.url) === normalized
        ).pop();
        if (!match) return null;
        return {
            status: match.status,
            statusText: String(match.status),
            data: match.responseBody,
            headers: {},
            config: {} as any,
        } as AxiosResponse;
    } catch {
        return null;
    }
}

// Allow simple field names OR JSONPath-like paths without the "$." prefix,
// e.g. "firstname", "booking.bookingdates.checkin", "phoneNumbers[0].type".
function isValidPath(path: string): boolean {  //Purpose: Validates if a path is in correct format or not
    // segment: name or name[index]
    const segment = '[A-Za-z_][A-Za-z0-9_]*(\\[\\d+\\])?';
    const re = new RegExp(`^${segment}(\\.${segment})*$`);
    return re.test(path);
}

// For simple top-level fields like "token", "reason"
//Validates simple field names (no dots, no brackets)
function isValidSimpleFieldName(path: string): boolean { 
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(path);
}

// Supported value types from feature tables:
// - strings in double quotes
// - numbers/booleans/null unquoted
// - arrays/objects as valid JSON (either raw JSON or quoted JSON string)
type FeatureValue = string | number | boolean | null | unknown[] | Record<string, unknown>;

//Converts string values from feature files into proper types (including arrays like [10, 20, 30] or [[1,2],[3,4]])
function parseFeatureValue(raw: string): FeatureValue {
    const trimmed = String(raw ?? '').trim();
    if (trimmed.length === 0) {
        throw new Error(`Value cannot be empty`);
    }

    // null: MUST be unquoted
    if (trimmed === 'null') {
        return null;
    }

    // Raw JSON object/array (unquoted)
    const looksLikeJsonObject = trimmed.startsWith('{') && trimmed.endsWith('}');
    const looksLikeJsonArray = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (looksLikeJsonObject || looksLikeJsonArray) {
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (parsed === null) return null;
            if (Array.isArray(parsed)) return parsed as unknown[];
            if (typeof parsed === 'object') return parsed as Record<string, unknown>;
            throw new Error(`Parsed JSON is not an object/array`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Invalid JSON value "${raw}". Use valid JSON object {...} or array [...]. ${msg}`);
        }
    }

    // String: MUST be wrapped in double quotes.
    // If the string itself contains JSON (e.g. generated: "{\"a\":1}" or "[1,2]"), parse it.
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
        const inner = trimmed.slice(1, -1);
        const innerTrim = inner.trim();

        const stringLooksLikeJson =
            (innerTrim.startsWith('{') && innerTrim.endsWith('}')) ||
            (innerTrim.startsWith('[') && innerTrim.endsWith(']'));

        if (stringLooksLikeJson) {
            try {
                // First parse: interpret escapes inside the quoted string.
                const unescaped = JSON.parse(trimmed) as unknown;
                if (typeof unescaped === 'string') {
                    const candidate = unescaped.trim();
                    const candidateLooksLikeJson =
                        (candidate.startsWith('{') && candidate.endsWith('}')) ||
                        (candidate.startsWith('[') && candidate.endsWith(']'));
                    if (candidateLooksLikeJson) {
                        const parsed = JSON.parse(candidate) as unknown;
                        if (parsed === null) return null;
                        if (Array.isArray(parsed)) return parsed as unknown[];
                        if (typeof parsed === 'object') return parsed as Record<string, unknown>;
                    }
                }
            } catch {
                // Fall back to treating it as a plain string.
            }
        }

        return inner;
    }

    // Boolean: MUST be unquoted true/false
    if (trimmed === 'true') {
        return true;
    }
    if (trimmed === 'false') {
        return false;
    }

    // Number: MUST be unquoted
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed);
    }

    // Anything else violates the feature-file contract
    throw new Error(
        `Invalid value "${raw}". Strings must be in double quotes (e.g. "admin"). Numbers unquoted (e.g. 10). Booleans unquoted true/false. Use null for JSON null. Arrays/objects must be valid JSON (e.g. [10, 20] or {"a":1}).`
    );
}

type CucumberDataTable = {
    hashes(): Array<Record<string, string>>;
};

//Converts Cucumber data tables into key-value objects (supports arrays and nested arrays in value column)
function parseKeyValueTable(dataTable: CucumberDataTable): Record<string, FeatureValue> {
    const rows = dataTable.hashes() as Array<{ path: string; value: string }>;
    const body: Record<string, FeatureValue> = {};

    const errors: string[] = [];

    for (const row of rows) {
        const path = String(row.path ?? '').trim();
        if (!isValidPath(path)) {
            errors.push(
                `Invalid path "${row.path}". Use simple names or JSON-like paths without "$.", e.g. "field", "booking.checkin", "phoneNumbers[0].type".`
            );
            continue;
        }

        try {
            body[path] = parseFeatureValue(row.value);
        } catch (e: any) {
            errors.push(`Invalid value for "${path}": ${e?.message ?? String(e)}`);
        }
    }

    if (errors.length > 0) {
        throw new Error(
            `Invalid feature table input:\n` + errors.map((e, i) => `  ${i + 1}) ${e}`).join('\n')
        );
    }

    return body;
}

//Validates that the API response is a JSON object (not array, null, etc.)
// Prevents errors when trying to access object properties
function requireJsonObjectResponse(response: AxiosResponse): Record<string, unknown> {  
    const data = response.data;                                                         
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(
            `Expected response JSON object but got ${Array.isArray(data) ? 'array' : typeof data}`
        );
    }
    return data as Record<string, unknown>;
}

//Sets a value in a nested object using dot notation
function setValueAtPath(target: Record<string, unknown>, path: string, value: unknown): void {  
    const segments = path.split('.');
    let current: any = target;

    segments.forEach((segment, index) => {
        const match = segment.match(/^([A-Za-z_][A-Za-z0-9_]*)(\[(\d+)\])?$/);
        if (!match) {
            throw new Error(`Invalid path segment "${segment}" in "${path}"`);
        }
        const prop = match[1];
        const indexStr = match[3];
        const isLast = index === segments.length - 1;

        if (indexStr !== undefined) {
            const idx = Number(indexStr);
            if (!Array.isArray(current[prop])) {
                current[prop] = [];
            }
            if (!current[prop][idx]) {
                current[prop][idx] = {};
            }
            if (isLast) {
                current[prop][idx] = value;
            } else {
                current = current[prop][idx];
            }
        } else {
            if (isLast) {
                current[prop] = value;
            } else {
                if (
                    current[prop] === undefined ||
                    current[prop] === null ||
                    typeof current[prop] !== 'object' ||
                    Array.isArray(current[prop])
                ) {
                    current[prop] = {};
                }
                current = current[prop];
            }
        }
    });
}

function defaultHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(apiState.authToken ? { Authorization: `Bearer ${apiState.authToken}` } : {}),
    };
}

/**
 * If the request was to a login URL and response is 200, extract JWT from response body and set apiState.authToken
 * so subsequent requests get Authorization: Bearer <token>. Tries common keys: token, accessToken, access_token, jwt.
 */
function extractAuthTokenIfLogin(url: string, response: AxiosResponse | null): void {
    if (!response || response.status !== 200) return;
    const u = (url || '').toLowerCase();
    if (!u.includes('auth') && !u.includes('login')) return;
    const data = response.data;
    if (data == null || typeof data !== 'object') return;
    const obj = data as Record<string, unknown>;
    const token =
        typeof obj.token === 'string' ? obj.token
        : typeof obj.accessToken === 'string' ? obj.accessToken
        : typeof obj.access_token === 'string' ? obj.access_token
        : typeof obj.jwt === 'string' ? obj.jwt
        : undefined;
    if (token && token.length > 0) {
        apiState.authToken = token;
    }
}

//Why needed: Sends API requests with complex JSON bodies. In @webui-api, uses browser-captured response when present.
Given(
    /^User sends (GET|POST|PUT|PATCH|DELETE) request to "([^"]+)" with body:$/,
    async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, dataTable) => {
        await waitForNetworkIdle(2500);
        const captured = tryGetCapturedResponse(method, url);
        if (captured) {
            apiState.lastResponse = captured;
            extractAuthTokenIfLogin(url, captured);
            return;
        }
        await tryHydrateAuthTokenFromBrowserSession();
        const flatBody = parseKeyValueTable(dataTable);
        const body: Record<string, unknown> = {};
        for (const [path, value] of Object.entries(flatBody)) {
            setValueAtPath(body, path, value);
        }

        apiState.lastResponse = await axios({
            method: method.toLowerCase(),
            url,
            data: Object.keys(body).length > 0 ? body : undefined,
            headers: defaultHeaders(),
            validateStatus: () => true,
        });
        extractAuthTokenIfLogin(url, apiState.lastResponse);
    }
);

//Why needed: For simple requests that don't need a body (like GET requests). In @webui-api, uses browser-captured response when present.
Given(/^User sends (GET|POST|PUT|PATCH|DELETE) request to "([^"]+)"$/, async (method: string, url: string) => {
    await waitForNetworkIdle(2500);
    const captured = tryGetCapturedResponse(method, url);
    if (captured) {
        apiState.lastResponse = captured;
        extractAuthTokenIfLogin(url, captured);
        return;
    }
    await tryHydrateAuthTokenFromBrowserSession();
    apiState.lastResponse = await axios({
        method: method.toLowerCase(),
        url,
        headers: defaultHeaders(),
        validateStatus: () => true,
    });
    extractAuthTokenIfLogin(url, apiState.lastResponse);
});

//Why needed: For authentication requests that need a body (like POST requests)
Given(/^User has a valid auth token from "([^"]+)" with body:$/, async (url: string, dataTable) => { 
    const flatBody = parseKeyValueTable(dataTable);
    const body: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(flatBody)) {
        setValueAtPath(body, path, value);
    }

    const response = await axios.post(url, body, {
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        validateStatus: () => true,
    });

    const json = requireJsonObjectResponse(response);
    const token = (json as Record<string, unknown>).token;
    assert.ok(typeof token === 'string' && token.length > 0, 'Auth response missing token');
    apiState.authToken = token;
});

//Why needed: Validates that the API response status code matches the expected value
Then(/^User expects status code (\d+)$/, async (expectedStatus: number) => {  
    const response = apiState.lastResponse;
    assert.ok(response, 'No API response found. Did you send a request first?');
    assert.strictEqual(
        response.status,
        Number(expectedStatus),
        `Expected status ${expectedStatus} but got ${response.status}`
    );
});

//Retrieves a value from a nested object using dot notation
function getValueAtPath(source: Record<string, unknown>, path: string): unknown { 
    const segments = path.split('.');
    let current: any = source;

    for (const segment of segments) {
        if (current === undefined || current === null) {
            return undefined;
        }

        const match = segment.match(/^([A-Za-z_][A-Za-z0-9_]*)(\[(\d+)\])?$/);
        if (!match) {
            throw new Error(`Invalid path segment "${segment}" in "${path}"`);
        }
        const prop = match[1];
        const indexStr = match[3];

        current = current[prop];
        if (indexStr !== undefined) {
            const idx = Number(indexStr);
            if (!Array.isArray(current)) {
                return undefined;
            }
            current = current[idx];
        }
    }

    return current;
}

//Why needed: Validates that the API response contains the expected fields and values
Then(/^User validates response has fields:$/, async (dataTable) => { 
    const response = apiState.lastResponse;
    assert.ok(response, 'No API response found. Did you send a request first?');

    const json = requireJsonObjectResponse(response);
    const expected = parseKeyValueTable(dataTable);

    const errors: string[] = [];

    for (const [key, expectedValue] of Object.entries(expected)) {
        const actualValue = getValueAtPath(json, key);
        if (actualValue === undefined) {
            errors.push(`Missing field "${key}"`);
            continue;
        }

        try {
            assert.deepStrictEqual(actualValue, expectedValue);
        } catch {
            errors.push(
                `Field "${key}" mismatch: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(
                    actualValue
                )}`
            );
        }
    }

    if (errors.length > 0) {
        throw new Error(`Response field validation failed:\n` + errors.map((e, i) => `  ${i + 1}) ${e}`).join('\n'));
    }
});

//Why needed: Validates that the API response contains a specific field with a non-empty value
Then(/^User validates response has "?(\w+)"?$/, async (fieldName: string) => { 
    if (!isValidSimpleFieldName(fieldName)) {
        throw new Error(
            `Invalid field "${fieldName}". Use simple field names only (no "$", no "$.", no ".", no JSONPath).`
        );
    }

    const response = apiState.lastResponse;
    assert.ok(response, 'No API response found. Did you send a request first?');

    const json = requireJsonObjectResponse(response);
    const value = (json as any)[fieldName];

    if (value === undefined || value === null || value === '') {
        throw new Error(`Expected response to have non-empty "${fieldName}" but got ${JSON.stringify(value)}`);
    }
});

//Why needed: Loads JSON body from a file (for complex payloads)
Given(
    /^User sends (POST|PUT|PATCH) request to "([^"]+)" with body from file "([^"]+)"$/,
    async (method: 'POST' | 'PUT' | 'PATCH', url: string, filePath: string) => {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const fullPath = path.resolve(filePath);
        const fileContent = await fs.readFile(fullPath, 'utf-8');
        const body = JSON.parse(fileContent);

        apiState.lastResponse = await axios({
            method: method.toLowerCase(),
            url,
            data: body,
            headers: defaultHeaders(),
            validateStatus: () => true,
        });
    }
);