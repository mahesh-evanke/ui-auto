/**
 * Gherkin step definitions for basic SQL database table verification.
 * Connection: use "Given the database connection:" with a table of credentials (pgsql or sqlite),
 * or set db in e2e/config/config.yaml.
 */

import { After, Given, Then } from '@wdio/cucumber-framework';
import * as assert from 'assert';
import {
    setScenarioConnection,
    closeScenarioDb,
    countRows,
    tableContainsValue,
    getDbClient,
    type DbCredentials,
} from '../../support/db/dbClient';

After(async () => {
    await closeScenarioDb();
});

/**
 * Normalize key for lookup (lowercase, common aliases).
 */
function get(obj: Record<string, string>, ...keys: string[]): string {
    const lower: Record<string, string> = {};
    for (const k of Object.keys(obj)) {
        lower[k.trim().toLowerCase()] = obj[k];
    }
    for (const key of keys) {
        const v = lower[key.toLowerCase()];
        if (v !== undefined && v !== null) return String(v).trim();
    }
    return '';
}

/**
 * Parse credentials from a Cucumber data table.
 * Supports two formats:
 * 1) Key-value: two columns (e.g. "key" | "value"), each row is one field (type, host, port, user, password, database or path).
 * 2) Single row: one row with columns type, host, port, user, password, database (pgsql) or type, path (sqlite).
 */
function parseConnectionTable(rows: Array<Record<string, string>>): DbCredentials {
    if (!rows || rows.length === 0) {
        throw new Error('Database connection table must have at least one row with columns: type, and (for pgsql) host, port, user, password, database OR (for sqlite) path');
    }
    const colNames = Object.keys(rows[0]).map((k) => k.trim());
    let r: Record<string, string>;

    if (colNames.length === 2) {
        const keyCol = colNames[0];
        const valCol = colNames[1];
        const obj: Record<string, string> = {};
        for (const row of rows) {
            const key = String(row[keyCol] ?? '').trim().toLowerCase();
            const val = String(row[valCol] ?? '').trim();
            if (key) obj[key] = val;
        }
        r = obj;
    } else {
        r = rows[0];
    }

    let type = get(r, 'type', 'Type') || (r.type ?? r.Type ?? '').trim().toLowerCase();
    if (!type) {
        if (get(r, 'path', 'Path')) type = 'sqlite';
        else if (get(r, 'database', 'Database') || get(r, 'user', 'User')) type = 'pgsql';
    }
    if (type === 'pgsql' || type === 'postgres' || type === 'postgresql') {
        const host = get(r, 'host', 'Host') || 'localhost';
        const port = parseInt(get(r, 'port', 'Port') || '5432', 10);
        const user = get(r, 'user', 'User', 'username');
        const password = get(r, 'password', 'Password');
        const database = get(r, 'database', 'Database', 'db');
        if (!user || !database) {
            throw new Error('For pgsql, table must include: user, password, database');
        }
        return { type: 'pgsql', host, port, user, password, database };
    }
    if (type === 'sqlite') {
        const pathVal = get(r, 'path', 'Path');
        if (!pathVal) throw new Error('For sqlite, table must include: path');
        return { type: 'sqlite', path: pathVal };
    }
    throw new Error(`Unsupported database type "${type}". Use pgsql or sqlite.`);
}

type CucumberDataTable = { hashes(): Array<Record<string, string>> };
type RawCucumberDataTable = { raw(): string[][] };

Given(
    /^the database connection:$/,
    async (dataTable: CucumberDataTable) => {
        const rows = dataTable.hashes();
        const creds = parseConnectionTable(rows);
        setScenarioConnection(creds);
    }
);

// --- Row count assertions ---

Then(
    /^the database table "([^"]+)" should have at least (\d+) row(?:s)?$/,
    async (tableName: string, minRows: number) => {
        const count = await countRows(tableName);
        assert.ok(
            count >= minRows,
            `Expected table "${tableName}" to have at least ${minRows} row(s), but found ${count}`
        );
    }
);

Then(
    /^the database table "([^"]+)" should have at most (\d+) row(?:s)?$/,
    async (tableName: string, maxRows: number) => {
        const count = await countRows(tableName);
        assert.ok(
            count <= maxRows,
            `Expected table "${tableName}" to have at most ${maxRows} row(s), but found ${count}`
        );
    }
);

Then(
    /^the database table "([^"]+)" should have exactly (\d+) row(?:s)?$/,
    async (tableName: string, expectedRows: number) => {
        const count = await countRows(tableName);
        assert.strictEqual(
            count,
            expectedRows,
            `Expected table "${tableName}" to have exactly ${expectedRows} row(s), but found ${count}`
        );
    }
);

// --- Single column = value ---

Then(
    /^the database table "([^"]+)" should have (?:a |at least one )?row where column "([^"]+)" equals "([^"]*)"$/,
    async (tableName: string, column: string, value: string) => {
        const count = await countRows(tableName, column, value);
        assert.ok(
            count >= 1,
            `Expected table "${tableName}" to have at least one row where "${column}" = "${value}", but found ${count}`
        );
    }
);

Then(
    /^the database table "([^"]+)" should contain value "([^"]*)" in column "([^"]+)"$/,
    async (tableName: string, value: string, column: string) => {
        const found = await tableContainsValue(tableName, column, value);
        assert.ok(
            found,
            `Expected table "${tableName}" to contain value "${value}" in column "${column}", but it did not`
        );
    }
);

Then(
    /^the database table "([^"]+)" should have no rows where column "([^"]+)" equals "([^"]*)"$/,
    async (tableName: string, column: string, value: string) => {
        const count = await countRows(tableName, column, value);
        assert.strictEqual(
            count,
            0,
            `Expected table "${tableName}" to have no rows where "${column}" = "${value}", but found ${count}`
        );
    }
);

/**
 * Normalize a cell value to string for comparison and reporting.
 */
function normalizeCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

/**
 * Build a simple, human-readable diff message.
 */
function buildDiffMessage(options: {
    missingRows: Record<string, string>[];
    extraRows: Record<string, string>[];
    mismatches: { rowIndex: number; column: string; expected: string; actual: string }[];
}): string {
    const lines: string[] = [];
    lines.push('❌ Data verification failed.');

    if (options.missingRows.length) {
        lines.push('');
        lines.push('Missing rows (expected but not found):');
        options.missingRows.forEach((row) => {
            lines.push(`- ${JSON.stringify(row)}`);
        });
    }

    if (options.extraRows.length) {
        lines.push('');
        lines.push('Extra rows (found in database but not expected):');
        options.extraRows.forEach((row) => {
            lines.push(`- ${JSON.stringify(row)}`);
        });
    }

    if (options.mismatches.length) {
        lines.push('');
        lines.push('Mismatched values:');
        options.mismatches.forEach((m) => {
            lines.push(
                `- Row ${m.rowIndex + 1}, column "${m.column}": expected "${m.expected}", got "${m.actual}"`
            );
        });
    }

    return lines.join('\n');
}

/**
 * Compare actual DB rows with expected rows (order-sensitive).
 */
function diffRows(
    expectedColumns: string[],
    expectedRows: Record<string, string>[],
    actualRows: Record<string, unknown>[]
) {
    const makeKey = (row: Record<string, unknown>): string =>
        JSON.stringify(expectedColumns.map((c) => normalizeCell(row[c])));

    const toRowObject = (row: Record<string, unknown>): Record<string, string> => {
        const obj: Record<string, string> = {};
        for (const col of expectedColumns) {
            obj[col] = normalizeCell(row[col]);
        }
        return obj;
    };

    const expectedKeys = expectedRows.map((r) => makeKey(r as Record<string, unknown>));
    const actualKeys = actualRows.map((r) => makeKey(r));

    const missingRows: Record<string, string>[] = [];
    const extraRows: Record<string, string>[] = [];

    // Missing rows: in expected but not in actual (multiset-aware)
    const actualKeyCounts = new Map<string, number>();
    for (const k of actualKeys) {
        actualKeyCounts.set(k, (actualKeyCounts.get(k) || 0) + 1);
    }
    expectedKeys.forEach((k, idx) => {
        const count = actualKeyCounts.get(k) || 0;
        if (count > 0) {
            actualKeyCounts.set(k, count - 1);
        } else {
            missingRows.push(toRowObject(expectedRows[idx] as Record<string, unknown>));
        }
    });

    const expectedKeyCounts = new Map<string, number>();
    for (const k of expectedKeys) {
        expectedKeyCounts.set(k, (expectedKeyCounts.get(k) || 0) + 1);
    }
    actualKeys.forEach((k, idx) => {
        const count = expectedKeyCounts.get(k) || 0;
        if (count > 0) {
            expectedKeyCounts.set(k, count - 1);
        } else {
            extraRows.push(toRowObject(actualRows[idx]));
        }
    });

    const mismatches: { rowIndex: number; column: string; expected: string; actual: string }[] = [];
    const minLen = Math.min(expectedRows.length, actualRows.length);
    for (let i = 0; i < minLen; i++) {
        const exp = expectedRows[i];
        const act = actualRows[i];
        for (const col of expectedColumns) {
            const e = normalizeCell((exp as Record<string, unknown>)[col]);
            const a = normalizeCell((act as Record<string, unknown>)[col]);
            if (e !== a) {
                mismatches.push({ rowIndex: i, column: col, expected: e, actual: a });
            }
        }
    }

    return { missingRows, extraRows, mismatches };
}

Then(
    /^User verifies info from the sql query "([^"]+)"$/,
    async (sql: string, dataTable: RawCucumberDataTable) => {
        const raw = dataTable.raw();
        if (!raw || raw.length < 2) {
            throw new Error(
                'Please provide a header row and at least one data row in the table under the SQL step.'
            );
        }

        const [header, ...rows] = raw;
        const columns = header.map((h) => h.trim()).filter((h) => h.length > 0);
        if (columns.length === 0) {
            throw new Error('The header row must list at least one column name.');
        }

        const expectedRows: Record<string, string>[] = rows.map((r) => {
            const obj: Record<string, string> = {};
            columns.forEach((col, idx) => {
                obj[col] = normalizeCell(r[idx]);
            });
            return obj;
        });

        let client;
        try {
            client = await getDbClient();
        } catch (err: unknown) {
            const msg = err && (err as Error).message ? String((err as Error).message) : String(err);
            throw new Error(
                `Could not connect to the database. Please check the settings in config.yaml.\nDetails: ${msg}`
            );
        }

        let actualRows: Record<string, unknown>[];
        try {
            const result = await client.runQuery(sql);
            actualRows = Array.isArray(result)
                ? (result as Array<Record<string, unknown>>)
                : ([] as Array<Record<string, unknown>>);
        } catch (err: unknown) {
            const msg = err && (err as Error).message ? String((err as Error).message) : String(err);
            throw new Error(
                `The SQL query could not be run. Please check the statement.\nDetails: ${msg}`
            );
        }

        if (actualRows.length === 0 && expectedRows.length > 0) {
            throw new Error(
                `❌ Data verification failed.\nThe query returned no rows, but some rows were expected.`
            );
        }

        const actualColumnsSet = new Set<string>();
        actualRows.forEach((row) => {
            Object.keys(row || {}).forEach((k) => actualColumnsSet.add(k));
        });

        const missingColumns = columns.filter((c) => !actualColumnsSet.has(c));
        const extraColumns = Array.from(actualColumnsSet).filter((c) => !columns.includes(c));

        if (missingColumns.length || extraColumns.length) {
            const parts: string[] = ['❌ Data verification failed.', 'Column names did not match.'];
            if (missingColumns.length) {
                parts.push(`Missing columns in database result: ${missingColumns.join(', ')}`);
            }
            if (extraColumns.length) {
                parts.push(`Extra columns in database result: ${extraColumns.join(', ')}`);
            }
            throw new Error(parts.join('\n'));
        }

        const { missingRows, extraRows, mismatches } = diffRows(
            columns,
            expectedRows,
            actualRows || []
        );

        if (!missingRows.length && !extraRows.length && !mismatches.length) {
            // All good – keep output simple.
            // eslint-disable-next-line no-console
            console.log('✅ Data verification passed.');
            return;
        }

        const message = buildDiffMessage({ missingRows, extraRows, mismatches });
        throw new Error(message);
    }
);
