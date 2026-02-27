/**
 * API validation step definitions. Validate status codes and response fields for APIs captured per UI step.
 * Supports inline expectations and table-based validation (Method | URL | Status).
 */

import { Before, Then, DataTable } from '@wdio/cucumber-framework';
import * as assert from 'assert';
import { getApisForStep, lastUiStepName, clearContext } from './context.js';

Before(() => {
    clearContext();
});

/**
 * Table-based validation: each row is Method | URL (or URL fragment) | Status.
 * Uses lastUiStepName (set by "When backend APIs are captured for \"<name>\"" or "Given user performs \"<name>\"").
 */
Then(/^validate the following APIs:$/, async (dataTable: DataTable) => {
    const stepName = lastUiStepName;
    assert.ok(stepName, 'No previous UI step. Use "When backend APIs are captured for \"<name>\"" or Given user performs \"<name>\", then this step.');
    const apis = getApisForStep(stepName);
    assert.ok(apis.length > 0, `No APIs captured for step "${stepName}".`);
    await validateApisTable(stepName, apis, dataTable);
});

/**
 * Table-based validation with explicit step name: "Then validate the following APIs for \"login\":".
 * Use this when the step name is not set by a previous When (e.g. after "When backend APIs are captured for \"login\"").
 */
Then(/^validate the following APIs for "([^"]+)"$/, async (stepName: string, dataTable: DataTable) => {
    const apis = getApisForStep(stepName);
    assert.ok(apis.length > 0, `No APIs captured for step "${stepName}".`);
    await validateApisTable(stepName, apis, dataTable);
});

async function validateApisTable(stepName: string, apis: { method: string; url: string; status: number }[], dataTable: DataTable): Promise<void> {
    const rows = dataTable.hashes() as Array<{ Method: string; URL: string; Status: string }>;
    for (const row of rows) {
        const method = (row.Method || row.method || '').toUpperCase().trim();
        const urlPart = (row.URL || row.url || '').trim();
        const expectedStatus = parseInt(String(row.Status || row.status).trim(), 10);
        const match = apis.find((a) => (method ? (a.method || '').toUpperCase() === method : true) && (urlPart ? a.url.includes(urlPart) : true) && a.status === expectedStatus);
        assert.ok(match, `Step "${stepName}": no API matching Method=${method || '*'}, URL contains "${urlPart}", Status=${expectedStatus}. Captured: ${apis.map((a) => `${a.method} ${a.url} ${a.status}`).join('; ')}`);
    }
}

Then(/^APIs are validated for "([^"]+)" with status codes? (\d+(?:\s*,\s*\d+)*)$/, async (stepName: string, statusCodesStr: string) => {
    const apis = getApisForStep(stepName);
    const expectedCodes = statusCodesStr.split(',').map((s) => parseInt(s.trim(), 10));
    assert.ok(apis.length > 0, `No APIs captured for step "${stepName}". Ensure UI action was performed and capture ran.`);
    const actualCodes = apis.map((a) => a.status);
    for (const expected of expectedCodes) {
        assert.ok(
            actualCodes.includes(expected),
            `Step "${stepName}": expected at least one API with status ${expected}. Got: ${actualCodes.join(', ')}. URLs: ${apis.map((a) => a.url).join('; ')}`
        );
    }
});

Then(/^APIs are validated with status codes? (\d+(?:\s*,\s*\d+)*)$/, async (statusCodesStr: string) => {
    const stepName = lastUiStepName;
    assert.ok(stepName, 'No previous UI step name. Use "APIs are validated for \"StepName\" with status code ..." or perform a UI action first.');
    const apis = getApisForStep(stepName);
    const expectedCodes = statusCodesStr.split(',').map((s) => parseInt(s.trim(), 10));
    assert.ok(apis.length > 0, `No APIs captured for step "${stepName}".`);
    const actualCodes = apis.map((a) => a.status);
    for (const expected of expectedCodes) {
        assert.ok(
            actualCodes.includes(expected),
            `Step "${stepName}": expected at least one API with status ${expected}. Got: ${actualCodes.join(', ')}.`
        );
    }
});

Then(/^API "([^"]+)" for step "([^"]+)" has status (\d+)$/, async (urlPart: string, stepName: string, expectedStatus: number) => {
    const apis = getApisForStep(stepName);
    const match = apis.find((a) => a.url.includes(urlPart));
    assert.ok(match, `No API matching "${urlPart}" in step "${stepName}". Captured URLs: ${apis.map((a) => a.url).join('; ')}`);
    assert.strictEqual(match.status, expectedStatus, `API ${match.url} expected status ${expectedStatus}, got ${match.status}`);
});

Then(/^at least one API for "([^"]+)" has status (\d+)$/, async (stepName: string, expectedStatus: number) => {
    const apis = getApisForStep(stepName);
    assert.ok(apis.length > 0, `No APIs captured for step "${stepName}".`);
    const hasStatus = apis.some((a) => a.status === expectedStatus);
    assert.ok(hasStatus, `Step "${stepName}": no API with status ${expectedStatus}. Got: ${apis.map((a) => a.status).join(', ')}`);
});
