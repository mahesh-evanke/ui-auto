/**
 * Web table verification helper for Playwright pages.
 * Table data is passed as plain string[][] (header row + data rows) - the
 * non-BDD equivalent of a Cucumber DataTable, since a spec.ts author just
 * writes the rows directly instead of a Gherkin table.
 */
import type { Frame, Locator, Page } from 'playwright';
import { resolveDynamicTokens } from './textHelper';

/** header row + data rows, e.g. [['Name','Age'],['John','30']] */
export type TableRows = string[][];

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
    .replace(/[^\p{L}\p{N}\s\-\/:.]/gu, '')
    .toLowerCase();
  return normalizeDateLike(t);
}

function normalizeDateLike(s: string): string {
  const t = s.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;

  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = slash[3];
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
  console.log(msg);
}

async function resolveTableRoot(page: Page, objName: string, getLocator?: (name: string) => Locator): Promise<Locator> {
  if (getLocator) {
    try {
      const loc = getLocator(objName);
      if ((await loc.count().catch(() => 0)) > 0) return loc;
    } catch {
      // fall through
    }
  }

  const findInScope = async (scope: Page | Frame): Promise<Locator | null> => {
    try {
      const byRole = scope.getByRole('table', { name: new RegExp(objName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
      if ((await byRole.count().catch(() => 0)) > 0) return byRole;
    } catch {
      /* next */
    }
    try {
      const byCaption = scope.locator(`table:has(caption)`).filter({ hasText: objName });
      if ((await byCaption.count().catch(() => 0)) > 0) return byCaption.first();
    } catch {
      /* next */
    }
    try {
      const byAria = scope.locator(`table[aria-label]`).filter({ hasText: objName });
      if ((await byAria.count().catch(() => 0)) > 0) return byAria.first();
    } catch {
      /* next */
    }
    try {
      const byId = scope.locator(`xpath=//*[@id=${JSON.stringify(objName)}]`);
      if ((await byId.count().catch(() => 0)) > 0) return byId;
    } catch {
      /* next */
    }
    try {
      const all = scope.locator('table');
      if ((await all.count().catch(() => 0)) === 1) return all.first();
    } catch {
      /* next */
    }
    return null;
  };

  for (const scope of [page, ...page.frames()] as Array<Page | Frame>) {
    const hit = await findInScope(scope);
    if (hit) return hit;
  }

  return page.locator(`xpath=//*[@id=${JSON.stringify(objName)}]`);
}

async function ensureTableElement(root: Locator): Promise<Locator> {
  const tag = await root.evaluate((el) => (el as Element).tagName.toLowerCase()).catch(() => '');
  if (tag === 'table') return root;
  const nested = root.locator('table').first();
  const count = await nested.count().catch(() => 0);
  return count > 0 ? nested : root;
}

async function readTableData(table: Locator): Promise<{ headers: string[]; rows: string[][] }> {
  try {
    await table.locator('tbody tr').first().waitFor({ state: 'attached', timeout: 20000 });
  } catch {
    try {
      await table.locator('tr').nth(1).waitFor({ state: 'attached', timeout: 5000 });
    } catch {
      /* proceed anyway */
    }
  }

  return table.evaluate((el) => {
    const tbl = el as HTMLTableElement;
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

    const getThText = (th: Element): string => {
      const titleAttr = (th as HTMLElement).title;
      if (titleAttr && titleAttr.trim()) return titleAttr.trim();
      const ariaLabel = th.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
      const titleSpan = th.querySelector('[class*="column-title"],[class*="col-title"],[class*="header-title"]');
      if (titleSpan && titleSpan.textContent?.trim()) return norm(titleSpan.textContent);
      const textNodes: string[] = [];
      th.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) textNodes.push(node.textContent || '');
      });
      const directText = norm(textNodes.join(''));
      if (directText) return directText;
      return norm((th.textContent || '').replace(/caret-up|caret-down|sort-asc|sort-desc|▲|▼/gi, ''));
    };

    const allTrs = Array.from(tbl.querySelectorAll('tr'));
    if (!allTrs.length) return { headers: [], rows: [] };

    const theadThs = Array.from(tbl.querySelectorAll('thead th'));
    const firstRowThs = Array.from(allTrs[0].querySelectorAll('th'));
    const thElements = theadThs.length ? theadThs : firstRowThs;

    let headers: string[] = [];
    if (thElements.length) headers = thElements.map((th) => getThText(th));

    const bodyTrs = Array.from(tbl.querySelectorAll('tbody tr'));
    const dataRows = bodyTrs.length > 0 ? bodyTrs : allTrs.slice(thElements.length > 0 ? 1 : 0);

    const rows = dataRows
      .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => norm(td.textContent || '')))
      .filter((r) => r.some((cell) => cell !== ''));

    return { headers, rows };
  });
}

type ExpectedRow = Record<string, string>;

function tableRowsToExpectedRows(rows: TableRows): ExpectedRow[] {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((h) => normalizeSpaces(h));
  return rows.slice(1).map((row) => {
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
  if (!e) return true;
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

/**
 * Verifies expected rows appear in a table. `rows` is [header, ...dataRows]
 * e.g. verifyWebTable(page, 'Orders', [['Name','Qty'],['Widget','2']])
 */
export async function verifyWebTable(
  page: Page,
  objName: string,
  rows: TableRows,
  deps?: { getLocator?: (name: string) => Locator },
  options?: WebTableVerifyOptions,
): Promise<void> {
  const debug = shouldDebug(options?.debug);
  const headerDriven = options?.headerDriven !== false;
  const strict = Boolean(options?.strict);
  const unordered = Boolean(options?.unordered);

  const root = await resolveTableRoot(page, objName, deps?.getLocator);
  const table = await ensureTableElement(root);

  const expectedRows = tableRowsToExpectedRows(rows);
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
    const expectedCells: Array<{ idx: number; expected: string; header: string }> = [];

    for (const h of expectedHeaders) {
      const expVal = expected[h];
      if (!headerDriven || headers.length === 0) {
        const idx = expectedCells.length;
        expectedCells.push({ idx, expected: expVal, header: h });
        continue;
      }
      const idx = headerIndex.get(normalizeComparable(h));
      if (idx === undefined) {
        throw new Error(`[verifyWebTable] Header "${h}" not found in table.\nDetected: ${JSON.stringify(headers)}\nTable: ${objName}`);
      }
      expectedCells.push({ idx, expected: expVal, header: h });
    }

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

  let cursor = 0;
  for (const exp of resolvedExpectedRows) {
    const { foundIndex, bestIndex, bestScore } = (() => {
      const slice = allRows.slice(cursor);
      let bestI = -1;
      let bestS = -1;

      const expectedHeaders = Object.keys(exp).map((h) => normalizeSpaces(h));
      const expectedCells: Array<{ idx: number; expected: string }> = [];
      for (const h of expectedHeaders) {
        const idx = headerDriven && headers.length ? headerIndex.get(normalizeComparable(h)) : expectedCells.length;
        if (idx === undefined) {
          throw new Error(`[verifyWebTable] Header "${h}" not found in table.\nDetected: ${JSON.stringify(headers)}\nTable: ${objName}`);
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
