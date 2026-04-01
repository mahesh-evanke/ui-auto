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

function formatOneCapturedApi(c: CapturedApi): string {
  const method = String(c.method || '').toUpperCase();
  const url = c.fullUrl ? String(c.fullUrl) : urlToHostPlaceholder(c.url);

  const indent = '    ';
  const indentDt = '      ';

  if (method === 'GET') {
    return `${indent}Given User sends GET request to "${url}"\n${indent}Then User expects status code ${c.status}`;
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

  return `${indent}Given User sends ${method} request to "${url}"${bodyBlock}\n${indent}Then User expects status code ${c.status}`;
}

export function generateApiStepsFromCapturedApis(capturedApis: CapturedApi[]): string {
  const sorted = [...capturedApis].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const steps: string[] = [];
  for (const c of sorted) {
    if (!c.method || !c.url) continue;
    steps.push(formatOneCapturedApi(c));
  }
  return steps.join('\n');
}

export function generateFeatureFromCapturedApis(args: {
  capturedApis: CapturedApi[];
  featureName?: string;
  scenarioName?: string;
}): string {
  const featureName = args.featureName || 'Captured API Replay';
  const scenarioName = args.scenarioName || 'API calls';
  const apiSteps = generateApiStepsFromCapturedApis(args.capturedApis);

  return [`Feature: ${featureName}`, ``, `  Scenario: ${scenarioName}`, apiSteps, ``].join('\n');
}

