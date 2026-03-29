/**
 * Web table verification helper for Playwright pages using Cucumber DataTable.
 * Designed to be called from step definitions without breaking existing flows.
 */
import type { DataTable } from '@cucumber/cucumber';
import type { Locator, Page } from 'playwright';
import { resolveDynamicTokens } from './textHelper';

export type WebTableVerifyOptions = {
  /** Enable debug logs. Default reads VERIFY_DEBUG env. */
  debug?: boolean;
  /** If true, match columns by header names; if false, allows partial/positional. Default true. */
  headerDriven?: boolean;
  /** If true, match rows ignoring order. Default false (ordered subsequence). */
  unordered?: boolean;
  /** If true, cell compare is exact; else contains. Default false. */
  strict?: boolean;
};

function shouldDebug(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  return String(process.env.VERIFY_DEBUG || '').toLowerCase() === 'true';
}

function normalizeSpaces(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeComparable(s: string): string {
  const t = normalizeSpaces(s)
    .replace(/[^\p{L}\p{N}\s\-\/:.]/gu, '') // remove most special chars, keep common date separators
    .toLowerCase();
  return normalizeDateLike(t);
}

function normalizeDateLike(s: string): string {
  // Best-effort normalization for common patterns:
  // - dd/mm/yyyy or mm/dd/yyyy -> yyyy-mm-dd (ambiguous; only convert if unambiguous)
  // - yyyy-mm-dd stays as is
  const t = s.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;

  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = slash[3];
    // Convert only if day/month is obvious (one part > 12)
    const day = a > 12 ? a : b > 12 ? b : null;
    const month = a > 12 ? b : b > 12 ? a : null;
    if (day && month) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return t;
}

function log(debug: boolean, msg: string): void {
  if (!debug) return;
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function resolveTableRoot(page: Page, objName: string, getLocator?: (name: string) => Locator): Promise<Locator> {
  if (getLocator) {
    try {
      return getLocator(objName);
    } catch {
      // fallback below
    }
  }
  // Fallback: //*[@id='objName']
  return page.locator(`xpath=//*[@id=${JSON.stringify(objName)}]`);
}

async function ensureTableElement(root: Locator): Promise<Locator> {
  // If root itself is table, use it; otherwise search within.
  const tag = await root.evaluate((el) => (el as Element).tagName.toLowerCase()).catch(() => '');
  if (tag === 'table') return root;
  const nested = root.locator('table').first();
  const count = await nested.count().catch(() => 0);
  return count > 0 ? nested : root;
}

async function getHeaderTexts(table: Locator): Promise<string[]> {
  const headerLoc = table.locator('thead tr th');
  const count = await headerLoc.count();
  if (count === 0) return [];
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = await headerLoc.nth(i).innerText().catch(() => '');
    texts.push(normalizeSpaces(t));
  }
  return texts;
}

type ExpectedRow = Record<string, string>;

function dataTableToExpectedRows(dt: DataTable): ExpectedRow[] {
  // Prefer hashes() (header row + rows)
  try {
    const hashes = dt.hashes();
    if (Array.isArray(hashes) && hashes.length) {
      return hashes.map((r) => {
        const out: ExpectedRow = {};
        for (const [k, v] of Object.entries(r)) out[normalizeSpaces(k)] = String(v ?? '');
        return out;
      });
    }
  } catch {
    // ignore
  }

  // Fallback: raw() with first row as header
  const raw = dt.raw();
  if (!raw || raw.length < 2) return [];
  const headers = raw[0].map((h) => normalizeSpaces(h));
  return raw.slice(1).map((row) => {
    const out: ExpectedRow = {};
    headers.forEach((h, idx) => (out[h] = String(row[idx] ?? '')));
    return out;
  });
}

function buildHeaderIndex(headers: string[]): Map<string, number> {
  const m = new Map<string, number>();
  headers.forEach((h, i) => m.set(normalizeComparable(h), i));
  return m;
}

function compareCell(actual: string, expected: string, strict: boolean): boolean {
  const a = normalizeComparable(actual);
  const e = normalizeComparable(expected);
  if (!e) return true; // allow partial column validation: empty expected means "ignore"
  return strict ? a === e : a.includes(e);
}

function scoreRow(actualCells: string[], expectedCells: Array<{ idx: number; expected: string }>, strict: boolean): number {
  let score = 0;
  for (const c of expectedCells) {
    const a = actualCells[c.idx] ?? '';
    if (compareCell(a, c.expected, strict)) score++;
  }
  return score;
}

export async function verifyWebTable(
  page: Page,
  objName: string,
  dataTable: DataTable,
  deps?: { getLocator?: (name: string) => Locator },
  options?: WebTableVerifyOptions,
): Promise<void> {
  const debug = shouldDebug(options?.debug);
  const headerDriven = options?.headerDriven !== false;
  const strict = Boolean(options?.strict);
  const unordered = Boolean(options?.unordered);

  const root = await resolveTableRoot(page, objName, deps?.getLocator);
  const table = await ensureTableElement(root);

  const expectedRows = dataTableToExpectedRows(dataTable);
  if (!expectedRows.length) throw new Error(`No expected rows provided for table "${objName}"`);

  const headers = await getHeaderTexts(table);
  log(debug, `[verifyWebTable] Table "${objName}" headers detected: ${JSON.stringify(headers)}`);

  const headerIndex = buildHeaderIndex(headers);

  // Cache DOM rows once (performance)
  const rowLoc = table.locator('tbody tr');
  const rowCount = await rowLoc.count();
  const allRows: string[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = await rowLoc.nth(r).locator('td').allInnerTexts().catch(async () => rowLoc.nth(r).allInnerTexts());
    allRows.push((cells || []).map((c) => normalizeSpaces(c)));
  }
  log(debug, `[verifyWebTable] Cached ${allRows.length} data rows`);

  const now = new Date();
  const resolvedExpectedRows = expectedRows.map((row) => {
    const out: ExpectedRow = {};
    for (const [k, v] of Object.entries(row)) out[k] = resolveDynamicTokens(String(v ?? ''), now);
    return out;
  });

  const findMatchingRowIndex = (expected: ExpectedRow): { foundIndex: number; bestIndex: number; bestScore: number } => {
    const expectedHeaders = Object.keys(expected).map((h) => normalizeSpaces(h));
    log(debug, `[verifyWebTable] Expected headers: ${JSON.stringify(expectedHeaders)}`);

    const expectedCells: Array<{ idx: number; expected: string; header: string }> = [];

    for (const h of expectedHeaders) {
      const expVal = expected[h];
      if (!headerDriven || headers.length === 0) {
        // If no headers or not header-driven, treat expected as positional by insertion order (best-effort)
        const idx = expectedCells.length;
        expectedCells.push({ idx, expected: expVal, header: h });
        continue;
      }
      const idx = headerIndex.get(normalizeComparable(h));
      if (idx === undefined) {
        throw new Error(
          `[verifyWebTable] Header "${h}" not found in table.\nDetected: ${JSON.stringify(headers)}\nTable: ${objName}`,
        );
      }
      expectedCells.push({ idx, expected: expVal, header: h });
    }

    log(
      debug,
      `[verifyWebTable] Column mapping: ${JSON.stringify(expectedCells.map((c) => ({ header: c.header, colIndex: c.idx })))}`,
    );

    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < allRows.length; i++) {
      const score = scoreRow(allRows[i], expectedCells.map((c) => ({ idx: c.idx, expected: c.expected })), strict);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      if (score === expectedCells.length) return { foundIndex: i, bestIndex, bestScore };
    }

    return { foundIndex: -1, bestIndex, bestScore };
  };

  if (unordered) {
    for (const exp of resolvedExpectedRows) {
      const { foundIndex, bestIndex, bestScore } = findMatchingRowIndex(exp);
      if (foundIndex === -1) {
        throw new Error(
          `[verifyWebTable] Expected row not found in table "${objName}".\nExpected: ${JSON.stringify(exp)}\nClosest: ${
            bestIndex >= 0 ? JSON.stringify(allRows[bestIndex]) : 'N/A'
          }\nScore: ${bestScore}`,
        );
      }
      log(debug, `[verifyWebTable] Matched expected row (unordered) at index ${foundIndex}`);
    }
    return;
  }

  // Ordered subsequence: expected rows must appear in order (not necessarily contiguous)
  let cursor = 0;
  for (const exp of resolvedExpectedRows) {
    const { foundIndex, bestIndex, bestScore } = (() => {
      const slice = allRows.slice(cursor);
      // Reuse scoring logic but on slice; adjust indices back.
      let bestI = -1;
      let bestS = -1;

      // Build expected mapping once
      const expectedHeaders = Object.keys(exp).map((h) => normalizeSpaces(h));
      const expectedCells: Array<{ idx: number; expected: string }> = [];
      for (const h of expectedHeaders) {
        const idx = headerDriven && headers.length ? headerIndex.get(normalizeComparable(h)) : expectedCells.length;
        if (idx === undefined) {
          throw new Error(
            `[verifyWebTable] Header "${h}" not found in table.\nDetected: ${JSON.stringify(headers)}\nTable: ${objName}`,
          );
        }
        expectedCells.push({ idx, expected: exp[h] });
      }

      for (let i = 0; i < slice.length; i++) {
        const score = scoreRow(slice[i], expectedCells, strict);
        if (score > bestS) {
          bestS = score;
          bestI = i;
        }
        if (score === expectedCells.length) return { foundIndex: cursor + i, bestIndex: cursor + bestI, bestScore: bestS };
      }
      return { foundIndex: -1, bestIndex: cursor + bestI, bestScore: bestS };
    })();

    if (foundIndex === -1) {
      throw new Error(
        `[verifyWebTable] Expected row not found in order in table "${objName}".\nExpected: ${JSON.stringify(exp)}\nClosest: ${
          bestIndex >= 0 ? JSON.stringify(allRows[bestIndex]) : 'N/A'
        }\nScore: ${bestScore}`,
      );
    }
    log(debug, `[verifyWebTable] Matched expected row at index ${foundIndex}`);
    cursor = foundIndex + 1;
  }
}

/** Normalize cell/header text for raw-table step (aligned with legacy WDIO removeSpecial-style compare). */
function normalizeForRawTableCell(s: string): string {
  return normalizeComparable(s);
}

function rawTableCellPresent(actualNorm: string, expectedNorm: string): boolean {
  if (!expectedNorm) return true;
  if (actualNorm === expectedNorm) return true;
  if (actualNorm.includes(expectedNorm)) return true;
  if (expectedNorm.includes(actualNorm)) return true;
  return false;
}

function normalizeLoose(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveExpectedCellRaw(raw: string, now: Date): string {
  let out = String(raw ?? '');
  out = out.replace(/<CURRENT_DATE\s*\+\s*([0-9]+)\s*>/gi, (_m, nRaw) => {
    const n = Number(nRaw);
    const d = new Date(now);
    d.setDate(d.getDate() + (Number.isFinite(n) ? n : 0));
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  });
  if (/<CURRENT_DATE>/i.test(out)) {
    const d = new Date(now);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    out = out.replace(/<CURRENT_DATE>/gi, `${mm}/${dd}/${yyyy}`);
  }
  return out;
}

function cellTextMatches(actualRaw: string, expectedRaw: string, now: Date): boolean {
  const resolved = resolveExpectedCellRaw(String(expectedRaw ?? ''), now);
  const e = normalizeLoose(resolved);
  if (!e) return true;
  const a = normalizeLoose(actualRaw);
  if (!a) return false;
  if (a === e || a.includes(e) || e.includes(a)) return true;
  const an = normalizeForRawTableCell(actualRaw);
  const en = normalizeForRawTableCell(resolved);
  return rawTableCellPresent(an, en);
}

function findHeaderColumnIndex(
  expectedHeaderNorm: string,
  expectedHeaderRaw: string,
  actualHeaders: string[],
): number {
  const norms = actualHeaders.map((h) => normalizeForRawTableCell(String(h ?? '')));
  let idx = norms.indexOf(expectedHeaderNorm);
  if (idx >= 0) return idx;
  const needle = normalizeLoose(expectedHeaderRaw);
  for (let j = 0; j < actualHeaders.length; j++) {
    const h = normalizeLoose(actualHeaders[j]);
    if (h === needle || h.includes(needle) || needle.includes(h)) return j;
  }
  return -1;
}

export type WebTableDataFromDeps = {
  getTableRoot: () => Locator;
};

/**
 * Simple presence check: DataTable header row picks columns; each following row must appear
 * in table body in order (subsequence), with each selected cell containing / matching expected text.
 */
export async function verifyWebTableDataFrom(
  page: Page,
  objName: string,
  dataTable: DataTable,
  deps: WebTableDataFromDeps,
): Promise<void> {
  await page.waitForTimeout(250);

  await page
    .waitForURL((url) => !String(url.pathname).includes('login'), { timeout: 45000 })
    .catch(() => undefined);

  const root = deps.getTableRoot();
  const tableEl = await ensureTableElement(root);

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await tableEl.locator('tr').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);

  const dataReadyDeadline = Date.now() + 45000;
  while (Date.now() < dataReadyDeadline) {
    const nTbody = await tableEl.locator('tbody tr').count();
    const nTdRows = await tableEl.locator('tr:has(td)').count();
    const trTotal = await tableEl.locator('tr').count();
    if (nTbody > 0 || nTdRows > 0 || trTotal > 1) break;
    await page.waitForTimeout(400);
  }

  const expected = dataTable.raw();
  if (!expected || expected.length === 0) {
    throw new Error('Expected DataTable must have at least a header row.');
  }

  const deadline = Date.now() + 20000;
  let rowLoc = tableEl.locator('tr');
  let rowMode: 'tr' | 'role' = 'tr';
  let rowCount = await rowLoc.count();
  while (rowCount === 0 && Date.now() < deadline) {
    await page.waitForTimeout(200);
    rowCount = await rowLoc.count();
  }
  if (rowCount === 0) {
    const anyTr = page.locator(`xpath=//*[@id=${JSON.stringify(objName)}]//tr`);
    const alt = await anyTr.count().catch(() => 0);
    if (alt > 0) {
      rowLoc = anyTr;
      rowCount = alt;
    }
  }
  if (rowCount === 0) {
    rowLoc = tableEl.locator('[role="row"]');
    rowMode = 'role';
    rowCount = await rowLoc.count();
    let w = 0;
    while (rowCount === 0 && w < 100) {
      await page.waitForTimeout(200);
      rowCount = await rowLoc.count();
      w++;
    }
  }
  if (rowCount === 0) {
    throw new Error(`No table rows found for "${objName}" (no <tr> or [role="row"] under resolved root).`);
  }

  const headerRowLoc =
    rowMode === 'tr' && (await tableEl.locator('thead').count()) > 0
      ? tableEl.locator('thead tr').first()
      : rowLoc.first();
  await headerRowLoc.scrollIntoViewIfNeeded().catch(() => undefined);

  const headerCellSel = rowMode === 'tr' ? 'th, td' : '[role="columnheader"], [role="gridcell"], [role="cell"], th, td';
  const headerCells = headerRowLoc.locator(headerCellSel);
  const headerCount = await headerCells.count();
  const actualHeaders: string[] = [];
  for (let i = 0; i < headerCount; i++) {
    const t = await headerCells.nth(i).innerText().catch(() => '');
    actualHeaders.push(t);
  }

  const selectedColIdx: number[] = [];
  for (let hi = 0; hi < expected[0].length; hi++) {
    const rawH = String(expected[0][hi] ?? '').trim();
    const normH = normalizeForRawTableCell(rawH);
    const idx = findHeaderColumnIndex(normH, rawH, actualHeaders);
    if (idx < 0) {
      throw new Error(`Header "${rawH}" not found in actual table headers: ${JSON.stringify(actualHeaders)}`);
    }
    selectedColIdx.push(idx);
  }

  const now = new Date();
  const bodyCellSel =
    rowMode === 'tr' ? 'td' : '[role="gridcell"], [role="cell"], td, th';

  await tableEl.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.keyboard.press('End').catch(() => undefined);
  await page.waitForTimeout(800);
  rowLoc = tableEl.locator('tr');
  rowCount = await rowLoc.count();

  const collectOneRowRaw = async (line: Locator): Promise<string[]> => {
    let cells = rowMode === 'tr' ? line.locator('td') : line.locator(bodyCellSel);
    let cc = await cells.count();
    if (rowMode === 'tr' && cc === 0) {
      cells = line.locator('th, td');
      cc = await cells.count();
    }
    const texts: string[] = [];
    for (let c = 0; c < cc; c++) {
      const t = await cells.nth(c).innerText().catch(() => '');
      texts.push(t);
    }
    return texts;
  };

  const extractBodyRowsInPage = async (): Promise<string[][]> => {
    if (rowMode !== 'tr') return [];
    return tableEl.evaluate((table) => {
      const rows: string[][] = [];
      let trs = Array.from(table.querySelectorAll('tbody tr'));
      if (trs.length === 0) {
        const all = Array.from(table.querySelectorAll('tr'));
        trs = all.slice(1);
      }
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length === 0) continue;
        rows.push(tds.map((td) => String((td as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()));
      }
      return rows;
    });
  };

  const loadBodyRows = async (): Promise<string[][]> => {
    const rows: string[][] = [];
    if (rowMode === 'tr') {
      const tryTbody = tableEl.locator('tbody tr');
      let n = await tryTbody.count();
      let lineLoc = tryTbody;
      if (n === 0) {
        lineLoc = tableEl.locator('tr:has(td)');
        n = await lineLoc.count();
      }
      if (n === 0) {
        lineLoc = tableEl.locator('xpath=.//tr[td]');
        n = await lineLoc.count();
      }
      if (n > 0) {
        for (let r = 0; r < n; r++) {
          rows.push(await collectOneRowRaw(lineLoc.nth(r)));
        }
        return rows;
      }
      for (let r = 1; r < rowCount; r++) {
        rows.push(await collectOneRowRaw(rowLoc.nth(r)));
      }
      return rows;
    }
    for (let r = 1; r < rowCount; r++) {
      rows.push(await collectOneRowRaw(rowLoc.nth(r)));
    }
    return rows;
  };

  let bodyRows: string[][] = [];
  try {
    bodyRows = await extractBodyRowsInPage();
  } catch {
    bodyRows = [];
  }
  if (bodyRows.length === 0) {
    bodyRows = await loadBodyRows();
  }
  const loadDeadline = Date.now() + 20000;
  while (bodyRows.length === 0 && Date.now() < loadDeadline) {
    await page.waitForTimeout(400);
    try {
      bodyRows = await extractBodyRowsInPage();
    } catch {
      bodyRows = [];
    }
    if (bodyRows.length === 0) bodyRows = await loadBodyRows();
  }
  if (bodyRows.length === 0) {
    const tbodyN = await tableEl.locator('tbody tr').count();
    const trN = await tableEl.locator('tr').count();
    const tdN = await tableEl.locator('td').count();
    throw new Error(
      `No data rows under table "${objName}" (tbody tr=${tbodyN}, tr=${trN}, td=${tdN}). Check locator in locators/pages/<screen>.yaml.`,
    );
  }

  let searchStart = 0;
  for (let i = 1; i < expected.length; i++) {
    let foundAt = -1;
    for (let r = searchStart; r < bodyRows.length; r++) {
      const actualRow = bodyRows[r];
      let allOk = true;
      for (let j = 0; j < selectedColIdx.length; j++) {
        const col = selectedColIdx[j];
        const actualRaw = actualRow[col] ?? '';
        const expectedRaw = String(expected[i][j] ?? '');
        if (!cellTextMatches(actualRaw, expectedRaw, now)) {
          allOk = false;
          break;
        }
      }
      if (allOk) {
        foundAt = r;
        break;
      }
    }
    if (foundAt < 0) {
      const sample = bodyRows.slice(0, 8).map((row) => selectedColIdx.map((c) => (row[c] ?? '').trim()));
      throw new Error(
        `Expected row not found in table "${objName}": ${JSON.stringify(expected[i])} (columns: ${JSON.stringify(expected[0])}). ` +
          `Sample rows (selected columns only, first up to 8): ${JSON.stringify(sample)}. ` +
          `If names are on another page, navigate or filter until they are visible.`,
      );
    }
    searchStart = foundAt + 1;
  }
}

