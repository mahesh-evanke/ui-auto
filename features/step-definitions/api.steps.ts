/**
 * API step definitions – generic request/response steps.
 *
 * URLs, request body, and response expectations are provided by the user in feature files.
 * Step defs do not hardcode any API URLs, request payloads, or response shapes.
 */

import { Before, Given, Then } from '@wdio/cucumber-framework';
import axios, { type AxiosResponse } from 'axios';
import * as assert from 'assert';

type ApiState = {  //Stores the last API response and authentication token between test steps
    lastResponse?: AxiosResponse;
    authToken?: string;
};

let apiState: ApiState = {};  //Global state for API testing

Before(() => {
    apiState = {};
});

// Allow simple field names OR JSONPath-like paths without the "$." prefix,
// e.g. "firstname", "booking.bookingdates.checkin", "phoneNumbers[0].type".
function isValidPath(path: string): boolean {  //Purpose: Validates if a path is in correct format or not
    // segment: name or name[index]
    const segment = '[A-Za-z_][A-Za-z0-9_]*(\\[\\d+\\])?';
    const re = new RegExp(`^${segment}(\\.${segment})*$`);
    return re.test(path);
}

// For simple top-level fields like "token", "reason"
function isValidSimpleFieldName(path: string): boolean { //Validates simple field names (no dots, no brackets)
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(path);
}

function parseFeatureValue(raw: string): string | number | boolean { //Converts string values from feature files into proper types
    const trimmed = String(raw ?? '').trim();
    if (trimmed.length === 0) {
        throw new Error(`Value cannot be empty`);
    }

    // String: MUST be wrapped in double quotes
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
        // Strip wrapping quotes only (no JSON parsing / no escapes support on purpose)
        return trimmed.slice(1, -1);
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
        `Invalid value "${raw}". Strings must be in double quotes (e.g. "admin"). Numbers must be unquoted (e.g. 10). Booleans must be unquoted true/false.`
    );
}

type CucumberDataTable = {
    hashes(): Array<Record<string, string>>;
};

function parseKeyValueTable(dataTable: CucumberDataTable): Record<string, string | number | boolean> {  //Converts Cucumber data tables into key-value objects
    const rows = dataTable.hashes() as Array<{ path: string; value: string }>;                          //Why needed: Transforms tabular test data into usable JSON objects
    const body: Record<string, string | number | boolean> = {};

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

function requireJsonObjectResponse(response: AxiosResponse): Record<string, unknown> {  //Validates that the API response is a JSON object (not array, null, etc.)
    const data = response.data;                                                         // Prevents errors when trying to access object properties
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(
            `Expected response JSON object but got ${Array.isArray(data) ? 'array' : typeof data}`
        );
    }
    return data as Record<string, unknown>;
}

function setValueAtPath(target: Record<string, unknown>, path: string, value: unknown): void {  //Sets a value in a nested object using dot notation
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
        ...(apiState.authToken ? { Cookie: `token=${apiState.authToken}` } : {}),
    };
}

Given(
    /^User sends (GET|POST|PUT|DELETE) request to "([^"]+)" with body:$/,   //Why needed: Sends API requests with complex JSON bodies
    async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, dataTable) => {
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
    }
);

Given(/^User sends (GET|POST|PUT|DELETE) request to "([^"]+)"$/, async (method: string, url: string) => {   //Why needed: For simple requests that don't need a body (like GET requests)    
    apiState.lastResponse = await axios({
        method: method.toLowerCase(),
        url,
        headers: defaultHeaders(),
        validateStatus: () => true,
    });
});

Given(/^User has a valid auth token from "([^"]+)" with body:$/, async (url: string, dataTable) => { //Why needed: For authentication requests that need a body (like POST requests)
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

Then(/^User expects status code (\d+)$/, async (expectedStatus: number) => {  //Why needed: Validates that the API response status code matches the expected value
    const response = apiState.lastResponse;
    assert.ok(response, 'No API response found. Did you send a request first?');
    assert.strictEqual(
        response.status,
        Number(expectedStatus),
        `Expected status ${expectedStatus} but got ${response.status}`
    );
});

function getValueAtPath(source: Record<string, unknown>, path: string): unknown { //Retrieves a value from a nested object using dot notation
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

Then(/^User validates response has fields:$/, async (dataTable) => { //Why needed: Validates that the API response contains the expected fields and values
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

Then(/^User validates response has (\w+)$/, async (fieldName: string) => { //Why needed: Validates that the API response contains a specific field with a non-empty value
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