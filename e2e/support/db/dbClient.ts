/**
 * Database client for E2E SQL verification steps.
 * Supports SQLite (sql.js, pure JS – no native build) and PostgreSQL (pg).
 * Connection can come from: (1) Gherkin Given step credentials, or (2) db config in config.yaml.
 * Table/column names are validated; values use parameterized queries.
 */

import * as fs from 'fs';
import * as path from 'path';

export type DbCredentials =
    | { type: 'pgsql'; host: string; port: number; user: string; password: string; database: string }
    | { type: 'sqlite'; path: string };

export type DbConfig =
    | {
          type: 'sqlite';
          path: string;
      }
    | {
          type: 'pgsql';
          host: string;
          port: number;
          user: string;
          password: string;
          database: string;
      };

export interface DbClientInterface {
    runQuery(sql: string, params?: unknown[]): Promise<unknown[]>;
    close(): void | Promise<void>;
}

// Scenario-level connection (set by Given step)
let scenarioCredentials: DbCredentials | null = null;
let scenarioClient: DbClientInterface | null = null;

// Config-level cache (from config.yaml)
let configClient: DbClientInterface | null = null;

function loadConfig(): DbConfig | null {
    try {
        const yaml = require('js-yaml');
        const configPath = path.resolve(process.cwd(), 'e2e/config/config.yaml');
        if (!fs.existsSync(configPath)) return null;
        const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
        const db = config?.db;
        if (!db || !db.type) return null;
        if (db.type === 'sqlite' && db.path) {
            return { type: 'sqlite', path: path.resolve(process.cwd(), db.path) };
        }
        if (db.type === 'pgsql') {
            const host = db.host || 'localhost';
            const port = typeof db.port === 'number' ? db.port : parseInt(String(db.port || '5432'), 10);
            const user = db.user;
            const password = db.password;
            const database = db.database;
            if (!user || !database) {
                throw new Error('PostgreSQL config must include user and database under db in config.yaml');
            }
            return {
                type: 'pgsql',
                host,
                port,
                user,
                password,
                database,
            };
        }
        return null;
    } catch {
        return null;
    }
}

/** Convert SQL with ? placeholders to pg $1, $2 style and return params in order */
function toPgPlaceholders(sql: string, params: unknown[]): string {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

function createPgClient(creds: Extract<DbCredentials, { type: 'pgsql' }>): DbClientInterface {
    let Client: any;
    try {
        Client = require('pg').Client;
    } catch {
        throw new Error('PostgreSQL support requires the "pg" package. Run: npm install --save-dev pg');
    }
    const client = new Client({
        host: creds.host,
        port: creds.port,
        user: creds.user,
        password: creds.password,
        database: creds.database,
    });
    let connected = false;

    return {
        async runQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
            if (!connected) {
                await client.connect();
                connected = true;
            }
            const pgSql = toPgPlaceholders(sql, params);
            const result = await client.query(pgSql, params);
            return Array.isArray(result.rows) ? result.rows : [];
        },
        async close(): Promise<void> {
            try {
                if (connected) await client.end();
            } catch {
                // ignore
            }
        },
    };
}

/** SQLite client using sql.js (pure JS, no native build; no Visual Studio required). */
async function createSqliteClient(creds: Extract<DbCredentials, { type: 'sqlite' }>): Promise<DbClientInterface> {
    const resolvedPath = path.isAbsolute(creds.path) ? creds.path : path.resolve(process.cwd(), creds.path);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`SQLite database file not found: ${resolvedPath}`);
    }
    const buffer = fs.readFileSync(resolvedPath);
    let initSqlJs: (config?: { locateFile?: (f: string) => string }) => Promise<any>;
    try {
        initSqlJs = require('sql.js');
    } catch {
        throw new Error('SQLite support requires "sql.js". Run: npm install --save-dev sql.js');
    }
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(buffer));
    const rows: unknown[] = [];

    return {
        runQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
            rows.length = 0;
            const stmt = db.prepare(sql);
            try {
                stmt.bind(params as (number | string | null)[]);
                while (stmt.step()) {
                    rows.push(stmt.getAsObject());
                }
            } finally {
                stmt.free();
            }
            return Promise.resolve(rows.slice());
        },
        close(): void {
            try {
                db.close();
            } catch {
                // ignore
            }
        },
    };
}

/**
 * Set connection credentials for the current scenario (from Gherkin Given step).
 * Then steps will use this connection until the scenario ends.
 */
export function setScenarioConnection(creds: DbCredentials): void {
    scenarioCredentials = creds;
    if (scenarioClient) {
        scenarioClient.close();
        scenarioClient = null;
    }
}

/**
 * Close scenario DB connection and clear credentials. Call in After hook.
 */
export async function closeScenarioDb(): Promise<void> {
    if (scenarioClient) {
        await scenarioClient.close();
        scenarioClient = null;
    }
    scenarioCredentials = null;
}

/**
 * Returns a DB client: from scenario credentials (Given step) if set, else from config.
 * Throws if neither is configured or driver is missing.
 */
export async function getDbClient(): Promise<DbClientInterface> {
    if (scenarioCredentials) {
        if (!scenarioClient) {
            if (scenarioCredentials.type === 'pgsql') {
                scenarioClient = createPgClient(scenarioCredentials);
            } else {
                scenarioClient = await createSqliteClient(scenarioCredentials);
            }
        }
        return scenarioClient;
    }

    const config = loadConfig();
    if (!config) {
        throw new Error(
            'No database connection. Either use: Given the database connection: (with table of credentials) or add "db" in e2e/config/config.yaml. For PostgreSQL: npm install pg. For SQLite: npm install sql.js'
        );
    }

    if (configClient) return configClient;
    if (config.type === 'sqlite') {
        configClient = await createSqliteClient({ type: 'sqlite', path: config.path });
    } else if (config.type === 'pgsql') {
        configClient = createPgClient({
            type: 'pgsql',
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
        });
    }
    return configClient as DbClientInterface;
}

/** Safe identifier (table/column name) – alphanumeric and underscore only. */
export function safeIdentifier(name: string): string {
    const trimmed = String(name ?? '').trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        throw new Error(`Invalid identifier "${name}". Use only letters, numbers, and underscore.`);
    }
    return trimmed;
}

/**
 * Count rows in table, optionally with a single column = value filter.
 */
export async function countRows(tableName: string, column?: string, value?: string): Promise<number> {
    const client = await getDbClient();
    const table = safeIdentifier(tableName);
    let sql = `SELECT COUNT(*) AS cnt FROM ${table}`;
    const params: unknown[] = [];
    if (column != null && value !== undefined) {
        const col = safeIdentifier(column);
        sql += ` WHERE ${col} = ?`;
        params.push(value);
    }
    const rows = (await client.runQuery(sql, params)) as Array<{ cnt: number }>;
    return Number(rows[0]?.cnt ?? 0);
}

/**
 * Check if table has at least one row where column equals value.
 */
export async function tableContainsValue(tableName: string, column: string, value: string): Promise<boolean> {
    const n = await countRows(tableName, column, value);
    return n > 0;
}
