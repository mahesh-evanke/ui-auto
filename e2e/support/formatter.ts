/**
 * Formatting helpers for generating Cucumber feature files from captured APIs.
 */

import type { CapturedApi } from './capture';
import { jsonToDataTable } from './datatable';
import { urlToHostPlaceholder } from './matcher';
import type { DataTableKvRow } from './datatable';

function escapeGherkinCellValue(s: string): string {
  // We store values inside quotes in DataTable cells, so escape any embedded quotes.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatKvDataTable(rows: DataTableKvRow[]): string {
  const header = '| path  | value |';
  if (!rows.length) return `${header}\n`;
  const body = rows.map((r) => `| ${r.path} | "${escapeGherkinCellValue(String(r.value ?? ''))}" |`).join('\n');
  return `${header}\n${body}\n`;
}

function applyUrlAliases(url: string, aliases: Record<string, string>): string {
  for (const [name, base] of Object.entries(aliases)) {
    if (base && url.startsWith(base)) {
      return '${' + name + '}' + url.slice(base.length);
    }
  }
  return url;
}

/**
 * Strip the internal "raw" root token from response paths so the feature shows
 * clean paths that actually navigate the response body:
 *   raw[0].id  → [0].id      (array response — "0" in array is valid)
 *   raw.token  → token       (object response)
 *   raw        → value
 */
function stripRawPrefix(path: string): string {
  const p = String(path || '');
  if (p === 'raw') return 'value';
  return p.replace(/^raw(?=[.[])/, '').replace(/^\./, '') || 'value';
}

/** Build the optional "And User validates response has fields:" block from the response body. */
function formatResponseBlock(c: CapturedApi, indent: string, indentDt: string): string {
  const rows = jsonToDataTable(c.responseBody).map((r) => ({ path: stripRawPrefix(r.path), value: r.value }));
  if (!rows.length) return '';
  const table = formatKvDataTable(rows)
    .split('\n')
    .filter(Boolean)
    .map((line) => `${indentDt}${line}`)
    .join('\n');
  return `\n${indent}And User validates response has fields:\n${table}`;
}

export function formatOneCapturedApi(
  c: CapturedApi,
  aliases: Record<string, string> = {},
  indent = '    ',
  indentDt = '      ',
): string {
  const method = String(c.method || '').toUpperCase();
  const rawUrl = c.fullUrl ? String(c.fullUrl) : urlToHostPlaceholder(c.url);
  const url = applyUrlAliases(rawUrl, aliases);

  const responseBlock = formatResponseBlock(c, indent, indentDt);

  if (method === 'GET') {
    return `${indent}Given User sends GET request to "${url}"\n${indent}Then User expects status code ${c.status}${responseBlock}`;
  }

  const dtRows = jsonToDataTable(c.requestBody);
  let bodyBlock = '';
  if (dtRows.length) {
    const table = formatKvDataTable(dtRows)
      .split('\n')
      .filter(Boolean)
      .map((line) => `${indentDt}${line}`)
      .join('\n');
    bodyBlock = ` with body:\n${table}`;
  } else {
    // If we couldn't parse a JSON body, still emit a body step with a "raw" cell when present.
    if (c.requestBody !== undefined && c.requestBody !== null) {
      const rawRows: DataTableKvRow[] = [{ path: 'raw', value: String(c.requestBody) }];
      const table = formatKvDataTable(rawRows)
        .split('\n')
        .filter(Boolean)
        .map((line) => `${indentDt}${line}`)
        .join('\n');
      bodyBlock = ` with body:\n${table}`;
    }
  }

  return `${indent}Given User sends ${method} request to "${url}"${bodyBlock}\n${indent}Then User expects status code ${c.status}${responseBlock}`;
}

/**
 * One event per captured API for UI+API interleaving: a timestamp plus the
 * Gherkin rendered in "bare" indentation (step at col 0, datatable at col 2)
 * so buildFeatureContent can indent everything uniformly.
 */
export function apiEventsFromCaptured(
  capturedApis: CapturedApi[],
  urlAliases?: Record<string, string>,
): Array<{ timestamp: number; gherkin: string }> {
  const aliases = urlAliases ?? {};
  return [...capturedApis]
    .filter((c) => c.method && c.url)
    .map((c) => ({ timestamp: c.timestamp ?? 0, gherkin: formatOneCapturedApi(c, aliases, '', '  ') }));
}

export function generateApiStepsFromCapturedApis(
  capturedApis: CapturedApi[],
  urlAliases?: Record<string, string>,
): string {
  const aliases = urlAliases ?? {};
  const sorted = [...capturedApis].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const steps: string[] = [];
  for (const c of sorted) {
    if (!c.method || !c.url) continue;
    steps.push(formatOneCapturedApi(c, aliases));
  }
  return steps.join('\n');
}

export function generateFeatureFromCapturedApis(args: {
  capturedApis: CapturedApi[];
  featureName?: string;
  scenarioName?: string;
  urlAliases?: Record<string, string>;
}): string {
  const featureName = args.featureName || 'Captured API Replay';
  const scenarioName = args.scenarioName || 'API calls';
  const apiSteps = generateApiStepsFromCapturedApis(args.capturedApis, args.urlAliases);

  return [`Feature: ${featureName}`, ``, `  Scenario: ${scenarioName}`, apiSteps, ``].join('\n');
}

