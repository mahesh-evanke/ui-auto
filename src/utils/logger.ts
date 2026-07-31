/**
 * Pretty console reports for validator results - one place so
 * expectRowsToMatch()/expectDatabaseToMatch() (and specs that call the
 * validators directly) all render the same format.
 */
import type { TableComparisonResult } from '../models';
import type { ApiChainReport } from '../api/chainAnalyzer';
import { redactHeaders } from '../api/capture';

const BAR = '='.repeat(60);

/** Prints a table/row comparison report, e.g. after compareTables()/validateDatabaseRows(). */
export function logTableComparisonReport(title: string, result: TableComparisonResult, counts?: Record<string, number>): void {
  console.log(BAR);
  console.log(title);
  if (counts) {
    for (const [label, count] of Object.entries(counts)) console.log(`${label} : ${count}`);
  } else {
    console.log(`EXPECTED ROWS : ${result.expectedCount}`);
    console.log(`ACTUAL ROWS   : ${result.actualCount}`);
  }
  console.log(BAR);
  for (const row of result.rows) {
    console.log(`Row ${row.rowIndex + 1} ${row.matched ? '✓' : '✗'}`);
    for (const diff of row.differences) {
      console.log(`  Field ${diff.path || '(root)'}`);
      console.log(`    Expected : ${JSON.stringify(diff.expected)}`);
      console.log(`    Actual   : ${JSON.stringify(diff.actual)}`);
    }
  }
  console.log(BAR);
}

/** Prints a single-object comparison report, e.g. after compareObjects(). */
export function logObjectComparisonReport(title: string, differences: Array<{ path: string; expected: unknown; actual: unknown }>): void {
  console.log(BAR);
  console.log(title);
  console.log(BAR);
  if (differences.length === 0) {
    console.log('✓ matched');
  } else {
    for (const diff of differences) {
      console.log(`✗ Field ${diff.path || '(root)'}`);
      console.log(`    Expected : ${JSON.stringify(diff.expected)}`);
      console.log(`    Actual   : ${JSON.stringify(diff.actual)}`);
    }
  }
  console.log(BAR);
}

/** Prints an API-chain analysis - the calls and the detected output->input field links - for the user to review and correct. */
export function printApiChainReport(report: ApiChainReport): void {
  const bar = '='.repeat(60);
  console.log(bar);
  console.log('API CHAIN ANALYSIS');
  console.log(bar);
  for (const c of report.calls) console.log(`[${c.index}] ${c.method} ${c.url} -> ${c.status}`);
  console.log('-'.repeat(60));
  if (report.links.length === 0) {
    console.log('No output -> input field links detected.');
  } else {
    console.log('Detected links (response field -> later request field):');
    for (const link of report.links) {
      const strength = link.matchType === 'value' ? 'value+name' : 'name only, review';
      console.log(`  [${link.fromCall}] ${link.fromPath}  ->  [${link.toCall}] ${link.toPath}   (${link.field}, ${strength})`);
    }
  }
  console.log(bar);
}

/**
 * Logs one API call's method/URL/headers/status/execution time - used by
 * ApiActions.sendRequest()/expectStatus(). Header values are redacted
 * (Authorization/Cookie) the same way capture.ts redacts captured network
 * traffic - console output (and CI logs) must never contain a real bearer
 * token or session cookie, even in a passing test's log.
 */
export function logApiCall(args: { method: string; url: string; requestHeaders?: Record<string, string>; status?: number; durationMs?: number }): void {
  const parts = [`[api] ${args.method} ${args.url}`];
  if (args.status !== undefined) parts.push(`-> ${args.status}`);
  if (args.durationMs !== undefined) parts.push(`(${args.durationMs}ms)`);
  console.log(parts.join(' '));
  if (args.requestHeaders) console.log(`  headers: ${JSON.stringify(redactHeaders(args.requestHeaders))}`);
}
