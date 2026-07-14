/**
 * Web table verification helper for Playwright pages using Cucumber DataTable.
 * Designed to be called from step definitions without breaking existing flows.
 */
import type { DataTable } from '@cucumber/cucumber';
import type { Frame, Locator, Page } from 'playwright';
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
  // 1. YAML locator registry (page-scoped)
  if (getLocator) {
    try {
      const loc = getLocator(objName);
      if ((await loc.count().catch(() => 0)) > 0) return loc;
    } catch {
      // fall through
    }
  }

  // Run the name-based strategies against a given scope (page or iframe).
  const findInScope = async (scope: Page | Frame): Promise<Locator | null> => {
    // ARIA role table with matching name
    try {
      const byRole = scope.getByRole('table', { name: new RegExp(objName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
      if ((await byRole.count().catch(() => 0)) > 0) return byRole;
    } catch { /* next */ }
    // <table> whose <caption> matches
    try {
      const byCaption = scope.locator(`table:has(caption)`).filter({ hasText: objName });
      if ((await byCaption.count().catch(() => 0)) > 0) return byCaption.first();
    } catch { /* next */ }
    // <table> with aria-label matching
    try {
      const byAria = scope.locator(`table[aria-label]`).filter({ hasText: objName });
      if ((await byAria.count().catch(() => 0)) > 0) return byAria.first();
    } catch { /* next */ }
    // id attribute
    try {
      const byId = scope.locator(`xpath=//*[@id=${JSON.stringify(objName)}]`);
      if ((await byId.count().catch(() => 0)) > 0) return byId;
    } catch { /* next */ }
    // Only one table in this scope — use it
    try {
      const all = scope.locator('table');
      if ((await all.count().catch(() => 0)) === 1) return all.first();
    } catch { /* next */ }
    return null;
  };

  // 2. Try the main page, then every iframe.
  for (const scope of [page, ...page.frames()] as Array<Page | Frame>) {
    const hit = await findInScope(scope);
    if (hit) return hit;
  }

  // 3. Last resort — id-based selector on the page (fails with a clear message).
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

async function readTableData(table: Locator): Promise<{ headers: string[]; rows: string[][] }> {
  // Wait for a data row (tbody tr) — header renders immediately but data loads async
  try {
    await table.locator('tbody tr').first().waitFor({ state: 'attached', timeout: 20000 });
  } catch {
    // No tbody tr — fall back to waiting for any tr (plain tables, no tbody)
    try {
      await table.locator('tr').nth(1).waitFor({ state: 'attached', timeout: 5000 });
    } catch { /* proceed anyway */ }
  }

  return table.evaluate((el) => {
    const tbl = el as HTMLTableElement;
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

    // Extract clean header text from a <th> — handles Ant Design, Material UI, plain HTML
    const getThText = (th: Element): string => {
      // 1. title attribute — Ant Design uses this for ellipsis columns (e.g. title="ID #")
      const titleAttr = (th as HTMLElement).title;
      if (titleAttr && titleAttr.trim()) return titleAttr.trim();

      // 2. aria-label — Ant Design sortable columns set this (e.g. aria-label="Name")
      const ariaLabel = th.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      // 3. Component-library column-title span (Ant Design, react-table wrappers)
      const titleSpan = th.querySelector('[class*="column-title"],[class*="col-title"],[class*="header-title"]');
      if (titleSpan && titleSpan.textContent?.trim()) return norm(titleSpan.textContent);

      // 4. scope="col" plain th — strip SVG/icon text by reading only text nodes
      const textNodes: string[] = [];
      th.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) textNodes.push(node.textContent || '');
      });
      const directText = norm(textNodes.join(''));
      if (directText) return directText;

      // 5. Full textContent fallback — remove known icon aria-labels that bleed in
      return norm((th.textContent || '').replace(/caret-up|caret-down|sort-asc|sort-desc|▲|▼/gi, ''));
    };

    // Collect all rows
    const allTrs = Array.from(tbl.querySelectorAll('tr'));
    if (!allTrs.length) return { headers: [], rows: [] };

    // Extract headers from <thead th> first, then first-row <th>
    const theadThs = Array.from(tbl.querySelectorAll('thead th'));
    const firstRowThs = Array.from(allTrs[0].querySelectorAll('th'));
    const thElements = theadThs.length ? theadThs : firstRowThs;

    let headers: string[] = [];
    if (thElements.length) {
      headers = thElements.map(th => getThText(th));
    }

    // Data rows from <tbody tr> — fall back to all tr except header row
    const bodyTrs = Array.from(tbl.querySelectorAll('tbody tr'));
    const dataRows = bodyTrs.length > 0
      ? bodyTrs
      : allTrs.slice(thElements.length > 0 ? 1 : 0);

    const rows = dataRows
      .map(tr => Array.from(tr.querySelectorAll('td')).map(td => norm(td.textContent || '')))
      .filter(r => r.some(cell => cell !== ''));  // skip fully-empty rows

    return { headers, rows };
  });
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

  const { headers, rows: allRows } = await readTableData(table);
  log(debug, `[verifyWebTable] Table "${objName}" headers detected: ${JSON.stringify(headers)}`);
  log(debug, `[verifyWebTable] Cached ${allRows.length} data rows`);

  const headerIndex = buildHeaderIndex(headers);

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
  // Delegates to the shared resolver (supports <CURRENT_DATE,1Y,-1M,7D>:dd/mm/yyyy
  // etc.) but keeps this call site's own historical default format (mm/dd/yyyy)
  // for bare <CURRENT_DATE>/<CURRENT_DATE+N> tokens, so existing table
  // expectations that rely on that default keep matching unchanged.
  return resolveDynamicTokens(String(raw ?? ''), now, 'mm/dd/yyyy');
}

function cellTextMatches(actualRaw: string, expectedRaw: string, now: Date): boolean {
  const resolved = resolveExpectedCellRaw(String(expectedRaw ?? ''), now);
  const e = normalizeLoose(resolved);
  if (!e) return true;
  const a = normalizeLoose(actualRaw);
  if (!a) return false;
  // Strict mode for "verify data from ... web table":
  // the normalized actual cell must equal the normalized expected cell.
  // This prevents accidental matches like "Name" matching "Nameee".
  return a === e;
}

function findHeaderColumnIndex(
  expectedHeaderNorm: string,
  expectedHeaderRaw: string,
  actualHeaders: string[],
): number {
  const norms = actualHeaders.map((h) => normalizeForRawTableCell(String(h ?? '')));
  let idx = norms.indexOf(expectedHeaderNorm);
  if (idx >= 0) return idx;
  // Strict header mapping: only exact match on normalized header text.
  // If the header doesn't match, fail with "Header ... not found".
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

  // Optimize strict matching:
  // - Normalize expected cells once (date tokens resolved).
  // - Normalize actual table rows once for the selected columns.
  // - Then do exact string equality checks during the ordered subsequence search.
  const expectedDataRows = expected.slice(1);
  const expectedNormCells: Array<Array<string | null>> = expectedDataRows.map((row) =>
    selectedColIdx.map((_, j) => {
      const expectedRaw = String(row[j] ?? '');
      const resolved = resolveExpectedCellRaw(expectedRaw, now);
      const n = normalizeLoose(resolved);
      return n ? n : null; // null => expected empty => don't care
    }),
  );

  const bodyNormSelected: string[][] = bodyRows.map((row) =>
    selectedColIdx.map((col) => normalizeLoose(String(row[col] ?? ''))),
  );

  let searchStart = 0;
  for (let expIdx = 0; expIdx < expectedDataRows.length; expIdx++) {
    const expectedRow = expectedDataRows[expIdx];
    let foundAt = -1;

    for (let r = searchStart; r < bodyRows.length; r++) {
      const actualNormRow = bodyNormSelected[r];
      let allOk = true;

      for (let j = 0; j < selectedColIdx.length; j++) {
        const eNorm = expectedNormCells[expIdx][j];
        if (eNorm === null) continue; // expected empty => ignore
        const aNorm = actualNormRow[j] ?? '';
        if (!aNorm || aNorm !== eNorm) {
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
      const sample = bodyRows
        .slice(0, 8)
        .map((row) => selectedColIdx.map((c) => (row[c] ?? '').trim()));
      throw new Error(
        `Expected row not found in table "${objName}": ${JSON.stringify(expectedRow)} (columns: ${JSON.stringify(
          expected[0],
        )}). ` +
          `Sample rows (selected columns only, first up to 8): ${JSON.stringify(sample)}. ` +
          `If names are on another page, navigate or filter until they are visible.`,
      );
    }

    searchStart = foundAt + 1;
  }
}