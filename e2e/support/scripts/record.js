'use strict';
/**
 * record.js  —  one-command recorder + auto-converter
 *
 * Usage:  npm run record
 *
 * ┌─ Flow ──────────────────────────────────────────────────────────────────────┐
 * │                                                                              │
 * │  npm run record                                                              │
 * │       │                                                                      │
 * │       ▼  config browser (our panel)                                          │
 * │  User fills: file name · mode · start URL · API filters · save spec toggle  │
 * │       │ clicks ▶ Start Recording                                             │
 * │       │                                                                      │
 * │  UI mode  ──► npx playwright codegen  (Playwright Inspector + Browser)      │
 * │               User records · closes browser                                  │
 * │               specParser.ts → RecordedAction[] → .feature + .yaml           │
 * │               [optional] → e2e/spec/generated/<cat>/<name>.spec.ts          │
 * │                                                                              │
 * │  API / UI+API  ──► programmatic browser with 🔴 REC toolbar                 │
 * │               page.on(request/response) + injected JS events                 │
 * │               User clicks Stop → .feature [+ .yaml]                         │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */

const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

require('ts-node/register');

// Resolve against the caller's project root (cwd), not this package's own
// location — this script may run in-place or installed under node_modules.
const ROOT      = process.cwd();
const TEMP_SPEC = path.join(ROOT, '.tmp_pw_rec.spec.ts');
const TEMP_HAR  = path.join(ROOT, '.tmp_pw_rec.har');

function log(msg) { process.stdout.write(msg + '\n'); }

/** Convert a camelCase / kebab-case / snake_case file name into a readable title. */
function humanizeFileName(name) {
  return String(name || '')
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Auto Generated Test';
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { chromium } = require('playwright');

  // ── Step 1: show config panel ─────────────────────────────────────────────
  let config;
  try {
    config = await showConfigPanel(chromium);
  } catch (e) {
    if (e && (e.code === 'CANCELLED' || e.message === 'CANCELLED')) {
      log('\n  Cancelled.\n');
      return;
    }
    throw e;
  }

  log(`\n  Mode : ${config.mode}  |  File : ${config.fileName}` +
      (config.saveSpec ? '  |  💾 spec.ts will be saved' : '') + '\n');

  const uiActions    = [];
  const capturedApis = [];
  let   firstUrl     = config.startUrl || '';
  let   specContent  = null;

  // ── Step 2: record ────────────────────────────────────────────────────────
  if (config.mode === 'UI') {
    const result = await recordWithCodegen(config, uiActions);
    firstUrl    = result.firstUrl  || firstUrl;
    specContent = result.specContent;
  } else if (config.mode === 'UI+API') {
    // Playwright codegen → spec.ts (UI) + HAR (API)
    firstUrl = await recordWithCodegenAndHar(config, uiActions, capturedApis) || firstUrl;
  } else if (config.mode === 'DOM') {
    // DOM mode → parse plain English → execute in browser → generate .feature + .yaml
    firstUrl = await recordWithDom(config, uiActions) || firstUrl;
  } else {
    // API mode → codegen + HAR (discard spec.ts, keep only HAR)
    firstUrl = await recordWithHarOnly(config, capturedApis) || firstUrl;
  }

  // ── Step 3: apply exclude patterns ───────────────────────────────────────
  if (config.excludePatterns && config.excludePatterns.length > 0 && capturedApis.length > 0) {
    const before = capturedApis.length;
    const kept   = capturedApis.filter(
      api => !isExcluded(api.fullUrl || api.url || '', config.excludePatterns),
    );
    capturedApis.length = 0;
    capturedApis.push(...kept);
    const removed = before - capturedApis.length;
    if (removed > 0)
      log(`  🚫  Filtered out ${removed} excluded request(s).\n`);
  }

  if (uiActions.length === 0 && capturedApis.length === 0) {
    log('\n  ⚠️   No actions recorded. Nothing to convert.\n');
    return;
  }

  // ── Step 4: build URL aliases ─────────────────────────────────────────────
  const urlAliases = {};
  for (const f of (config.urlFilters || [])) {
    if (f.name && f.url) urlAliases[f.name] = f.url;
  }

  // ── Step 5: review panel ──────────────────────────────────────────────────
  log('  👁️   Opening review panel — edit captured items before saving...\n');
  let reviewedUiActions    = uiActions;
  let reviewedCapturedApis = capturedApis;
  let pathOverrides        = {};
  try {
    const initialPreview = generatePreview(config, firstUrl, uiActions, capturedApis, urlAliases);
    const reviewed = await showReviewPanel(
      chromium, config, firstUrl, uiActions, capturedApis, urlAliases, initialPreview,
    );
    reviewedUiActions    = reviewed.uiActions;
    reviewedCapturedApis = reviewed.capturedApis;
    if (reviewed.featurePath) pathOverrides.featurePath = reviewed.featurePath;
    if (reviewed.yamlPath)    pathOverrides.yamlPath    = reviewed.yamlPath;
  } catch (e) {
    if (e && (e.code === 'CANCELLED' || e.message === 'CANCELLED')) {
      log('\n  Cancelled at review stage.\n');
      return;
    }
    throw e;
  }

  if (reviewedUiActions.length === 0 && reviewedCapturedApis.length === 0) {
    log('\n  ⚠️   All items removed in review panel. Nothing saved.\n');
    return;
  }

  // ── Step 6: convert + save ────────────────────────────────────────────────
  log('  ⚙️   Converting to Cucumber format...\n');
  const { savedPaths, category } = convertAndSave(
    config, firstUrl, reviewedUiActions, reviewedCapturedApis, urlAliases, pathOverrides,
  );

  // ── Step 7 (optional): save spec.ts ──────────────────────────────────────
  if (config.saveSpec && specContent) {
    const specDir  = path.join(ROOT, 'e2e', 'spec', 'generated', category);
    fs.mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, config.fileName + '.spec.ts');
    fs.writeFileSync(specPath, specContent, 'utf8');
    savedPaths.push({ label: 'Spec', value: path.relative(ROOT, specPath) });
  }

  log('  ✅  Done!\n');
  savedPaths.forEach(p => log('      ' + p.label.padEnd(10) + ': ' + p.value));
  log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Config panel
//   Opens a browser with our setup form.
//   User fills in: file name, mode, start URL, API filters, save-spec toggle.
//   Clicking "Start Recording" closes this browser and returns the config.
// ─────────────────────────────────────────────────────────────────────────────
async function showConfigPanel(chromium) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();

  return new Promise(async (resolve, reject) => {
    let done = false;

    await page.exposeFunction('pwRecorderStart', async (cfg) => {
      if (done) return;
      done = true;

      // urlFilters: [{name, url}] — strip empties
      const rawFilters = Array.isArray(cfg.urlFilters) ? cfg.urlFilters : [];
      const urlFilters = rawFilters
        .filter(f => f && (f.name || f.url))
        .map(f => ({ name: (f.name || '').trim(), url: (f.url || '').trim() }))
        .filter(f => f.url);

      const config = {
        fileName       : ((cfg.fileName || 'recordedflow').trim()
                          .replace(/\s+/g, '-')
                          .replace(/[^a-zA-Z0-9_-]/g, '') || 'recordedflow'),
        mode           : cfg.mode       || 'UI',
        startUrl       : (cfg.startUrl  || '').trim(),
        saveSpec       : cfg.saveSpec   === true,
        domDescription : (cfg.domDescription || '').trim(),
        urlFilters,
        excludePatterns: (Array.isArray(cfg.excludePatterns) ? cfg.excludePatterns : [])
                          .map(p => String(p || '').trim())
                          .filter(Boolean),
        locatorFormat  : cfg.locatorFormat === 'json' ? 'json' : 'yaml',
        locatorLayout  : cfg.locatorLayout === 'combined' ? 'combined' : 'perpage',
      };
      try { await browser.close(); } catch {}
      resolve(config);
    });

    browser.on('disconnected', () => {
      if (!done) {
        done = true;
        reject(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }));
      }
    });

    await page.goto('about:blank');
    await page.evaluate(buildSetupPanel);
  });
}

// Browser-side function (stringified, runs via loc.evaluate) that computes a
// stable, UNIQUE xpath for the given element by trying attribute candidates in
// priority order and verifying each resolves to exactly one node. Falls back to
// an id-anchored or absolute path. Mirrors selectorEngine.ts ranking so both
// recorders produce comparable locators.
function computeUniqueXPathInBrowser(el) {
  const lit = (s) => {
    s = String(s);
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    return 'concat(' + s.split("'").map((p) => `"${p}"`).join(`,"'",`) + ')';
  };
  const count = (xp) => {
    try {
      return document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
    } catch { return -1; }
  };
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const candidates = [];

  const id = el.getAttribute('id');
  const aria = el.getAttribute('aria-label');
  const ph = el.getAttribute('placeholder');
  const name = el.getAttribute('name');
  if (id) candidates.push(`//*[@id=${lit(id)}]`);
  if (aria) candidates.push(`//*[@aria-label=${lit(aria)}]`);
  if (ph) candidates.push(`//${tag}[@placeholder=${lit(ph)}]`);
  if (name) candidates.push(`//${tag}[@name=${lit(name)}]`);
  // data-* attributes (data-test, data-testid, data-cy, ...)
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.indexOf('data-') === 0 && attr.value) candidates.push(`//${tag}[@${attr.name}=${lit(attr.value)}]`);
  }
  // tag + visible text for links/buttons
  if ((tag === 'a' || tag === 'button') && text && text.length < 80) {
    candidates.push(`//${tag}[normalize-space(.)=${lit(text)}]`);
  }

  // Pass 1: first candidate that uniquely matches
  for (const c of candidates) if (count(c) === 1) return c;
  // Pass 2: first candidate with at least one match → indexed
  for (const c of candidates) if (count(c) >= 1) return `(${c})[1]`;

  // Pass 3: walk up, anchoring at the nearest ancestor with a unique id
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    const nid = node.getAttribute && node.getAttribute('id');
    if (nid && count(`//*[@id=${lit(nid)}]`) === 1) {
      return `//*[@id=${lit(nid)}]` + (parts.length ? '/' + parts.join('/') : '');
    }
    let index = 1;
    let sib = node.previousElementSibling;
    while (sib) { if (sib.tagName === node.tagName) index++; sib = sib.previousElementSibling; }
    parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
    node = node.parentElement;
  }
  return '/html/' + parts.join('/');
}

// Node-side mirror of world.ts's buildLocatorFromTuple - reconstructs the
// actual Playwright locator a [kind, value, xpathFallback] tuple describes,
// so replay-enrichment below can resolve semantic-kind actions (role:*,
// label, placeholder, text, testid, alttext, title) instead of only ever
// treating tuple[1] as an xpath string.
const SEMANTIC_KIND_LOCATORS = {
  label: (page, v) => page.getByLabel(v, { exact: true }),
  placeholder: (page, v) => page.getByPlaceholder(v, { exact: true }),
  text: (page, v) => page.getByText(v, { exact: true }),
  testid: (page, v) => page.getByTestId(v),
  alttext: (page, v) => page.getByAltText(v, { exact: true }),
  title: (page, v) => page.getByTitle(v, { exact: true }),
};
function buildLocatorFromTuple(page, tuple) {
  const kind = String((tuple && tuple[0]) || '').toLowerCase();
  const value = (tuple && tuple[1]) || '';
  if (kind === 'xpath') return value ? page.locator(`xpath=${value}`) : null;
  if (kind === 'css') return page.locator(value);
  if (kind.startsWith('role:')) return page.getByRole(kind.slice('role:'.length), { name: value, exact: true });
  if (SEMANTIC_KIND_LOCATORS[kind]) return SEMANTIC_KIND_LOCATORS[kind](page, value);
  return value ? page.locator(`xpath=${value}`) : null; // legacy WDIO-style kinds not needed here
}

// ─────────────────────────────────────────────────────────────────────────────
// enrichActionsByReplay — replays the parsed actions in a headless browser to:
//   1. Capture the REAL URL each action ran on (page boundaries → multi screens).
//   2. For plain xpath-kind actions: compute an EXACT, DOM-verified unique xpath
//      and overwrite the template — same quality as `npm run pw`.
//   3. For semantic-kind actions (role:*/label/placeholder/text/testid/alttext/
//      title): resolve via the ACTUAL getByX() call instead of misreading the
//      value as an xpath string, so replay/URL-tracking works for them too.
//
//   Playwright codegen only emits page.goto() for the first navigation; its
//   xpaths (where present) are static templates. Replaying against the live
//   DOM fixes both.
//
//   Best-effort: any step that fails to replay keeps its original locator /
//   last known URL so a flaky selector never aborts generation.
// ─────────────────────────────────────────────────────────────────────────────
async function enrichActionsByReplay(actions, firstUrl) {
  if (!actions.length || !firstUrl) return;
  const { chromium } = require('@playwright/test');

  log(`  🧭  Replaying ${actions.length} step(s) to capture exact locators + page navigations...\n`);

  const browser = await chromium.launch({ headless: true });
  const distinctUrls = new Set();
  let xpathFixed = 0;
  try {
    const page = await browser.newPage();
    try {
      await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch { /* continue — page may still be usable */ }

    for (const a of actions) {
      const kind = String((a.locator && a.locator[0]) || '').toLowerCase();
      const isXpathKind = kind === 'xpath';
      const loc = buildLocatorFromTuple(page, a.locator);
      if (loc) {
        try {
          const cnt = await loc.count();
          // Pick the element to operate on. When the template matches exactly one,
          // use it. When it matches MANY (ambiguous text selectors on pages with
          // repeated widgets), pick the first VISIBLE one — that's the element the
          // user actually interacted with — so we can still derive a unique xpath.
          let target = loc.first();
          if (cnt > 1) {
            const visible = loc.filter({ visible: true }).first();
            if (await visible.count().catch(() => 0)) target = visible;
          }

          // Only plain xpath-kind actions get their locator overwritten - semantic
          // kinds (role:*/label/etc) are already precise from codegen and don't
          // need an xpath substitute; only their xpath FALLBACK (tuple[2]) stays
          // as originally computed.
          if (isXpathKind && cnt >= 1) {
            const xpath = a.locator[1];
            const exact = await target.evaluate(computeUniqueXPathInBrowser).catch(() => '');
            if (exact && exact !== xpath) { a.locator = ['xpath', exact]; xpathFixed++; }
          }

          // Perform the action so any navigation it triggers is reflected in page.url()
          const act = target;
          if (a.type === 'input') {
            await act.fill(String(a.value ?? ''), { timeout: 5000 });
          } else if (a.type === 'select') {
            try { await act.selectOption({ label: String(a.value ?? '') }, { timeout: 5000 }); }
            catch { await act.selectOption(String(a.value ?? ''), { timeout: 5000 }); }
          } else if (a.type === 'checkbox' || a.type === 'radio') {
            try { await act.check({ timeout: 5000 }); }
            catch { await act.click({ timeout: 5000 }); }
          } else if (a.type === 'click') {
            await act.click({ timeout: 5000 });
          }
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(300);
        } catch { /* step failed to replay — keep template xpath / last known href */ }
      }
      try { a.href = page.url() || a.href; } catch {}
      if (a.href) distinctUrls.add(a.href);
    }
  } catch (e) {
    log(`  ⚠️   Replay enrichment skipped: ${e.message}\n`);
  } finally {
    await browser.close();
  }

  log(`  ✅  Exact xpath captured for ${xpathFixed} element(s).\n`);
  if (distinctUrls.size > 1) {
    log(`  ✅  Detected ${distinctUrls.size} distinct page(s) — separate screens will be generated.\n`);
  } else {
    log(`  ℹ️   Single page detected — one screen will be generated.\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// enrichTableActions — fills in live table data for assert_web_table actions
//   that have no value yet (i.e. captured from Playwright Inspector via
//   getByRole('table').toBeVisible() — the inspector only records visibility,
//   not table content).
//
//   For each such action: opens a headless browser, navigates to action.href,
//   finds the table by accessible name / caption / id, extracts headers + rows,
//   and sets action.value = JSON.stringify({tableName, headers, rows}).
// ─────────────────────────────────────────────────────────────────────────────
async function enrichTableActions(actions) {
  const { chromium } = require('@playwright/test');

  const toEnrich = actions.filter(a => a.type === 'assert_web_table' && !String(a.value || '').trim());
  if (!toEnrich.length) return;

  log(`  🔍  Scraping table data for ${toEnrich.length} table assertion(s)...\n`);

  const browser = await chromium.launch({ headless: true });
  try {
    // Group by href so we only load each page once
    const byHref = {};
    for (const a of toEnrich) {
      const key = a.href || '';
      if (!byHref[key]) byHref[key] = [];
      byHref[key].push(a);
    }

    for (const [href, group] of Object.entries(byHref)) {
      if (!href) { log(`  ⚠️   Table assertion has no URL — skipping.\n`); continue; }
      const page = await browser.newPage();
      try {
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(800);

        for (const action of group) {
          const tableName = (action.element || '').trim();
          const data = await page.evaluate((name) => {
            const tables = Array.from(document.querySelectorAll('table'));
            if (!tables.length) return null;

            // Score each table — highest score wins
            function scoreTable(tbl) {
              const n = (name || '').toLowerCase();
              if (!n) return tbl === tables[0] ? 1 : 0;
              let score = 0;
              const caption = (tbl.caption && tbl.caption.textContent || '').toLowerCase().trim();
              const ariaLabel = (tbl.getAttribute('aria-label') || '').toLowerCase().trim();
              const summary   = (tbl.getAttribute('summary') || '').toLowerCase().trim();
              const id        = (tbl.id || '').toLowerCase().trim();
              if (caption   === n) score = Math.max(score, 100);
              if (ariaLabel === n) score = Math.max(score, 100);
              if (caption.includes(n) || n.includes(caption && caption))   score = Math.max(score, 60);
              if (ariaLabel.includes(n) || n.includes(ariaLabel))          score = Math.max(score, 60);
              if (summary.includes(n)  || n.includes(summary))             score = Math.max(score, 50);
              if (id.includes(n)       || n.includes(id))                  score = Math.max(score, 50);
              // score by th text
              const ths = Array.from(tbl.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
              if (ths.some(th => th === n || th.includes(n) || n.includes(th))) score = Math.max(score, 40);
              return score;
            }

            const best = tables.reduce((b, t) => {
              const s = scoreTable(t);
              return s > b.score ? { tbl: t, score: s } : b;
            }, { tbl: tables[0], score: -1 });

            const tbl = best.tbl;
            // Extract headers
            const headerRow = tbl.querySelector('thead tr') || tbl.querySelector('tr');
            const headers = headerRow
              ? Array.from(headerRow.querySelectorAll('th, td')).map(c => c.textContent.trim())
              : [];

            // Extract up to 10 body rows
            const bodyRows = Array.from(tbl.querySelectorAll('tbody tr')).slice(0, 10).map(tr =>
              Array.from(tr.querySelectorAll('td, th')).map(c => c.textContent.trim())
            );

            const resolvedName = (tbl.caption && tbl.caption.textContent.trim()) ||
                                 tbl.getAttribute('aria-label') || name || 'Table';
            return { tableName: resolvedName, headers, rows: bodyRows };
          }, tableName);

          if (data) {
            action.value = JSON.stringify(data);
            log(`  ✅  Table "${data.tableName}" — ${data.headers.length} col(s), ${data.rows.length} row(s) captured.\n`);
          } else {
            log(`  ⚠️   No <table> found on ${href} for "${tableName}".\n`);
          }
        }
      } catch (e) {
        log(`  ⚠️   Could not load ${href} for table scraping: ${e.message}\n`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2a — UI mode: Playwright codegen
//   Spawns `npx playwright codegen --output <tmp.spec.ts> [url]`.
//   Waits for the process to exit (user closes the browser / Inspector).
//   Reads the generated spec, parses it with specParser, fills uiActions[].
//   Returns { firstUrl, specContent }.
// ─────────────────────────────────────────────────────────────────────────────
async function recordWithCodegen(config, uiActions) {
  const { parsePlaywrightSpec } = require('../specParser');

  log('  🎬  Playwright Inspector opened.\n      Record your flow, then close the browser window.\n');

  await new Promise((res, rej) => {
    let proc;

    if (process.platform === 'win32') {
      // Windows: .cmd files cannot be spawned directly without a shell (EINVAL).
      // Build a single quoted command string so cmd.exe handles path spaces correctly.
      // Using spawn(string, { shell:true }) — no args array — avoids the DEP0190 warning.
      const cmd = `npx playwright codegen --output "${TEMP_SPEC}"` +
                  (config.startUrl ? ` "${config.startUrl}"` : '');
      proc = spawn(cmd, { stdio: 'inherit', shell: true });
    } else {
      // Unix/macOS: pass args as an array — no shell, no path-splitting issues.
      const args = ['playwright', 'codegen', '--output', TEMP_SPEC];
      if (config.startUrl) args.push(config.startUrl);
      proc = spawn('npx', args, { stdio: 'inherit' });
    }

    proc.on('close', res);
    proc.on('error', rej);
  });

  if (!fs.existsSync(TEMP_SPEC)) {
    log('  ⚠️   Spec file not found — the recording may have been empty.\n');
    return { firstUrl: config.startUrl || '', specContent: null };
  }

  const specContent = fs.readFileSync(TEMP_SPEC, 'utf8');
  try { fs.unlinkSync(TEMP_SPEC); } catch {}   // always clean up temp file

  const { actions, firstUrl } = parsePlaywrightSpec(specContent);
  await enrichActionsByReplay(actions, firstUrl || config.startUrl || '');
  await enrichTableActions(actions);
  uiActions.push(...actions);

  log(`  ✔   Parsed ${actions.length} action(s) from recording.\n`);
  return { firstUrl: firstUrl || config.startUrl || '', specContent };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2b — UI+API mode: Playwright codegen + HAR
//   Spawns playwright codegen with --save-har so both the spec.ts (UI actions)
//   and a HAR file (all network traffic) are written by the same recording
//   session.  After the user closes the browser:
//     • spec.ts   → specParser.ts  → uiActions[]
//     • .har      → parseHarToCapturedApis() → capturedApis[]
//   Both arrays feed into convertToInterleavedArtifacts() for timestamp merge.
// ─────────────────────────────────────────────────────────────────────────────
async function recordWithCodegenAndHar(config, uiActions, capturedApis) {
  const { parsePlaywrightSpec } = require('../specParser');

  log('  🎬  Playwright Inspector opened  (UI + API mode).\n' +
      '      UI actions AND network calls will be captured together.\n' +
      '      Record your flow, then close the browser window.\n');

  await new Promise((res, rej) => {
    let proc;
    if (process.platform === 'win32') {
      const cmd =
        `npx playwright codegen` +
        ` --output "${TEMP_SPEC}"` +
        ` --save-har "${TEMP_HAR}"` +
        (config.startUrl ? ` "${config.startUrl}"` : '');
      proc = spawn(cmd, { stdio: 'inherit', shell: true });
    } else {
      const args = [
        'playwright', 'codegen',
        '--output', TEMP_SPEC,
        `--save-har=${TEMP_HAR}`,
      ];
      if (config.startUrl) args.push(config.startUrl);
      proc = spawn('npx', args, { stdio: 'inherit' });
    }
    proc.on('close', res);
    proc.on('error', rej);
  });

  let firstUrl = config.startUrl || '';

  // ── Parse spec.ts → UI actions ──────────────────────────────────────────
  if (fs.existsSync(TEMP_SPEC)) {
    const specContent = fs.readFileSync(TEMP_SPEC, 'utf8');
    try { fs.unlinkSync(TEMP_SPEC); } catch {}
    const { actions, firstUrl: fu } = parsePlaywrightSpec(specContent);
    await enrichTableActions(actions);
    uiActions.push(...actions);
    if (fu) firstUrl = fu;
    log(`  ✔   Parsed ${actions.length} UI action(s) from spec.\n`);
  } else {
    log('  ⚠️   Spec file not found — UI recording may have been empty.\n');
  }

  // ── Parse HAR → API calls + stamp UI action timestamps ───────────────────
  if (fs.existsSync(TEMP_HAR)) {
    const harContent = fs.readFileSync(TEMP_HAR, 'utf8');
    try { fs.unlinkSync(TEMP_HAR); } catch {}
    const urlFilterStrings = (config.urlFilters || []).map(f => f.url).filter(Boolean);
    const apis = parseHarToCapturedApis(harContent, {
      urlFilters     : urlFilterStrings,
      excludePatterns: config.excludePatterns || [],
    });
    capturedApis.push(...apis);
    log(`  ✔   Parsed ${apis.length} API call(s) from HAR.\n`);

    // Stamp UI actions using ALL HAR entries as page-load anchors so that
    // convertToInterleavedArtifacts() sorts them correctly relative to APIs.
    if (uiActions.length > 0) {
      assignUiTimestampsFromHar(uiActions, harContent);
      // Fix hrefs for SPA apps: after login the URL changes client-side (no GET),
      // so all actions keep href=/login. Split into correct page groups.
      splitHrefsByNavigation(uiActions, harContent);
    }
  } else {
    log('  ⚠️   HAR file not found — no API calls captured.\n');
  }

  return firstUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assign timestamps to UI actions using ALL HAR entries as page-load anchors.
//
// codegen spec.ts has no timing — every RecordedAction.timestamp is undefined.
// Without timestamps, convertToInterleavedArtifacts puts all UI steps first
// (ts=0) and all API calls after.
//
// Strategy:
//  1. Group UI actions by action.href (the page URL when the action was taken).
//     Each unique href is a "page segment" — all actions on that page fired
//     between when that page loaded and when the next page loaded.
//  2. Look up each href in the HAR's full entry list to find its actual load
//     timestamp (earliest GET to that URL, including query-stripped variants).
//  3. Spread each segment's actions evenly between [pageLoadTs, nextPageLoadTs].
//
// This positions every UI action just before the API calls that fired after it,
// producing the correct interleaved sequence in the generated .feature.
// ─────────────────────────────────────────────────────────────────────────────
function assignUiTimestampsFromHar(uiActions, rawHarContent) {
  if (!uiActions || !uiActions.length) return;

  let har;
  try { har = JSON.parse(rawHarContent); } catch { return; }
  const entries = (har.log && Array.isArray(har.log.entries)) ? har.log.entries : [];
  if (!entries.length) return;

  // Build: URL → sorted array of GET timestamps (all visits, not just earliest).
  // This lets us pick the CORRECT visit when a page is hit multiple times
  // (e.g. /login on initial load AND again after logout).
  const urlTsAll = new Map();
  for (const entry of entries) {
    const req = entry.request || {};
    if ((req.method || '').toUpperCase() !== 'GET') continue;
    const raw = req.url || '';
    if (!raw) continue;
    const ts = entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : 0;
    if (!ts) continue;
    [raw, raw.split('?')[0].split('#')[0]].forEach(key => {
      if (!urlTsAll.has(key)) urlTsAll.set(key, []);
      urlTsAll.get(key).push(ts);
    });
  }
  urlTsAll.forEach(arr => arr.sort((a, b) => a - b));

  // ── Group actions by href ────────────────────────────────────────────────
  const groups = [];
  for (const action of uiActions) {
    const href = action.href || '';
    if (!groups.length || groups[groups.length - 1].href !== href) {
      groups.push({ href, ts: 0, actions: [] });
    }
    groups[groups.length - 1].actions.push(action);
  }

  // All HAR timestamps (for fallback).
  const allHarTs = entries
    .map(e => e.startedDateTime ? new Date(e.startedDateTime).getTime() : 0)
    .filter(Boolean);
  const maxHarTs = allHarTs.length ? Math.max(...allHarTs) : 0;
  const minHarTs = allHarTs.length ? Math.min(...allHarTs) : 0;

  // For a given href, find the FIRST GET timestamp that is strictly after `afterTs`.
  // This correctly handles pages visited multiple times (e.g. /login → redirect to
  // dashboard → logout → /login again): we always pick the visit that happened AFTER
  // the previous page loaded, not the very first visit ever.
  function firstTsAfter(href, afterTs) {
    const k1 = href;
    const k2 = href.split('?')[0].split('#')[0];
    const arr = urlTsAll.get(k1) || urlTsAll.get(k2) || [];
    return arr.find(ts => ts > afterTs) || 0;
  }

  // ── Assign each group a timestamp ────────────────────────────────────────
  // Walk groups in order, always looking for a GET *after* the previous group.
  let prevTs = 0;
  for (const g of groups) {
    const ts = firstTsAfter(g.href, prevTs);
    if (ts) {
      g.ts = ts;
      prevTs = ts;
    } else {
      // No matching GET after prevTs (SPA client-side nav): place after ALL
      // observed requests so page-load API calls appear before these actions.
      g.ts = maxHarTs > prevTs ? maxHarTs : prevTs + 1000;
      prevTs = g.ts;
    }
  }

  // If nothing matched at all, spread evenly across the global HAR window.
  if (!groups.some(g => g.ts > 0 && g.ts < maxHarTs)) {
    const T0   = minHarTs || Date.now() - 10000;
    const T1   = maxHarTs || Date.now();
    const step = (T1 - T0) / (uiActions.length + 1);
    uiActions.forEach((a, i) => { if (!a.timestamp) a.timestamp = T0 + step * (i + 1); });
    return;
  }

  // Collect sorted timestamps of mutating API calls (POST/PUT/PATCH/DELETE).
  // Used below to cap the spread window so a button-click that triggers an API
  // is never assigned a timestamp *after* that API fires.
  const activeApiTs = entries
    .filter(e => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(((e.request || {}).method || '').toUpperCase()))
    .map(e => e.startedDateTime ? new Date(e.startedDateTime).getTime() : 0)
    .filter(Boolean)
    .sort((a, b) => a - b);

  // ── Spread each group's actions between [groupTs, nextGroupTs] ───────────
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    let nextTs = groups[i + 1]
      ? groups[i + 1].ts
      : g.ts + g.actions.length * 800;

    // Cap nextTs by the first mutating API that fires after this group starts.
    // Without this, when nextGroupTs = maxHarTs (SPA nav fallback), the step
    // becomes so large that button-click timestamps land after the API they trigger.
    const firstActiveApi = activeApiTs.find(ts => ts > g.ts);
    if (firstActiveApi && firstActiveApi < nextTs) nextTs = firstActiveApi;

    const span = nextTs - g.ts;
    const step = span > 0 ? span / (g.actions.length + 1) : 800;
    g.actions.forEach((action, j) => {
      if (!action.timestamp) action.timestamp = g.ts + step * (j + 1);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// splitHrefsByNavigation
//
// Problem: SPA apps (React Router) change the URL client-side with no GET request.
// Playwright codegen only records page.goto() for the INITIAL navigation, so all
// actions after login end up with href = /login even though the page is now /.
//
// Fixes:
//   1. specParser already parses page.waitForURL() (codegen often adds this).
//   2. This function is the HAR-based fallback: when all actions have the same href,
//      use HAR page entries or POST timestamps to detect the navigation boundary and
//      assign a new href to post-navigation actions.
// ─────────────────────────────────────────────────────────────────────────────
function splitHrefsByNavigation(uiActions, rawHarContent) {
  if (!uiActions || uiActions.length === 0) return;

  // If hrefs are already varied (specParser caught waitForURL), nothing to do.
  const uniqueHrefs = new Set(uiActions.map(a => a.href || ''));
  if (uniqueHrefs.size > 1) return;

  let har;
  try { har = JSON.parse(rawHarContent); } catch { return; }
  const entries = (har.log && Array.isArray(har.log.entries)) ? har.log.entries : [];

  // ── Strategy 1: HAR log.pages navigation timeline ─────────────────────────
  // Playwright records a new page entry for every navigation (including SPA
  // history.pushState changes via CDP Page.frameNavigated).
  const pages = (har.log && Array.isArray(har.log.pages)) ? har.log.pages : [];
  if (pages.length >= 2) {
    const navTimeline = pages
      .map(p => {
        const ts  = p.startedDateTime ? new Date(p.startedDateTime).getTime() : 0;
        const url = (entries.find(e => e.pageref === p.id) || {}).request?.url || '';
        return { ts, url };
      })
      .filter(n => n.ts && n.url)
      .sort((a, b) => a.ts - b.ts);

    if (navTimeline.length >= 2) {
      log(`  [href-split] Using ${navTimeline.length} HAR page entries for navigation detection`);
      for (const action of uiActions) {
        const ts = action.timestamp || 0;
        // Find the last navigation that started at or before this action
        for (let i = navTimeline.length - 1; i >= 0; i--) {
          if (navTimeline[i].ts <= ts) {
            action.href = navTimeline[i].url;
            break;
          }
        }
      }
      return;
    }
  }

  // ── Strategy 2: First successful POST as navigation boundary ──────────────
  // After a login POST (200 OK), React Router navigates client-side. Actions
  // after the POST timestamp belong to the new page.
  const authPosts = entries
    .filter(e => {
      const method  = ((e.request  || {}).method   || '').toUpperCase();
      const status  =  (e.response || {}).status   || 0;
      return method === 'POST' && status >= 200 && status < 400;
    })
    .map(e => e.startedDateTime ? new Date(e.startedDateTime).getTime() : 0)
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (!authPosts.length) return;

  const firstPostTs = authPosts[0];
  const loginHref   = uiActions[0].href || '';

  // Derive dashboard href: strip /login (or /auth/login) → base URL
  let dashHref = loginHref;
  try {
    const u   = new URL(loginHref);
    u.pathname = '/';
    u.search   = '';
    u.hash     = '';
    dashHref   = u.toString();
  } catch { /* not a valid URL — keep original */ }

  // If stripping path gave the same URL, append a marker so the group differs
  if (dashHref === loginHref) dashHref = loginHref + '#__dashboard';

  log(`  [href-split] POST boundary at ${firstPostTs}ms — dashboard href: ${dashHref}`);

  for (const action of uiActions) {
    if ((action.timestamp || 0) > firstPostTs) {
      action.href = dashHref;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse a Playwright HAR file → CapturedApi[]
//   Applies URL include filters (OR logic) and exclude patterns.
//   Redacts Authorization and Cookie headers.
// ─────────────────────────────────────────────────────────────────────────────
function parseHarToCapturedApis(harContent, options) {
  const urlFilters      = (options && options.urlFilters)      || [];
  const excludePatterns = (options && options.excludePatterns) || [];

  let har;
  try { har = JSON.parse(harContent); } catch { return []; }
  const entries = (har.log && Array.isArray(har.log.entries)) ? har.log.entries : [];
  const result  = [];

  function normalUrl(url) {
    try { const u = new URL(url); return u.pathname + u.search + u.hash; }
    catch { return url; }
  }
  function tryJson(text) {
    const t = (text || '').trim();
    if (!t) return undefined;
    try { return JSON.parse(t); } catch { return t; }
  }

  for (const entry of entries) {
    const req = entry.request  || {};
    const res = entry.response || {};

    const method  = (req.method || '').toUpperCase();
    const fullUrl = req.url    || '';
    if (!method || !fullUrl) continue;

    // URL include filter — if filters set, at least one must match
    if (urlFilters.length > 0 && !urlFilters.some(f => fullUrl.includes(f))) continue;

    // Exclude patterns (extension-based + substring)
    if (isExcluded(fullUrl, excludePatterns)) continue;

    // Request body
    let requestBody;
    const pd = req.postData;
    if (pd && pd.text) requestBody = tryJson(pd.text);

    // Response body
    let responseBody;
    const ct = res.content || {};
    if (ct.text) responseBody = tryJson(ct.text);

    // Headers — redact sensitive values
    const headers = {};
    (req.headers || []).forEach(h => {
      const k = (h.name || '').toLowerCase();
      headers[k] = (k === 'authorization' || k === 'cookie' || k === 'set-cookie')
        ? '[REDACTED]'
        : (h.value || '');
    });

    const timestamp = entry.startedDateTime
      ? new Date(entry.startedDateTime).getTime()
      : 0;

    result.push({
      method,
      fullUrl,
      url      : normalUrl(fullUrl),
      headers,
      requestBody,
      responseBody,
      status   : (res.status || 0),
      timestamp,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2c — API mode: programmatic browser
//   Opens a browser with the compact 🔴 REC toolbar injected on every page.
//   Attaches page.on('request'/'response') via attachApiCapture().
//   Waits until the user clicks ⏹ Stop or closes the browser.
// ─────────────────────────────────────────────────────────────────────────────
async function recordProgrammatic(config, chromium, uiActions, capturedApis) {
  const { attachApiCapture } = require('../capture');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();

  let stopResolve;
  const stopPromise  = new Promise(res => { stopResolve = res; });
  const closePromise = new Promise(res => browser.on('disconnected', res));
  let firstUrl = '';

  // Exposed: Stop button in the browser toolbar
  await page.exposeFunction('pwRecorderStop', () => {
    if (stopResolve) { stopResolve(); stopResolve = null; }
  });

  // Exposed: UI event callbacks from injected JS (UI / UI+API mode)
  await page.exposeFunction('pwRecorderUiAction', (action) => {
    if (config.mode === 'API') return;              // ignored in API-only mode
    if (!firstUrl && action.href) firstUrl = action.href;
    uiActions.push({ ...action, timestamp: Date.now() });
  });

  // Init script: compact toolbar + event listeners — runs on EVERY page load
  await context.addInitScript(buildRecordingScript, {
    fileName : config.fileName,
    mode     : config.mode,
  });

  // API capture via Playwright-native page.on('request'/'response')
  let apiCapture = null;
  if (config.mode !== 'UI') {
    const urlFilterStrings = config.urlFilters.map(f => f.url).filter(Boolean);
    apiCapture = attachApiCapture(page, capturedApis, {
      urlFilters: urlFilterStrings.length ? urlFilterStrings : undefined,
    });
    log(`  🌐  API capture active.${urlFilterStrings.length ? '  Filters: ' + urlFilterStrings.join(', ') : '  (capturing all URLs)'}\n`);
  }

  // Navigate to start URL (if provided)
  if (config.startUrl) {
    try {
      await page.goto(config.startUrl, { waitUntil: 'domcontentloaded' });
      firstUrl = config.startUrl;
    } catch (e) {
      log(`  ⚠️   Could not navigate to "${config.startUrl}": ${e.message}\n`);
    }
  }

  // Track first real URL when user navigates manually
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (url && !url.startsWith('about:') && !firstUrl) firstUrl = url;
  });

  log('  🔴  Recording. Click ⏹ Stop Recording in the browser toolbar when done.\n');

  await Promise.race([stopPromise, closePromise]);

  // Stop registering new captures first
  if (apiCapture) try { apiCapture.stop(); } catch {}

  // ── DRAIN ────────────────────────────────────────────────────────────────────
  // page.on('response') handlers are async — they await resp.json() / resp.text()
  // before pushing into capturedApis[].  If we call browser.close() immediately,
  // those in-flight promises are interrupted and nothing gets captured.
  // Waiting 1 s gives all pending response-body parsers time to complete.
  if (config.mode !== 'UI') {
    await new Promise(r => setTimeout(r, 1000));
  }

  try { await browser.close(); } catch {}

  log(`  ✔   Captured ${capturedApis.length} API call(s) and ${uiActions.length} UI action(s).\n`);

  return firstUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup panel  (injected on about:blank via page.evaluate — runs in browser)
// ─────────────────────────────────────────────────────────────────────────────
function buildSetupPanel() {
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    body {
      background:#020617;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
      display:flex; align-items:center; justify-content:center;
      min-height:100vh; padding:24px;
    }
    .pw-card {
      width:520px; background:#0f172a;
      border:1px solid rgba(148,163,184,0.15);
      border-radius:18px; padding:32px;
      box-shadow:0 32px 80px rgba(0,0,0,0.6);
    }
    .pw-head {
      display:flex; align-items:center; gap:12px; margin-bottom:28px;
    }
    .pw-head-icon { font-size:28px; }
    .pw-head-title{ font-size:20px; font-weight:900; color:#f1f5f9; }
    .pw-head-sub  { font-size:12px; color:#475569; margin-top:2px; }

    .pw-field { margin-bottom:20px; }
    .pw-label {
      display:block; font-size:11px; font-weight:800;
      color:#64748b; letter-spacing:0.08em; margin-bottom:8px;
      text-transform:uppercase;
    }
    .pw-input {
      width:100%; padding:11px 14px;
      border-radius:10px; border:1px solid rgba(148,163,184,0.18);
      background:rgba(15,23,42,0.7); color:#e2e8f0; font-size:13px;
      outline:none; transition:border-color 0.15s;
    }
    .pw-input:focus { border-color:rgba(99,102,241,0.55); }
    .pw-input::placeholder { color:#334155; }

    .pw-mode-row { display:flex; gap:8px; }
    .pw-mode-btn {
      flex:1; padding:10px 6px;
      border-radius:10px; border:1px solid rgba(148,163,184,0.15);
      background:rgba(15,23,42,0.5); color:#64748b;
      font-size:12px; font-weight:800; cursor:pointer;
      transition:all 0.15s; text-align:center; line-height:1.4;
    }
    .pw-mode-btn:hover { border-color:rgba(99,102,241,0.4); color:#a5b4fc; }
    .pw-mode-btn.active {
      background:rgba(79,70,229,0.18);
      border-color:rgba(99,102,241,0.55); color:#a5b4fc;
    }
    .pw-mode-desc {
      font-size:11px; color:#475569; margin-top:7px; min-height:16px;
      line-height:1.5;
    }
    .pw-api-section { margin-top:20px; }
    .pw-filter-row  {
      display:grid;
      grid-template-columns: 120px 1fr 36px;
      gap:8px; align-items:center; margin-bottom:8px;
    }
    .pw-filter-row .pw-input { width:100%; }
    .pw-rm-btn {
      padding:9px 10px; border-radius:8px; border:0;
      background:rgba(220,38,38,0.12); color:#fca5a5;
      cursor:pointer; font-size:14px; font-weight:700;
      transition:background 0.12s; flex-shrink:0;
      display:flex; align-items:center; justify-content:center;
    }
    .pw-rm-btn:hover { background:rgba(220,38,38,0.24); }
    .pw-filter-header {
      display:grid;
      grid-template-columns: 120px 1fr 36px;
      gap:8px; margin-bottom:4px;
    }
    .pw-filter-col-label {
      font-size:10px; font-weight:700; color:#334155;
      text-transform:uppercase; letter-spacing:0.06em;
    }
    .pw-add-btn {
      width:100%; padding:9px;
      border-radius:8px; border:1px dashed rgba(148,163,184,0.2);
      background:transparent; color:#475569; font-size:12px;
      cursor:pointer; transition:all 0.15s; margin-top:4px;
    }
    .pw-add-btn:hover { border-color:rgba(99,102,241,0.35); color:#94a3b8; }

    /* ── Exclude chips ──────────────────────────────────────────────── */
    .pw-chip-row   { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
    .pw-chip {
      padding:5px 11px; border-radius:20px;
      border:1px solid rgba(148,163,184,0.15);
      background:rgba(15,23,42,0.5); color:#475569;
      font-size:11px; font-weight:700; cursor:pointer;
      transition:all 0.15s; user-select:none;
    }
    .pw-chip:hover { border-color:rgba(248,113,113,0.3); color:#94a3b8; }
    .pw-chip.active {
      background:rgba(220,38,38,0.13);
      border-color:rgba(248,113,113,0.4); color:#fca5a5;
    }
    .pw-exc-row {
      display:flex; gap:8px; align-items:center;
      margin-bottom:6px;
    }
    .pw-exc-row .pw-input { flex:1; }
    .pw-exc-add-btn {
      padding:10px 13px; border-radius:8px; border:0;
      background:rgba(79,70,229,0.15); color:#a5b4fc;
      cursor:pointer; font-size:16px; font-weight:700;
      transition:background 0.12s; flex-shrink:0; line-height:1;
    }
    .pw-exc-add-btn:hover { background:rgba(79,70,229,0.28); }
    .pw-exc-item {
      display:flex; align-items:center; justify-content:space-between;
      padding:6px 10px; border-radius:7px; margin-bottom:4px;
      background:rgba(220,38,38,0.08);
      border:1px solid rgba(248,113,113,0.15);
    }
    .pw-exc-item-text { font-size:12px; color:#fca5a5; font-family:monospace; }
    .pw-exc-item-rm {
      border:0; background:none; color:#ef4444; cursor:pointer;
      font-size:15px; font-weight:700; padding:0 2px; line-height:1;
    }

    /* ── Save spec toggle ────────────────────────────────────────── */
    .pw-toggle-row {
      display:flex; align-items:center; justify-content:space-between;
      padding:12px 14px; border-radius:10px;
      border:1px solid rgba(148,163,184,0.12);
      background:rgba(15,23,42,0.4);
    }
    .pw-toggle-label-block { }
    .pw-toggle-title  { font-size:13px; font-weight:700; color:#cbd5e1; }
    .pw-toggle-sub    { font-size:11px; color:#334155; margin-top:2px; }
    .pw-toggle {
      position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;
    }
    .pw-toggle input { opacity:0; width:0; height:0; }
    .pw-toggle-slider {
      position:absolute; inset:0; border-radius:24px;
      background:rgba(148,163,184,0.15); transition:background 0.2s;
    }
    .pw-toggle-slider::before {
      content:''; position:absolute;
      left:3px; top:3px; width:18px; height:18px;
      border-radius:50%; background:#475569; transition:all 0.2s;
    }
    .pw-toggle input:checked + .pw-toggle-slider { background:rgba(79,70,229,0.7); }
    .pw-toggle input:checked + .pw-toggle-slider::before {
      transform:translateX(20px); background:#a5b4fc;
    }

    .pw-divider { height:1px; background:rgba(148,163,184,0.1); margin:24px 0; }
    .pw-start {
      width:100%; padding:15px; border-radius:12px; border:0;
      background:linear-gradient(135deg,#4f46e5,#7c3aed);
      color:#fff; font-size:14px; font-weight:900; cursor:pointer;
      letter-spacing:0.02em; transition:opacity 0.15s;
      box-shadow:0 8px 24px rgba(79,70,229,0.35);
    }
    .pw-start:hover    { opacity:0.9; }
    .pw-start:disabled { opacity:0.4; cursor:default; }
    .pw-hint { font-size:11px; color:#334155; margin-top:6px; line-height:1.5; }
  `;
  document.head.appendChild(style);

  const card = document.createElement('div');
  card.className = 'pw-card';
  card.innerHTML = `
    <div class="pw-head">
      <span class="pw-head-icon">🎬</span>
      <div>
        <div class="pw-head-title">Playwright Recorder</div>
        <div class="pw-head-sub">Configure, record, auto-generate .feature + .yaml</div>
      </div>
    </div>

    <div class="pw-field">
      <label class="pw-label">File Name</label>
      <input id="pw-fn" class="pw-input" type="text"
        value="recordedflow" placeholder="e.g. myloginflow" spellcheck="false" />
    </div>

    <div class="pw-field">
      <label class="pw-label">Capture Mode</label>
      <div class="pw-mode-row">
        <button class="pw-mode-btn active" data-mode="UI">
          🎭 UI<br/>
          <span style="font-weight:500;color:inherit">Codegen</span>
        </button>
        <button class="pw-mode-btn" data-mode="API">
          🌐 API<br/>
          <span style="font-weight:500;color:inherit">Network</span>
        </button>
        <button class="pw-mode-btn" data-mode="UI+API">
          ⚡ UI+API<br/>
          <span style="font-weight:500;color:inherit">Codegen+HAR</span>
        </button>
        <button class="pw-mode-btn" data-mode="DOM">
          🔍 DOM<br/>
          <span style="font-weight:500;color:inherit">Auto-Run</span>
        </button>
      </div>
      <div class="pw-mode-desc" id="pw-mode-desc">
        Uses <strong style="color:#a5b4fc">Playwright Inspector</strong> — best locator quality.
        Generates .feature + .yaml
      </div>
    </div>

    <div class="pw-field">
      <label class="pw-label">
        Start URL
        <span style="color:#334155;font-weight:400;text-transform:none"> (optional)</span>
      </label>
      <input id="pw-url" class="pw-input" type="text"
        placeholder="https://example.com  — or type in the browser after starting"
        spellcheck="false" />
      <div class="pw-hint">Leave blank to type the URL directly in the browser address bar.</div>
    </div>

    <!-- Output Options -->
    <div class="pw-field" id="pw-spec-toggle-section">
      <label class="pw-label">Output Options</label>
      <div class="pw-toggle-row">
        <div class="pw-toggle-label-block">
          <div class="pw-toggle-title">💾 Save spec.ts file</div>
          <div class="pw-toggle-sub">Saves the raw Playwright spec to
            e2e/spec/generated/&lt;category&gt;/</div>
        </div>
        <label class="pw-toggle">
          <input type="checkbox" id="pw-save-spec" />
          <span class="pw-toggle-slider"></span>
        </label>
      </div>
      <div class="pw-toggle-row" style="margin-top:8px;">
        <div class="pw-toggle-label-block">
          <div class="pw-toggle-title">🗂 Locator format</div>
          <div class="pw-toggle-sub">
            <span id="pw-locator-format-label">YAML</span> —
            locators/generated/&lt;cat&gt;/&lt;page&gt;.<span id="pw-locator-format-ext">yaml</span>
          </div>
        </div>
        <label class="pw-toggle">
          <input type="checkbox" id="pw-locator-format-json" />
          <span class="pw-toggle-slider"></span>
        </label>
      </div>
      <div class="pw-toggle-row" style="margin-top:8px;">
        <div class="pw-toggle-label-block">
          <div class="pw-toggle-title">📦 Locator layout</div>
          <div class="pw-toggle-sub" id="pw-locator-layout-sub">
            Per-page — one file per page
          </div>
        </div>
        <label class="pw-toggle">
          <input type="checkbox" id="pw-locator-layout-combined" />
          <span class="pw-toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- API URL filters — only for API / UI+API mode -->
    <div id="pw-api-section" class="pw-api-section" style="display:none;">
      <div class="pw-divider"></div>

      <!-- URL include filters -->
      <label class="pw-label">
        Capture only these URLs
        <span style="color:#334155;font-weight:400;text-transform:none"> — blank = capture all</span>
      </label>
      <div class="pw-filter-header">
        <span class="pw-filter-col-label">Alias name</span>
        <span class="pw-filter-col-label">URL contains</span>
        <span></span>
      </div>
      <div id="pw-filters"></div>
      <button class="pw-add-btn" id="pw-add">+ Add URL filter</button>
      <div class="pw-hint" style="margin-bottom:0;">
        Alias name is used as a <code style="color:#a5b4fc">\${aliasName}</code> in generated steps.
      </div>

      <!-- Exclude / restrict section -->
      <div style="margin-top:20px;">
        <label class="pw-label">
          Exclude from capture
          <span style="color:#334155;font-weight:400;text-transform:none"> — static assets &amp; noise</span>
        </label>

        <!-- Quick-exclude category chips -->
        <div class="pw-chip-row" id="pw-exc-chips">
          <button class="pw-chip active"
            data-patterns="*.png,*.jpg,*.jpeg,*.gif,*.svg,*.ico,*.webp,*.avif,*.bmp,*.tiff">
            🖼 Images
          </button>
          <button class="pw-chip active"
            data-patterns="*.woff,*.woff2,*.ttf,*.eot,*.otf">
            🔤 Fonts
          </button>
          <button class="pw-chip active"
            data-patterns="*.js,*.jsx,*.mjs,*.cjs,*.map">
            📜 Scripts
          </button>
          <button class="pw-chip active"
            data-patterns="*.css">
            🎨 Styles
          </button>
          <button class="pw-chip"
            data-patterns="*.json">
            📊 JSON
          </button>
        </div>

        <!-- Custom exclude patterns -->
        <div class="pw-exc-row">
          <input id="pw-exc-input" class="pw-input" type="text"
            placeholder="*.svg  ·  /static/  ·  https://cdn.example.com"
            spellcheck="false" />
          <button class="pw-exc-add-btn" id="pw-exc-add" title="Add exclusion">+</button>
        </div>
        <div id="pw-exc-list"></div>
        <div class="pw-hint">
          Patterns: <code style="color:#94a3b8">*.ext</code> excludes by file extension &nbsp;·&nbsp;
          plain text excludes any URL containing that string.
        </div>
      </div>
    </div>

    <!-- DOM Mode description area -->
    <div id="pw-dom-section" style="display:none;">
      <div class="pw-divider"></div>
      <label class="pw-label">Scenario Description</label>
      <textarea id="pw-dom-desc" class="pw-input" rows="9"
        placeholder="Go to https://example.com/login
Enter john@test.com in the Email field
Enter Test@123 in the Password field
Click the Login button
Verify Welcome text is present"
        spellcheck="false"
        style="resize:vertical;min-height:168px;line-height:1.65;
               font-family:'Cascadia Code','Fira Code',Consolas,monospace;
               font-size:12px;padding-top:10px;"></textarea>
      <div class="pw-hint" style="margin-top:6px;">
        Supported: "go to URL" &nbsp;·&nbsp; "click [button]" &nbsp;·&nbsp;
        "enter [value] in [field]" &nbsp;·&nbsp; "select [value] from [dropdown]"
      </div>
    </div>

    <div class="pw-divider"></div>
    <button class="pw-start" id="pw-start">▶&nbsp; Start Recording</button>
  `;
  document.body.appendChild(card);

  // ── Mode selection ───────────────────────────────────────────────────────
  const DESCS = {
    'UI'    : 'Uses <strong style="color:#a5b4fc">Playwright Inspector</strong> — best locator quality. Generates .feature + .yaml',
    'API'   : 'Captures network requests &amp; responses via <strong style="color:#a5b4fc">Playwright page.on()</strong>. Generates .feature',
    'UI+API': 'Uses <strong style="color:#a5b4fc">Playwright Inspector</strong> for UI + <strong style="color:#a5b4fc">HAR capture</strong> for API. Generates .feature + .yaml',
    'DOM'   : 'Describe your scenario in plain English — browser <strong style="color:#a5b4fc">auto-navigates &amp; acts</strong>, scans live DOM, generates .feature + .yaml',
  };
  let mode = 'UI';
  const modeButtons       = card.querySelectorAll('.pw-mode-btn');
  const apiSection        = document.getElementById('pw-api-section');
  const specToggleSection = document.getElementById('pw-spec-toggle-section');
  const domSection        = document.getElementById('pw-dom-section');
  const modeDesc          = document.getElementById('pw-mode-desc');

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      apiSection.style.display        = (mode === 'API' || mode === 'UI+API') ? '' : 'none';
      specToggleSection.style.display = mode === 'UI'  ? '' : 'none';
      domSection.style.display        = mode === 'DOM' ? '' : 'none';
      modeDesc.innerHTML = DESCS[mode] || '';
    });
  });

  // ── API filter rows ───────────────────────────────────────────────────────
  const filterContainer = document.getElementById('pw-filters');

  function addFilter(name, url) {
    const row = document.createElement('div');
    row.className = 'pw-filter-row';

    const nameInp = document.createElement('input');
    nameInp.className   = 'pw-input';
    nameInp.type        = 'text';
    nameInp.placeholder = 'api1';
    nameInp.value       = name || '';
    nameInp.spellcheck  = false;
    nameInp.title       = 'Alias name used in feature steps';
    // Tab from name → URL
    nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') urlInp.focus(); });

    const urlInp = document.createElement('input');
    urlInp.className   = 'pw-input';
    urlInp.type        = 'text';
    urlInp.placeholder = 'https://api.example.com/v1';
    urlInp.value       = url || '';
    urlInp.spellcheck  = false;
    urlInp.title       = 'Capture requests whose URL contains this string';

    const rm = document.createElement('button');
    rm.className   = 'pw-rm-btn';
    rm.textContent = '×';
    rm.title       = 'Remove';
    rm.onclick     = () => row.remove();

    row.appendChild(nameInp);
    row.appendChild(urlInp);
    row.appendChild(rm);
    filterContainer.appendChild(row);
    nameInp.focus();
  }

  document.getElementById('pw-add').addEventListener('click', () => addFilter('', ''));

  // ── Exclude chips toggle ────────────────────────────────────────────────────
  document.querySelectorAll('#pw-exc-chips .pw-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });

  // ── Custom exclude patterns ─────────────────────────────────────────────────
  const excInput = document.getElementById('pw-exc-input');
  const excList  = document.getElementById('pw-exc-list');

  function addExcludePattern(val) {
    const pattern = (val || '').trim();
    if (!pattern) return;
    // Prevent duplicates
    const existing = [...excList.querySelectorAll('.pw-exc-item')].map(el => el.dataset.pattern);
    if (existing.includes(pattern)) { excInput.value = ''; return; }

    const item = document.createElement('div');
    item.className       = 'pw-exc-item';
    item.dataset.pattern = pattern;

    const txt = document.createElement('span');
    txt.className   = 'pw-exc-item-text';
    txt.textContent = pattern;

    const rm  = document.createElement('button');
    rm.className   = 'pw-exc-item-rm';
    rm.textContent = '×';
    rm.title       = 'Remove';
    rm.onclick     = () => item.remove();

    item.appendChild(txt);
    item.appendChild(rm);
    excList.appendChild(item);
    excInput.value = '';
    excInput.focus();
  }

  document.getElementById('pw-exc-add').addEventListener('click', () =>
    addExcludePattern(excInput.value));
  excInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addExcludePattern(excInput.value); }
  });

  // ── Locator format toggle label ───────────────────────────────────────────
  document.getElementById('pw-locator-format-json').addEventListener('change', function () {
    const isJson = this.checked;
    document.getElementById('pw-locator-format-label').textContent = isJson ? 'JSON' : 'YAML';
    document.getElementById('pw-locator-format-ext').textContent   = isJson ? 'json' : 'yaml';
  });

  // ── Locator layout toggle label ───────────────────────────────────────────
  document.getElementById('pw-locator-layout-combined').addEventListener('change', function () {
    const isCombined = this.checked;
    document.getElementById('pw-locator-layout-sub').textContent = isCombined
      ? 'Combined — all pages in one file'
      : 'Per-page — one file per page';
  });

  // ── Start Recording button ────────────────────────────────────────────────
  document.getElementById('pw-start').addEventListener('click', async () => {
    const btn            = document.getElementById('pw-start');
    const fileName       = (document.getElementById('pw-fn').value  || '').trim() || 'recordedflow';
    const startUrl       = (document.getElementById('pw-url').value || '').trim();
    const saveSpec       = document.getElementById('pw-save-spec').checked;
    const locatorFormat  = document.getElementById('pw-locator-format-json').checked ? 'json' : 'yaml';
    const locatorLayout  = document.getElementById('pw-locator-layout-combined').checked ? 'combined' : 'perpage';
    const domDescription = mode === 'DOM'
      ? ((document.getElementById('pw-dom-desc') || {}).value || '').trim()
      : '';

    // Collect filter rows — each has two inputs: [name, url]
    const urlFilters = [];
    filterContainer.querySelectorAll('.pw-filter-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      const name   = (inputs[0] ? inputs[0].value : '').trim();
      const url    = (inputs[1] ? inputs[1].value : '').trim();
      if (url) urlFilters.push({ name, url });
    });

    // Collect exclude patterns: active chips + custom entries
    const excludePatterns = [];
    document.querySelectorAll('#pw-exc-chips .pw-chip.active').forEach(chip => {
      chip.dataset.patterns.split(',').forEach(p => {
        const t = p.trim();
        if (t) excludePatterns.push(t);
      });
    });
    document.querySelectorAll('#pw-exc-list .pw-exc-item').forEach(item => {
      if (item.dataset.pattern) excludePatterns.push(item.dataset.pattern);
    });

    btn.disabled    = true;
    btn.textContent = 'Opening…';

    try {
      if (window.pwRecorderStart) {
        await window.pwRecorderStart({ fileName, mode, startUrl, saveSpec, locatorFormat, locatorLayout, urlFilters, excludePatterns, domDescription });
      }
      // This browser is closed by Node.js after pwRecorderStart resolves.
    } catch {
      btn.disabled    = false;
      btn.textContent = '▶  Start Recording';
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording script (addInitScript — runs in browser on EVERY page load)
// Receives { fileName, mode } from Node.js via addInitScript(fn, args).
// Injects: compact toolbar + UI event listeners (click / input / select).
// ─────────────────────────────────────────────────────────────────────────────
function buildRecordingScript({ fileName, mode }) {

  // ── Compact toolbar ─────────────────────────────────────────────────────────
  function injectToolbar() {
    if (document.getElementById('__pw_rec__')) return;
    const bar = document.createElement('div');
    bar.id = '__pw_rec__';
    bar.setAttribute('style', [
      'position:fixed','top:12px','right:12px','z-index:2147483647',
      'background:rgba(2,6,23,0.93)',
      'border:1px solid rgba(148,163,184,0.22)',
      'border-radius:12px','padding:9px 16px',
      'display:flex','gap:12px','align-items:center',
      'font-family:system-ui,"Segoe UI",Roboto,sans-serif',
      'box-shadow:0 8px 28px rgba(0,0,0,0.45)',
      'backdrop-filter:blur(10px)',
    ].join(';'));

    const badge = document.createElement('span');
    badge.textContent = '🔴 REC  ' + mode;
    badge.setAttribute('style',
      'font-size:12px;font-weight:900;color:#f87171;white-space:nowrap;letter-spacing:0.03em;');

    const sep = document.createElement('span');
    sep.setAttribute('style',
      'width:1px;height:18px;background:rgba(148,163,184,0.2);flex-shrink:0;');

    const name = document.createElement('span');
    name.textContent = fileName;
    name.setAttribute('style','font-size:12px;color:#94a3b8;white-space:nowrap;');

    const stop = document.createElement('button');
    stop.textContent = '⏹ Stop Recording';
    stop.setAttribute('style', [
      'border:0','border-radius:8px','padding:7px 14px','cursor:pointer',
      'font-weight:800','font-size:12px','color:#fff','background:#dc2626',
      'white-space:nowrap','margin-left:4px',
    ].join(';'));
    stop.onclick = function() { if (window.pwRecorderStop) window.pwRecorderStop(); };

    bar.appendChild(badge);
    bar.appendChild(sep);
    bar.appendChild(name);
    bar.appendChild(stop);

    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', () => document.body && document.body.appendChild(bar));
    else if (document.body)
      document.body.appendChild(bar);
  }

  injectToolbar();

  // ── UI event listeners ───────────────────────────────────────────────────────
  // (active for UI / UI+API mode; API-only mode ignores via Node.js callback check)
  if (window.__pw_rec__) return;
  window.__pw_rec__ = true;

  function href()   { return window.location.href; }
  function clean(s) { return String(s || '').replace(/\s+/g,' ').trim().slice(0,200); }
  function xlit(s) {
    if (!s.includes("'")) return "'" + s + "'";
    if (!s.includes('"')) return '"' + s + '"';
    return "concat('" + s.split("'").join("',\"'\",'") + "')";
  }

  function getName(el) {
    const id   = el.id || '';
    const aria = el.getAttribute('aria-label') || '';
    const ph   = el.getAttribute('placeholder') || '';
    const nm   = el.getAttribute('name') || '';
    const text = clean(el.innerText || el.textContent || '');
    let lbl = '';
    if (id) {
      const lblEl = document.querySelector('label[for="' + id + '"]');
      if (lblEl) lbl = clean(lblEl.textContent || '');
    }
    return lbl || aria || ph || text || nm || id || el.tagName.toLowerCase();
  }

  // ── Semantic locator picking (browser-side mirror of selectorEngine.ts's
  // resolveLocator priority chain: testid > role > label > placeholder >
  // alttext > title > text > xpath). No Playwright API is available inside
  // the page, so uniqueness is checked via plain DOM queries instead of
  // page.getByRole().count(). An explicit role attribute always wins over
  // tag-based guessing (e.g. Docusaurus's <a role="button">Guides</a> is a
  // button, not a link) - same fix as the Node-side resolveLocator got.
  function computeRole(el) {
    const explicit = (el.getAttribute('role') || '').toLowerCase();
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input' && (type === 'button' || type === 'submit')) return 'button';
    if (tag === 'input' && type === 'checkbox') return 'checkbox';
    if (tag === 'input' && type === 'radio') return 'radio';
    if (tag === 'input' || tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    return '';
  }

  function computeAccessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const txt = labelledby.split(/\s+/).map(function (id) {
        const e = document.getElementById(id);
        return e ? clean(e.textContent) : '';
      }).filter(Boolean).join(' ');
      if (txt) return txt;
    }
    if (el.id) {
      const lbl = document.querySelector('label[for="' + el.id + '"]');
      if (lbl) return clean(lbl.textContent);
    }
    const closestLabel = el.closest && el.closest('label');
    if (closestLabel) return clean(closestLabel.textContent);
    const tag = el.tagName.toLowerCase();
    if (tag === 'img' || tag === 'area') {
      const alt = el.getAttribute('alt');
      if (alt) return clean(alt);
    }
    const text = clean(el.innerText || el.textContent || '');
    if (text) return text;
    const title = el.getAttribute('title');
    if (title) return clean(title);
    return '';
  }

  // Counts elements sharing the same computed role + accessible name -
  // approximates page.getByRole(role, {name, exact:true}).count().
  function countByRole(role, name) {
    let count = 0;
    document.querySelectorAll('*').forEach(function (candidate) {
      if (computeRole(candidate) === role && computeAccessibleName(candidate) === name) count++;
    });
    return count;
  }

  function cssAttrCount(sel) {
    try { return document.querySelectorAll(sel).length; } catch (e) { return 0; }
  }

  /** Returns [kind, value, xpathFallback] - same tuple format world.ts reads. */
  function pickLocatorTuple(el, xpathFallback) {
    const tag = el.tagName.toLowerCase();

    const testId = el.getAttribute('data-testid');
    if (testId && cssAttrCount('[data-testid="' + CSS.escape(testId) + '"]') === 1) {
      return ['testid', testId, xpathFallback];
    }

    const role = computeRole(el);
    const name = computeAccessibleName(el);
    if (role && name && countByRole(role, name) === 1) {
      return ['role:' + role, name, xpathFallback];
    }

    if (el.id) {
      const lbl = document.querySelector('label[for="' + el.id + '"]');
      if (lbl) {
        const labelTxt = clean(lbl.textContent);
        if (labelTxt) return ['label', labelTxt, xpathFallback];
      }
    }

    const ph = el.getAttribute('placeholder');
    if (ph && cssAttrCount('[placeholder="' + CSS.escape(ph) + '"]') === 1) {
      return ['placeholder', ph, xpathFallback];
    }

    if ((tag === 'img' || tag === 'area')) {
      const alt = el.getAttribute('alt');
      if (alt && cssAttrCount(tag + '[alt="' + CSS.escape(alt) + '"]') === 1) {
        return ['alttext', alt, xpathFallback];
      }
    }

    const title = el.getAttribute('title');
    if (title && cssAttrCount('[title="' + CSS.escape(title) + '"]') === 1) {
      return ['title', title, xpathFallback];
    }

    const text = clean(el.innerText || el.textContent || '');
    if (text && text.length <= 100) {
      let count = 0;
      document.querySelectorAll('*').forEach(function (c) {
        if (clean(c.innerText || c.textContent || '') === text) count++;
      });
      if (count === 1) return ['text', text, xpathFallback];
    }

    return ['xpath', xpathFallback];
  }

  // Click (button / link)
  document.addEventListener('click', function(e) {
    const t = e.target;
    if (!t || t.closest('#__pw_rec__')) return;
    const el = t.closest('button,a,[role="button"],[role="link"],input[type="button"],input[type="submit"]');
    if (!el) return;
    const tag         = el.tagName.toLowerCase();
    const role        = (el.getAttribute('role') || '').toLowerCase();
    const controlKind = (role || tag) === 'link' || (!role && tag === 'a') ? 'link' : 'button';
    const element     = getName(el);
    const xpathTag    = controlKind === 'link' ? 'a' : 'button';
    const xpathFallback = '//' + xpathTag + '[normalize-space(.)=' + xlit(element) + ']';
    const locator = pickLocatorTuple(el, xpathFallback);
    if (window.pwRecorderUiAction)
      window.pwRecorderUiAction({ type:'click', element, controlKind, href:href(), locator });
  }, true);

  // Text input (captured on focusout — user finished typing)
  document.addEventListener('focusout', function(e) {
    const el   = e.target;
    if (!el || el.closest('#__pw_rec__')) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const skip = ['checkbox','radio','button','submit','file','image','reset','range','color'];
    if (!((tag === 'input' && !skip.includes(type)) || tag === 'textarea')) return;
    const value = el.value || '';
    if (!value) return;
    const element = getName(el);
    const aria    = el.getAttribute('aria-label') || '';
    const ph      = el.getAttribute('placeholder') || '';
    let xpathFallback;
    if (aria)       xpathFallback = '//*[@aria-label=' + xlit(aria) + ']';
    else if (ph)    xpathFallback = '//input[@placeholder=' + xlit(ph) + ']';
    else if (el.id) xpathFallback = '//*[@id=' + xlit(el.id) + ']';
    else            xpathFallback = '//*[@name=' + xlit(el.getAttribute('name') || '') + ']';
    const locator = pickLocatorTuple(el, xpathFallback);
    if (window.pwRecorderUiAction)
      window.pwRecorderUiAction({ type:'input', element, value, controlKind:'textbox', href:href(), locator });
  }, true);

  // Select / Checkbox / Radio
  document.addEventListener('change', function(e) {
    const el   = e.target;
    if (!el || el.closest('#__pw_rec__')) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();

    if (tag === 'select') {
      const opt     = el.options[el.selectedIndex];
      const value   = opt ? clean(opt.text || el.value) : el.value;
      const element = getName(el);
      const nm      = el.getAttribute('name') || '';
      const xpathFallback = '//select[@name=' + xlit(nm) + ' or @id=' + xlit(el.id||'') + ']';
      const locator = pickLocatorTuple(el, xpathFallback);
      if (window.pwRecorderUiAction)
        window.pwRecorderUiAction({ type:'select', element, value, controlKind:'select', href:href(), locator });
      return;
    }

    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      const element    = getName(el);
      const nm         = el.getAttribute('name') || '';
      const actionType = type === 'radio' ? 'radio' : 'checkbox';
      const xpathFallback = '//input[@type=' + xlit(type) + ' and (@name=' + xlit(nm) + ' or @id=' + xlit(el.id||'') + ')]';
      const locator = pickLocatorTuple(el, xpathFallback);
      if (window.pwRecorderUiAction)
        window.pwRecorderUiAction({ type:actionType, element, controlKind:actionType, href:href(), locator });
    }
  }, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Write a locator YAML that puts a `urls:` block FIRST (if aliases exist),
// followed by all the element locators in alphabetical order.
//
// Result example:
//   urls:
//     login: https://customer-billing-dev.vercel.app/auth/login
//     customers: https://customer-billing-dev.vercel.app/customers/entries/all?status=active
//
//   Email:
//     - xpath
//     - //input[@placeholder='Email']
// ─────────────────────────────────────────────────────────────────────────────
function buildLocatorDoc(locatorMap, urlAliases) {
  const doc = {};
  if (urlAliases && Object.keys(urlAliases).length > 0) doc.urls = { ...urlAliases };
  if (locatorMap) {
    const sorted = [...locatorMap.keys()].sort((a, b) => a.localeCompare(b));
    for (const k of sorted) doc[k] = locatorMap.get(k);
  }
  return doc;
}

function writeLocatorYaml(filePath, locatorMap, urlAliases) {
  const doc = buildLocatorDoc(locatorMap, urlAliases);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, require('js-yaml').dump(doc, { noRefs: true, lineWidth: 160 }), 'utf8');
}

function writeLocatorJson(filePath, locatorMap, urlAliases) {
  const doc = buildLocatorDoc(locatorMap, urlAliases);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf8');
}

// Dispatch to yaml or json based on the locatorformat config setting.
function writeLocatorFile(filePath, locatorMap, urlAliases, locatorFormat) {
  if ((locatorFormat || 'yaml') === 'json') {
    return writeLocatorJson(filePath.replace(/\.yaml$/, '.json'), locatorMap, urlAliases);
  }
  return writeLocatorYaml(filePath, locatorMap, urlAliases);
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert recorded data → .feature + .yaml files
// Returns { savedPaths, category }
// ─────────────────────────────────────────────────────────────────────────────
function convertAndSave(config, firstUrl, uiActions, capturedApis, urlAliases, pathOverrides) {
  const { convertToArtifacts, convertToInterleavedArtifacts } = require('../converter');
  const { apiEventsFromCaptured, generateFeatureFromCapturedApis } = require('../formatter');
  const { generatePageKey }                                         = require('../pageRegistry');
  const { classifyFeature, featureFilePath, locatorFilePath, ensureCategoryDirs } = require('../featurePaths');

  const overrides   = pathOverrides || {};
  const { fileName, mode } = config;
  const aliases     = urlAliases || {};
  const hasAliases  = Object.keys(aliases).length > 0;
  const pageKey     = generatePageKey({ stepName: fileName }, 0);
  const scenarioUrl = firstUrl || 'about:blank';
  const savedPaths  = [];

  // Resolve a user-supplied path override (relative to ROOT) or fall back to default.
  function resolvePath(override, defaultPath) {
    if (override && override.trim()) return path.resolve(ROOT, override.trim());
    return defaultPath;
  }

  // ── API only ───────────────────────────────────────────────────────────────
  if (mode === 'API') {
    const featureContent = generateFeatureFromCapturedApis({
      capturedApis,
      featureName : fileName + ' API Flow',
      scenarioName: 'API calls',
      urlAliases  : aliases,
    });
    const cat     = 'api';
    ensureCategoryDirs(cat);

    const featPath = resolvePath(overrides.featurePath, featureFilePath(cat, fileName));
    fs.mkdirSync(path.dirname(featPath), { recursive: true });
    fs.writeFileSync(featPath, featureContent, 'utf8');
    savedPaths.push({ label: 'Feature', value: path.relative(ROOT, featPath) });

    if (hasAliases) {
      const locPath = resolvePath(overrides.yamlPath, locatorFilePath(cat, fileName));
      writeLocatorFile(locPath, null, aliases, config.locatorFormat);
      savedPaths.push({ label: 'Locators', value: path.relative(ROOT, locPath) });
    }

    return { savedPaths, category: cat };
  }

  // ── UI + API ───────────────────────────────────────────────────────────────
  const featureName = humanizeFileName(fileName);
  let artifact;
  if (mode === 'UI+API') {
    const apiEvents = apiEventsFromCaptured(capturedApis, aliases);
    artifact = convertToInterleavedArtifacts(uiActions, apiEvents, {
      scenarioTitle: 'User flow', scenarioUrl, pageKey, featureName,
    });
  } else {
    artifact = convertToArtifacts(uiActions, {
      scenarioTitle: 'User flow', scenarioUrl, pageKey, featureName,
    });
  }

  const featureContent = artifact.featureContent;
  const cat            = classifyFeature(featureContent);
  ensureCategoryDirs(cat);

  const featPath = resolvePath(overrides.featurePath, featureFilePath(cat, fileName));
  fs.mkdirSync(path.dirname(featPath), { recursive: true });
  fs.writeFileSync(featPath, featureContent, 'utf8');
  savedPaths.push({ label: 'Feature', value: path.relative(ROOT, featPath) });

  const locFmt    = config.locatorFormat || 'yaml';
  const locLayout = config.locatorLayout || 'perpage';
  let wroteLocators = false;

  if (locLayout === 'combined') {
    // Combined: merge all pages into one file under a top-level page key.
    const ext       = locFmt;
    const locPath   = resolvePath(overrides.yamlPath, locatorFilePath(cat, fileName, ext));
    const combinedDoc = {};
    if (hasAliases) combinedDoc.urls = { ...aliases };
    (artifact.pages || []).forEach(pg => {
      if (!pg.locatorMap || pg.locatorMap.size === 0) return;
      const pageSection = {};
      const sorted = [...pg.locatorMap.keys()].sort((a, b) => a.localeCompare(b));
      for (const k of sorted) pageSection[k] = pg.locatorMap.get(k);
      if (Object.keys(pageSection).length) combinedDoc[pg.pageKey] = pageSection;
      wroteLocators = true;
    });
    if (wroteLocators || hasAliases) {
      fs.mkdirSync(path.dirname(locPath), { recursive: true });
      if (locFmt === 'json') {
        fs.writeFileSync(locPath.replace(/\.yaml$/, '.json'), JSON.stringify(combinedDoc, null, 2), 'utf8');
        savedPaths.push({ label: 'Locators (combined)', value: path.relative(ROOT, locPath.replace(/\.yaml$/, '.json')) });
      } else {
        fs.writeFileSync(locPath, require('js-yaml').dump(combinedDoc, { noRefs: true, lineWidth: 160 }), 'utf8');
        savedPaths.push({ label: 'Locators (combined)', value: path.relative(ROOT, locPath) });
      }
    }
  } else {
    // Per-page: one file per page (original behaviour).
    (artifact.pages || []).forEach((pg, idx) => {
      if (!pg.locatorMap || pg.locatorMap.size === 0) return;
      const locPath = idx === 0
        ? resolvePath(overrides.yamlPath, locatorFilePath(cat, pg.pageKey))
        : locatorFilePath(cat, pg.pageKey);
      writeLocatorFile(locPath, pg.locatorMap, idx === 0 ? aliases : {}, locFmt);
      savedPaths.push({ label: 'Locators', value: path.relative(ROOT, locPath) });
      wroteLocators = true;
    });

    if (!wroteLocators && hasAliases) {
      const locPath = resolvePath(overrides.yamlPath, locatorFilePath(cat, fileName));
      writeLocatorFile(locPath, null, aliases, locFmt);
      savedPaths.push({ label: 'Locators', value: path.relative(ROOT, locPath) });
    }
  }

  return { savedPaths, category: cat };
}

// ─────────────────────────────────────────────────────────────────────────────
// API mode — codegen + HAR, spec.ts discarded
//   Opens Playwright Inspector so the user navigates normally.
//   HAR captures every network call.  The generated spec.ts is deleted.
// ─────────────────────────────────────────────────────────────────────────────
const TEMP_SPEC_DISCARD = path.join(ROOT, '.tmp_pw_discard.spec.ts');

async function recordWithHarOnly(config, capturedApis) {
  log('  🌐  Browser opened  (API capture mode).\n' +
      '      Navigate your app — all network requests are being recorded.\n' +
      '      Close the browser window when done.\n');

  await new Promise((res, rej) => {
    let proc;
    if (process.platform === 'win32') {
      const cmd =
        `npx playwright codegen` +
        ` --output "${TEMP_SPEC_DISCARD}"` +
        ` --save-har "${TEMP_HAR}"` +
        (config.startUrl ? ` "${config.startUrl}"` : '');
      proc = spawn(cmd, { stdio: 'inherit', shell: true });
    } else {
      const args = [
        'playwright', 'codegen',
        '--output', TEMP_SPEC_DISCARD,
        `--save-har=${TEMP_HAR}`,
      ];
      if (config.startUrl) args.push(config.startUrl);
      proc = spawn('npx', args, { stdio: 'inherit' });
    }
    proc.on('close', res);
    proc.on('error', rej);
  });

  // Discard the spec.ts — we only care about the HAR
  try { if (fs.existsSync(TEMP_SPEC_DISCARD)) fs.unlinkSync(TEMP_SPEC_DISCARD); } catch {}

  let firstUrl = config.startUrl || '';

  if (fs.existsSync(TEMP_HAR)) {
    const harContent = fs.readFileSync(TEMP_HAR, 'utf8');
    try { fs.unlinkSync(TEMP_HAR); } catch {}
    const urlFilterStrings = (config.urlFilters || []).map(f => f.url).filter(Boolean);
    const apis = parseHarToCapturedApis(harContent, {
      urlFilters     : urlFilterStrings,
      excludePatterns: config.excludePatterns || [],
    });
    capturedApis.push(...apis);
    log(`  ✔   Captured ${apis.length} API call(s) from HAR.\n`);
    if (apis.length > 0 && !firstUrl) firstUrl = new URL(apis[0].fullUrl).origin;
  } else {
    log('  ⚠️   HAR file not found — no API calls captured.\n');
  }

  return firstUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate feature content string (no file I/O) — used for live preview
// ─────────────────────────────────────────────────────────────────────────────
function generatePreview(config, firstUrl, uiActions, capturedApis, urlAliases) {
  const { convertToArtifacts, convertToInterleavedArtifacts } = require('../converter');
  const { apiEventsFromCaptured, generateFeatureFromCapturedApis } = require('../formatter');
  const { generatePageKey } = require('../pageRegistry');

  const aliases     = urlAliases || {};
  const pageKey     = generatePageKey({ stepName: config.fileName }, 0);
  const scenarioUrl = firstUrl || 'about:blank';

  try {
    if (config.mode === 'API') {
      return generateFeatureFromCapturedApis({
        capturedApis,
        featureName : config.fileName + ' API Flow',
        scenarioName: 'API calls',
        urlAliases  : aliases,
      });
    }
    if (config.mode === 'UI+API') {
      const apiEvents = apiEventsFromCaptured(capturedApis, aliases);
      return convertToInterleavedArtifacts(uiActions, apiEvents, {
        scenarioTitle: 'User flow', scenarioUrl, pageKey,
        featureName: humanizeFileName(config.fileName),
      }).featureContent;
    }
    return convertToArtifacts(uiActions, {
      scenarioTitle: 'User flow', scenarioUrl, pageKey,
      featureName: humanizeFileName(config.fileName),
    }).featureContent;
  } catch (e) {
    return '# Preview error: ' + (e && e.message ? e.message : String(e));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate locator content string (YAML or JSON) — used for live preview
// ─────────────────────────────────────────────────────────────────────────────
function generateLocatorPreview(config, firstUrl, uiActions, capturedApis, urlAliases) {
  const yaml = require('js-yaml');
  const { convertToArtifacts, convertToInterleavedArtifacts } = require('../converter');
  const { apiEventsFromCaptured } = require('../formatter');
  const { generatePageKey } = require('../pageRegistry');

  const aliases     = urlAliases || {};
  const pageKey     = generatePageKey({ stepName: config.fileName }, 0);
  const scenarioUrl = firstUrl || 'about:blank';
  const fmt         = config.locatorFormat || 'yaml';

  try {
    const doc = {};
    if (Object.keys(aliases).length > 0) doc.urls = { ...aliases };

    if (config.mode !== 'API') {
      let artifact;
      if (config.mode === 'UI+API') {
        const apiEvents = apiEventsFromCaptured(capturedApis, aliases);
        artifact = convertToInterleavedArtifacts(uiActions, apiEvents, {
          scenarioTitle: 'User flow', scenarioUrl, pageKey,
          featureName: humanizeFileName(config.fileName),
        });
      } else {
        artifact = convertToArtifacts(uiActions, {
          scenarioTitle: 'User flow', scenarioUrl, pageKey,
          featureName: humanizeFileName(config.fileName),
        });
      }
      const layout = config.locatorLayout || 'perpage';
      (artifact.pages || []).forEach(pg => {
        if (!pg.locatorMap || pg.locatorMap.size === 0) return;
        const sorted = [...pg.locatorMap.keys()].sort((a, b) => a.localeCompare(b));
        if (layout === 'combined') {
          // Nest under the page key.
          const section = {};
          for (const k of sorted) section[k] = pg.locatorMap.get(k);
          doc[pg.pageKey] = section;
        } else {
          for (const k of sorted) doc[k] = pg.locatorMap.get(k);
        }
      });
    }

    if (fmt === 'json') return JSON.stringify(doc, null, 2);
    return yaml.dump(doc, { noRefs: true, lineWidth: 160 });
  } catch (e) {
    return (fmt === 'json' ? '// Error: ' : '# Error: ') + (e && e.message ? e.message : String(e));
  }
}

// Keep old name as alias for any callers not yet updated.
function generateYamlPreview(config, firstUrl, uiActions, capturedApis, urlAliases) {
  return generateLocatorPreview(config, firstUrl, uiActions, capturedApis, urlAliases);
}

// ─────────────────────────────────────────────────────────────────────────────
// Review panel — opens after recording so the user can inspect + delete items
//   before files are written.  Returns { uiActions, capturedApis, featurePath, yamlPath }.
// ─────────────────────────────────────────────────────────────────────────────
async function showReviewPanel(chromium, config, firstUrl, uiActions, capturedApis, urlAliases, initialPreview) {
  const { classifyFeature, featureFilePath, locatorFilePath } = require('../featurePaths');
  const { generatePageKey } = require('../pageRegistry');

  const cat             = classifyFeature(initialPreview);
  const pageKey         = generatePageKey({ stepName: config.fileName }, 0);
  const locFmt          = config.locatorFormat || 'yaml';
  const locLayout       = config.locatorLayout || 'perpage';
  const defaultFeatPath = path.relative(ROOT, featureFilePath(cat, config.fileName));
  // Combined → one file named after the recording; per-page → file named after the first page.
  const defaultLocPath  = path.relative(ROOT, locatorFilePath(cat,
    locLayout === 'combined' ? config.fileName : pageKey, locFmt));
  const initialYaml     = generateLocatorPreview(config, firstUrl, uiActions, capturedApis, urlAliases);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();

  return new Promise(async (resolve, reject) => {
    let done = false;

    await page.exposeFunction('pwReviewPreview', async (data) => {
      try {
        return generatePreview(config, firstUrl, data.uiActions || [], data.capturedApis || [], urlAliases);
      } catch (e) {
        return '# Preview error: ' + (e && e.message ? e.message : String(e));
      }
    });

    await page.exposeFunction('pwReviewYaml', async (data) => {
      try {
        return generateYamlPreview(config, firstUrl, data.uiActions || [], data.capturedApis || [], urlAliases);
      } catch (e) {
        return '# YAML error: ' + (e && e.message ? e.message : String(e));
      }
    });

    await page.exposeFunction('pwReviewSave', async (data) => {
      if (done) return;
      done = true;
      try { await browser.close(); } catch {}
      resolve({
        uiActions    : data.uiActions    || [],
        capturedApis : data.capturedApis || [],
        featurePath  : data.featurePath  || '',
        yamlPath     : data.yamlPath     || '',
      });
    });

    browser.on('disconnected', () => {
      if (!done) {
        done = true;
        reject(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }));
      }
    });

    await page.goto('about:blank');
    await page.evaluate(buildReviewPanel, {
      uiActions,
      capturedApis,
      mode           : config.mode,
      featurePreview : initialPreview,
      yamlPreview    : initialYaml,
      fileName       : config.fileName,
      defaultFeatPath,
      defaultYamlPath: defaultLocPath,
      locatorFormat  : locFmt,
      locatorLayout  : locLayout,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Review panel UI  (serialised + run in browser via page.evaluate)
// ─────────────────────────────────────────────────────────────────────────────
function buildReviewPanel(initData) {
  /* global document, window */
  const {
    uiActions, capturedApis, mode,
    featurePreview, yamlPreview,
    fileName, defaultFeatPath, defaultYamlPath, locatorFormat, locatorLayout,
  } = initData;

  // ── helpers (hoisted) ──────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function urlPath(fullUrl) {
    try { const u = new URL(fullUrl); return u.pathname + u.search; } catch { return fullUrl; }
  }
  function methodClass(m) {
    return ['GET','POST','PUT','PATCH','DELETE'].includes((m||'').toUpperCase())
      ? 'm-' + m.toUpperCase() : 'm-OTHER';
  }
  function statusClass(s) {
    if (s >= 500) return 's-5xx';
    if (s >= 400) return 's-4xx';
    if (s >= 300) return 's-3xx';
    return 's-2xx';
  }
  function statusGroup(s) {
    if (s >= 500) return '5xx';
    if (s >= 400) return '4xx';
    if (s >= 300) return '3xx';
    return '2xx';
  }

  // ── mutable state ──────────────────────────────────────────────────────────
  let curUi          = uiActions.map((a, i)  => ({ ...a,  _id: i }));
  let curApi         = capturedApis.map((a, i) => ({ ...a, _id: i }));
  let activeTab      = 'preview';
  let previewing     = false;
  let apiUrlFilter   = '';
  let apiStatusFilter= 'all';

  // ── styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    body {
      background:#020617; color:#e2e8f0;
      font-family:system-ui,'Segoe UI',Roboto,sans-serif;
      height:100vh; display:flex; flex-direction:column; overflow:hidden;
    }
    /* header */
    .rv-header {
      background:#0f172a; border-bottom:1px solid rgba(148,163,184,0.12);
      padding:12px 20px; display:flex; align-items:center;
      justify-content:space-between; flex-shrink:0; gap:16px;
    }
    .rv-title { font-size:14px; font-weight:900; color:#f1f5f9; }
    .rv-file  { font-size:11px; color:#475569; margin-top:2px; }
    .rv-save  {
      padding:9px 18px; border-radius:10px; border:0; cursor:pointer;
      background:linear-gradient(135deg,#4f46e5,#7c3aed);
      color:#fff; font-size:13px; font-weight:900;
      box-shadow:0 4px 14px rgba(79,70,229,0.4); transition:opacity .15s;
      white-space:nowrap; flex-shrink:0;
    }
    .rv-save:hover   { opacity:.88; }
    .rv-save:disabled{ opacity:.4; cursor:default; }
    /* tabs */
    .rv-tabs {
      display:flex; gap:2px; padding:10px 20px 0;
      background:#0f172a; border-bottom:1px solid rgba(148,163,184,0.10);
      flex-shrink:0;
    }
    .rv-tab {
      padding:7px 14px; border-radius:8px 8px 0 0; border:0;
      background:transparent; color:#475569;
      font-size:11.5px; font-weight:800; cursor:pointer;
      transition:all .15s; border:1px solid transparent;
      border-bottom:none; position:relative; top:1px;
    }
    .rv-tab:hover { color:#94a3b8; }
    .rv-tab.active {
      background:#020617; color:#a5b4fc;
      border-color:rgba(148,163,184,0.12);
    }
    .rv-badge {
      display:inline-block; padding:1px 6px; border-radius:9px;
      background:rgba(99,102,241,0.2); color:#818cf8;
      font-size:10px; font-weight:900; margin-left:4px;
    }
    /* content area */
    .rv-content { flex:1; overflow:hidden; display:flex; flex-direction:column; min-height:0; }
    .rv-pane    { flex:1; overflow-y:auto; padding:16px 20px; display:none; flex-direction:column; gap:6px; }
    .rv-pane.active { display:flex; }
    /* code preview (feature + yaml) */
    .rv-code {
      flex:1; background:#0a0f1e; color:#93c5fd;
      font-family:'Cascadia Code','Fira Code','Courier New',monospace;
      font-size:12px; line-height:1.7; padding:16px 20px;
      border-radius:12px; border:1px solid rgba(148,163,184,0.1);
      white-space:pre; overflow:auto; min-height:200px;
    }
    .rv-code.yaml-code { color:#86efac; }
    .rv-code.json-code { color:#fdba74; }
    .rv-refreshing { opacity:.45; transition:opacity .15s; }
    /* list items */
    .rv-item {
      display:flex; align-items:flex-start; gap:10px;
      background:#0f172a; border:1px solid rgba(148,163,184,0.1);
      border-radius:10px; padding:10px 14px;
      transition:border-color .15s;
    }
    .rv-item:hover { border-color:rgba(148,163,184,0.22); }
    .rv-item-body { flex:1; min-width:0; }
    .rv-item-type {
      display:inline-block; padding:2px 7px; border-radius:5px;
      font-size:10px; font-weight:900; margin-bottom:3px;
      letter-spacing:.05em; text-transform:uppercase;
    }
    .rv-item-main  { font-size:12px; color:#cbd5e1; word-break:break-all; }
    .rv-item-sub   { font-size:11px; color:#475569; margin-top:2px; word-break:break-all; }
    .rv-del {
      flex-shrink:0; width:26px; height:26px; border-radius:7px; border:0;
      background:rgba(220,38,38,0.1); color:#f87171;
      font-size:13px; font-weight:700; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:background .12s;
    }
    .rv-del:hover { background:rgba(220,38,38,0.25); }
    /* method badges */
    .m-GET    { background:rgba(34,197,94,.15);  color:#86efac; }
    .m-POST   { background:rgba(59,130,246,.15); color:#93c5fd; }
    .m-PUT    { background:rgba(234,179,8,.15);  color:#fde047; }
    .m-PATCH  { background:rgba(249,115,22,.15); color:#fdba74; }
    .m-DELETE { background:rgba(239,68,68,.15);  color:#fca5a5; }
    .m-OTHER  { background:rgba(148,163,184,.1); color:#94a3b8; }
    /* action type badges */
    .t-navigate { background:rgba(139,92,246,.15); color:#c4b5fd; }
    .t-click    { background:rgba(34,197,94,.15);  color:#86efac; }
    .t-input    { background:rgba(59,130,246,.15); color:#93c5fd; }
    .t-select   { background:rgba(234,179,8,.15);  color:#fde047; }
    .t-checkbox,.t-radio { background:rgba(249,115,22,.15); color:#fdba74; }
    /* status badges */
    .rv-status {
      display:inline-block; padding:1px 6px; border-radius:5px;
      font-size:10px; font-weight:800; margin-left:5px;
    }
    .s-2xx { background:rgba(34,197,94,.15); color:#86efac; }
    .s-3xx { background:rgba(59,130,246,.15); color:#93c5fd; }
    .s-4xx { background:rgba(234,179,8,.15);  color:#fde047; }
    .s-5xx { background:rgba(239,68,68,.15);  color:#fca5a5; }
    /* empty state */
    .rv-empty {
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      padding:48px 24px; color:#334155; font-size:13px; text-align:center; gap:10px;
    }
    .rv-empty-icon { font-size:32px; }
    .rv-empty-hint { font-size:11.5px; color:#1e293b; margin-top:4px; }
    /* API filter bar */
    .rv-filter-bar {
      display:flex; align-items:center; gap:8px; flex-shrink:0;
      background:#0d1424; border:1px solid rgba(148,163,184,0.1);
      border-radius:10px; padding:8px 12px; margin-bottom:4px;
      flex-wrap:wrap;
    }
    .rv-filter-input {
      flex:1; min-width:140px; background:transparent; border:0; outline:0;
      color:#e2e8f0; font-size:12px; font-family:inherit;
    }
    .rv-filter-input::placeholder { color:#334155; }
    .rv-filter-sep { width:1px; height:18px; background:rgba(148,163,184,0.12); flex-shrink:0; }
    .rv-filter-chips { display:flex; gap:4px; flex-wrap:wrap; }
    .rv-chip {
      padding:3px 9px; border-radius:6px; border:1px solid rgba(148,163,184,0.15);
      background:transparent; color:#475569; font-size:10.5px; font-weight:800;
      cursor:pointer; transition:all .12s; white-space:nowrap;
    }
    .rv-chip:hover { border-color:rgba(148,163,184,0.3); color:#94a3b8; }
    .rv-chip.active { background:rgba(99,102,241,0.15); border-color:#4f46e5; color:#a5b4fc; }
    .rv-chip.c-2xx.active  { background:rgba(34,197,94,.12);  border-color:#22c55e; color:#86efac; }
    .rv-chip.c-3xx.active  { background:rgba(59,130,246,.12); border-color:#3b82f6; color:#93c5fd; }
    .rv-chip.c-4xx.active  { background:rgba(234,179,8,.12);  border-color:#eab308; color:#fde047; }
    .rv-chip.c-5xx.active  { background:rgba(239,68,68,.12);  border-color:#ef4444; color:#fca5a5; }
    .rv-filter-count { font-size:11px; color:#334155; margin-left:auto; white-space:nowrap; }
    /* save paths footer */
    .rv-footer {
      background:#0d1424; border-top:1px solid rgba(148,163,184,0.1);
      padding:10px 20px; flex-shrink:0; display:flex; flex-direction:column; gap:6px;
    }
    .rv-path-row {
      display:flex; align-items:center; gap:10px;
    }
    .rv-path-label {
      font-size:10.5px; font-weight:800; color:#475569;
      text-transform:uppercase; letter-spacing:.06em; white-space:nowrap; width:60px;
    }
    .rv-path-input {
      flex:1; background:#020617; border:1px solid rgba(148,163,184,0.12);
      border-radius:7px; padding:5px 10px; color:#94a3b8; font-size:11.5px;
      font-family:'Cascadia Code','Fira Code','Courier New',monospace; outline:0;
      transition:border-color .15s;
    }
    .rv-path-input:focus { border-color:#4f46e5; color:#e2e8f0; }
    .rv-path-hint { font-size:10px; color:#1e293b; white-space:nowrap; }
  `;
  document.head.appendChild(style);

  // ── skeleton ───────────────────────────────────────────────────────────────
  document.body.innerHTML = '';

  const showUi  = mode === 'UI'  || mode === 'UI+API';
  const showApi = mode === 'API' || mode === 'UI+API';

  // header
  const header = document.createElement('div');
  header.className = 'rv-header';
  header.innerHTML = `
    <div>
      <div class="rv-title">🎬 Review &amp; Edit Captured Data</div>
      <div class="rv-file">${escHtml(fileName)}.feature</div>
    </div>
    <button class="rv-save" id="rv-save">💾&nbsp; Save &amp; Generate Files</button>
  `;
  document.body.appendChild(header);

  // tabs
  const tabBar = document.createElement('div');
  tabBar.className = 'rv-tabs';
  function makeTab(id, label, count) {
    const b = document.createElement('button');
    b.className = 'rv-tab' + (id === 'preview' ? ' active' : '');
    b.dataset.tab = id;
    b.innerHTML = label + (count !== undefined
      ? `<span class="rv-badge" id="badge-${id}">${count}</span>` : '');
    b.onclick = () => switchTab(id);
    return b;
  }
  const locTabLabel = locatorFormat === 'json' ? '📋 JSON' : '📋 YAML';
  tabBar.appendChild(makeTab('preview', '📄 Feature'));
  tabBar.appendChild(makeTab('yaml',    locTabLabel));
  if (showUi)  tabBar.appendChild(makeTab('ui',  '🖱 UI Actions',  curUi.length));
  if (showApi) tabBar.appendChild(makeTab('api', '🌐 API Calls',   curApi.length));
  document.body.appendChild(tabBar);

  // content area
  const contentArea = document.createElement('div');
  contentArea.className = 'rv-content';

  const previewPane = document.createElement('div');
  previewPane.className = 'rv-pane active';
  previewPane.id = 'pane-preview';
  previewPane.innerHTML = `<pre class="rv-code" id="rv-feature-text">${escHtml(featurePreview)}</pre>`;

  const yamlPane = document.createElement('div');
  yamlPane.className = 'rv-pane';
  yamlPane.id = 'pane-yaml';
  const locCodeClass = locatorFormat === 'json' ? 'rv-code json-code' : 'rv-code yaml-code';
  yamlPane.innerHTML = `<pre class="${locCodeClass}" id="rv-yaml-text">${escHtml(yamlPreview)}</pre>`;

  const uiPane = document.createElement('div');
  uiPane.className = 'rv-pane';
  uiPane.id = 'pane-ui';

  const apiPane = document.createElement('div');
  apiPane.className = 'rv-pane';
  apiPane.id = 'pane-api';

  contentArea.appendChild(previewPane);
  contentArea.appendChild(yamlPane);
  contentArea.appendChild(uiPane);
  contentArea.appendChild(apiPane);
  document.body.appendChild(contentArea);

  // footer: save-path inputs
  const footer = document.createElement('div');
  footer.className = 'rv-footer';
  footer.innerHTML = `
    <div class="rv-path-row">
      <span class="rv-path-label">Feature</span>
      <input class="rv-path-input" id="rv-feat-path" value="${escHtml(defaultFeatPath || '')}" spellcheck="false" />
      <span class="rv-path-hint">relative to project root</span>
    </div>
    <div class="rv-path-row">
      <span class="rv-path-label">${locatorFormat === 'json' ? 'JSON' : 'YAML'}</span>
      <input class="rv-path-input" id="rv-yaml-path" value="${escHtml(defaultYamlPath || '')}" spellcheck="false" />
      <span class="rv-path-hint">locator file (.${locatorFormat === 'json' ? 'json' : 'yaml'}) — ${locatorLayout === 'combined' ? 'combined (all pages)' : 'per-page'}</span>
    </div>
  `;
  document.body.appendChild(footer);

  // ── tab switch ─────────────────────────────────────────────────────────────
  function switchTab(id) {
    activeTab = id;
    document.querySelectorAll('.rv-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === id));
    document.querySelectorAll('.rv-pane').forEach(p =>
      p.classList.toggle('active', p.id === 'pane-' + id));
  }

  // ── API filter bar ─────────────────────────────────────────────────────────
  function buildApiFilterBar() {
    const bar = document.createElement('div');
    bar.className = 'rv-filter-bar';
    bar.id = 'rv-filter-bar';

    // URL input
    const inp = document.createElement('input');
    inp.className = 'rv-filter-input';
    inp.id = 'rv-api-url-filter';
    inp.placeholder = '🔍 Filter by URL…';
    inp.value = apiUrlFilter;
    inp.oninput = (e) => { apiUrlFilter = e.target.value; renderApiList(); };
    bar.appendChild(inp);

    bar.appendChild(Object.assign(document.createElement('div'), { className: 'rv-filter-sep' }));

    // Status chips
    const chips = document.createElement('div');
    chips.className = 'rv-filter-chips';
    chips.id = 'rv-status-chips';

    const groups = ['all', '2xx', '3xx', '4xx', '5xx'];
    groups.forEach(g => {
      const existingStatuses = curApi.map(a => a.status || 0);
      const hasEntries = g === 'all' || existingStatuses.some(s => statusGroup(s) === g);
      if (!hasEntries && g !== 'all') return;

      const chip = document.createElement('button');
      chip.className = 'rv-chip c-' + g + (apiStatusFilter === g ? ' active' : '');
      chip.dataset.status = g;
      chip.textContent = g === 'all' ? 'All' : g;
      chip.onclick = () => { apiStatusFilter = g; refreshStatusChips(); renderApiList(); };
      chips.appendChild(chip);
    });
    bar.appendChild(chips);

    // Count display
    const cnt = document.createElement('span');
    cnt.className = 'rv-filter-count';
    cnt.id = 'rv-api-count';
    bar.appendChild(cnt);

    return bar;
  }

  function refreshStatusChips() {
    document.querySelectorAll('#rv-status-chips .rv-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.status === apiStatusFilter));
  }

  function getFilteredApis() {
    return curApi.filter(api => {
      const full = (api.fullUrl || api.url || '').toLowerCase();
      if (apiUrlFilter && !full.includes(apiUrlFilter.toLowerCase())) return false;
      if (apiStatusFilter !== 'all') {
        if (statusGroup(api.status || 0) !== apiStatusFilter) return false;
      }
      return true;
    });
  }

  // ── render panes ───────────────────────────────────────────────────────────
  function renderUiList() {
    uiPane.innerHTML = '';
    if (!curUi.length) {
      uiPane.innerHTML = '<div class="rv-empty"><div class="rv-empty-icon">🖱</div>No UI actions captured</div>';
      return;
    }
    curUi.forEach(action => {
      const item = document.createElement('div');
      item.className = 'rv-item';
      const typeKey   = String(action.type || 'action').toLowerCase();
      const typeLabel = typeKey === 'navigate' ? '🔗 navigate'
        : typeKey === 'click'   ? '🖱 click'
        : typeKey === 'input'   ? '⌨ input'
        : typeKey === 'select'  ? '📋 select'
        : typeKey === 'checkbox'? '☑ checkbox'
        : typeKey === 'radio'   ? '⚪ radio'
        : typeKey;
      const mainText = action.type === 'navigate'
        ? escHtml(action.href || '')
        : action.type === 'input'
          ? `"${escHtml(action.value || '')}" → ${escHtml(action.element || '')}`
          : escHtml(action.element || '');
      const subText = action.type !== 'navigate' && action.href ? urlPath(action.href) : '';
      item.innerHTML = `
        <div class="rv-item-body">
          <span class="rv-item-type t-${typeKey}">${typeLabel}</span>
          <div class="rv-item-main">${mainText}</div>
          ${subText ? `<div class="rv-item-sub">${escHtml(subText)}</div>` : ''}
        </div>
        <button class="rv-del" title="Remove this action">✕</button>
      `;
      item.querySelector('.rv-del').onclick = () => removeUiAction(action._id);
      uiPane.appendChild(item);
    });
  }

  function renderApiList() {
    apiPane.innerHTML = '';

    if (!showApi) {
      apiPane.innerHTML = `
        <div class="rv-empty">
          <div class="rv-empty-icon">🌐</div>
          <div>Switch capture mode to <strong>API</strong> or <strong>UI+API</strong> to capture APIs.</div>
          <div class="rv-empty-hint">Current mode: <strong>${mode}</strong></div>
        </div>`;
      return;
    }

    // Filter bar (re-render each time to keep state)
    const oldBar = document.getElementById('rv-filter-bar');
    const newBar = buildApiFilterBar();
    if (oldBar) oldBar.replaceWith(newBar); else apiPane.appendChild(newBar);

    const filtered = getFilteredApis();

    // Count
    const cnt = document.getElementById('rv-api-count');
    if (cnt) cnt.textContent = `${filtered.length} / ${curApi.length}`;

    if (!curApi.length) {
      const empty = document.createElement('div');
      empty.className = 'rv-empty';
      empty.innerHTML = '<div class="rv-empty-icon">📭</div><div>No API calls captured</div>';
      apiPane.appendChild(empty);
      return;
    }

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'rv-empty';
      empty.innerHTML = '<div class="rv-empty-icon">🔍</div><div>No API calls match the filter</div>';
      apiPane.appendChild(empty);
      return;
    }

    filtered.forEach(api => {
      const item = document.createElement('div');
      item.className = 'rv-item';
      const method = (api.method || 'GET').toUpperCase();
      const spath  = urlPath(api.fullUrl || api.url || '');
      const sc     = api.status || 0;
      item.innerHTML = `
        <div class="rv-item-body">
          <span class="rv-item-type ${methodClass(method)}">${method}</span>
          <span class="rv-status ${statusClass(sc)}">${sc}</span>
          <div class="rv-item-main">${escHtml(spath)}</div>
          <div class="rv-item-sub">${escHtml(api.fullUrl || '')}</div>
        </div>
        <button class="rv-del" title="Remove this API call">✕</button>
      `;
      item.querySelector('.rv-del').onclick = () => removeApiCall(api._id);
      apiPane.appendChild(item);
    });
  }

  // ── delete + refresh previews ──────────────────────────────────────────────
  async function refreshPreviews() {
    if (previewing) return;
    previewing = true;
    const clean   = { uiActions: curUi, capturedApis: curApi };
    const featEl  = document.getElementById('rv-feature-text');
    const yamlEl  = document.getElementById('rv-yaml-text');
    if (featEl) featEl.classList.add('rv-refreshing');
    if (yamlEl) yamlEl.classList.add('rv-refreshing');
    try {
      const [feat, yml] = await Promise.all([
        window.pwReviewPreview(clean),
        window.pwReviewYaml(clean),
      ]);
      if (featEl) { featEl.textContent = feat; featEl.classList.remove('rv-refreshing'); }
      if (yamlEl) { yamlEl.textContent = yml;  yamlEl.classList.remove('rv-refreshing'); }
    } catch { /* ignore */ }
    previewing = false;
  }

  function updateBadge(id, count) {
    const el = document.getElementById('badge-' + id);
    if (el) el.textContent = count;
  }

  function removeUiAction(id) {
    curUi = curUi.filter(a => a._id !== id);
    updateBadge('ui', curUi.length);
    renderUiList();
    refreshPreviews();
  }

  function removeApiCall(id) {
    curApi = curApi.filter(a => a._id !== id);
    updateBadge('api', curApi.length);
    renderApiList();
    refreshPreviews();
  }

  // ── save button ────────────────────────────────────────────────────────────
  document.getElementById('rv-save').onclick = async () => {
    const btn = document.getElementById('rv-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const finalUi   = curUi.map(({ _id, ...rest }) => rest);
    const finalApi  = curApi.map(({ _id, ...rest }) => rest);
    const featPath  = (document.getElementById('rv-feat-path')  || {}).value || '';
    const yamlPath  = (document.getElementById('rv-yaml-path')  || {}).value || '';
    if (window.pwReviewSave)
      await window.pwReviewSave({ uiActions: finalUi, capturedApis: finalApi, featurePath: featPath, yamlPath });
  };

  // ── initial render ─────────────────────────────────────────────────────────
  renderUiList();
  renderApiList();
}
//   *.png  → match URLs whose path (before ?) ends with .png
//   plain  → match URLs that contain the string anywhere
// ─────────────────────────────────────────────────────────────────────────────
function isExcluded(url, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const lower   = (url || '').toLowerCase();
  const urlPath = lower.split('?')[0].split('#')[0];   // strip query + hash
  return patterns.some(raw => {
    const p = (raw || '').trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith('*.')) {
      // Extension pattern:  *.png  →  path must END with  .png
      return urlPath.endsWith(p.slice(1));
    }
    // Plain substring (URL, path prefix, etc.)
    return lower.includes(p);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse plain English scenario description → structured action objects.
// Handles: navigate, click, input (fill), select, checkbox, verify.
// ─────────────────────────────────────────────────────────────────────────────
function parseDomDescription(text) {
  if (!text || !text.trim()) return [];
  const actions = [];

  // Split on newlines; also split on ". " followed by a capital letter so a
  // single paragraph works the same as line-by-line input.
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const lines = [];
  for (const line of rawLines) {
    const subs = line.split(/\.(?=\s+[A-Z])/);
    for (const sub of subs) {
      const s = sub.trim().replace(/\.$/, '');
      if (s) lines.push(s);
    }
  }

  for (const line of lines) {
    // ── Navigate ──────────────────────────────────────────────────────────────
    {
      const m = line.match(/(?:go\s+to|navigate\s+to|open|visit|load)\s+(https?:\/\/[^\s'"]+)/i);
      if (m) {
        actions.push({ type: 'navigate', url: m[1].replace(/[.,'"]$/, '') });
        continue;
      }
    }

    // ── Enter text in field (quoted value) ───────────────────────────────────
    {
      const m = line.match(
        /(?:enter|type|input|fill|write)\s+['"]([^'"]+)['"]\s+(?:in(?:to)?|for)\s+(?:the\s+)?(.+?)(?:\s+(?:field|input|textbox|box))?$/i
      );
      if (m) {
        actions.push({ type: 'input', value: m[1].trim(), element: m[2].trim() });
        continue;
      }
    }
    // ── Enter text in field (unquoted value) ─────────────────────────────────
    {
      const m = line.match(
        /(?:enter|type|input|fill|write)\s+(\S+)\s+(?:in(?:to)?|for)\s+(?:the\s+)?(.+?)(?:\s+(?:field|input|textbox|box))?$/i
      );
      if (m && !/^https?:/i.test(m[1])) {
        actions.push({ type: 'input', value: m[1].trim(), element: m[2].trim() });
        continue;
      }
    }

    // ── Select from dropdown ──────────────────────────────────────────────────
    {
      const m = line.match(
        /(?:select|choose|pick)\s+['"]?([^'"]+?)['"]?\s+(?:from|in)\s+(?:the\s+)?(.+?)(?:\s+(?:dropdown|select|list|menu))?$/i
      );
      if (m) {
        actions.push({ type: 'select', value: m[1].trim(), element: m[2].trim() });
        continue;
      }
    }

    // ── Check checkbox ────────────────────────────────────────────────────────
    {
      const m = line.match(
        /(?:check|tick|enable)\s+(?:the\s+)?['"]?(.+?)['"]?(?:\s+(?:checkbox|check\s*box))?$/i
      );
      if (m && !/^https?:/i.test(m[1])) {
        actions.push({ type: 'checkbox', element: m[1].trim() });
        continue;
      }
    }

    // ── Verify web table ─────────────────────────────────────────────────────
    {
      const m = line.match(
        /(?:verify|check|assert|confirm)\s+(?:data\s+from\s+|information\s+(?:from\s+|in\s+)|)?['"]?([^'"]+?)['"]?\s+(?:web\s*)?table/i
      );
      if (m) {
        actions.push({ type: 'verify_table', tableName: m[1].trim() });
        continue;
      }
    }

    // ── Verify text visible ───────────────────────────────────────────────────
    {
      const m = line.match(
        /(?:verify|check|assert|confirm|see|should\s+see)\s+(?:that\s+)?['"]?([^'"]+?)['"]?\s+(?:text\s+)?(?:is\s+)?(?:present|visible|appears?|shown?|displayed?)/i
      );
      if (m) {
        actions.push({ type: 'verify', text: m[1].trim() });
        continue;
      }
    }

    // ── Click (last resort — broad) ───────────────────────────────────────────
    {
      const m = line.match(
        /(?:click|press|tap|hit)\s+(?:on\s+)?(?:the\s+)?['"]?(.+?)['"]?(?:\s+(?:button|btn|link|tab|icon))?$/i
      );
      if (m) {
        actions.push({ type: 'click', element: m[1].trim() });
        continue;
      }
    }
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM Mode recording:
//   1. Parses the plain English domDescription into action objects
//   2. Opens a Playwright browser (visible, slowMo for readability)
//   3. Executes each action — navigate / fill / click / select / checkbox
//   4. Scans the live DOM via page.evaluate() to find the best XPath locator
//   5. Populates uiActions[] in the same format as the other recording modes
//      so the review panel and converter work unchanged
// ─────────────────────────────────────────────────────────────────────────────
async function recordWithDom(config, uiActions) {
  const { chromium } = require('playwright');

  const actions = parseDomDescription(config.domDescription || '');

  if (!actions.length) {
    log('  ⚠️   No actions could be parsed from your description.\n');
    log('  Tip: use phrases like:\n');
    log('       "Go to https://..."\n');
    log('       "Enter john@test.com in the Email field"\n');
    log('       "Click the Login button"\n');
    log('       "Select Active from the Status dropdown"\n');
    log('       "Verify Welcome text is present"\n');
    return '';
  }

  log(`  🔍  DOM Mode: parsed ${actions.length} action(s). Opening browser...\n`);

  const browser = await chromium.launch({ headless: false, slowMo: 250 });
  const context = await browser.newContext();
  const page    = await context.newPage();

  // Persistent status overlay — survives page navigations
  await context.addInitScript(() => {
    function ensureOverlay() {
      if (document.getElementById('__dom_overlay__')) return;
      const el = document.createElement('div');
      el.id = '__dom_overlay__';
      el.style.cssText = [
        'position:fixed', 'bottom:18px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:2147483647',
        'background:rgba(2,6,23,0.94)',
        'border:1px solid rgba(99,102,241,0.4)',
        'border-radius:14px', 'padding:11px 24px',
        'font-family:system-ui,"Segoe UI",Roboto,sans-serif',
        'font-size:13px', 'color:#a5b4fc', 'font-weight:700',
        'box-shadow:0 8px 32px rgba(0,0,0,0.55)',
        'white-space:nowrap', 'max-width:88vw',
        'overflow:hidden', 'text-overflow:ellipsis',
        'pointer-events:none',
        'letter-spacing:0.01em',
      ].join(';');
      el.textContent = '🔍 DOM Mode — starting...';
      const attach = () => document.body && document.body.appendChild(el);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
      else attach();
    }
    ensureOverlay();
    window.__domStatus = function(msg) {
      let el = document.getElementById('__dom_overlay__');
      if (!el) { ensureOverlay(); el = document.getElementById('__dom_overlay__'); }
      if (el) el.textContent = '🔍 ' + msg;
    };
  });

  let firstUrl = config.startUrl || '';

  for (let i = 0; i < actions.length; i++) {
    const action  = actions[i];
    const stepNum = `[${i + 1}/${actions.length}]`;

    try {
      // ── Navigate ──────────────────────────────────────────────────────────
      if (action.type === 'navigate') {
        log(`  ${stepNum} ➜  Navigate to ${action.url}\n`);
        await page.evaluate(u => window.__domStatus && window.__domStatus('Navigating → ' + u), action.url).catch(() => {});
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        if (!firstUrl) firstUrl = action.url;
        uiActions.push({ type: 'navigate', href: action.url, timestamp: Date.now() });

      // ── Fill text input ───────────────────────────────────────────────────
      } else if (action.type === 'input') {
        log(`  ${stepNum} ⌨  Enter "${action.value}" in "${action.element}"\n`);
        await page.evaluate(n => window.__domStatus && window.__domStatus('Entering text → ' + n), action.element).catch(() => {});

        const loc = await page.evaluate(({ name }) => {
          const lower = name.toLowerCase().trim();
          function sc(v) {
            const vl = (v || '').toLowerCase().trim();
            if (!vl) return 0;
            if (vl === lower) return 100;
            if (vl.includes(lower) || lower.includes(vl)) return 55;
            return 0;
          }
          let best = null, bestScore = 0;
          for (const el of document.querySelectorAll(
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])' +
            ':not([type="submit"]):not([type="button"]):not([type="file"]), textarea'
          )) {
            const aria = el.getAttribute('aria-label') || '';
            const ph   = el.getAttribute('placeholder') || '';
            const nm   = el.getAttribute('name')  || '';
            const id   = el.id || '';
            let lbl    = '';
            if (id) { const l = document.querySelector('label[for="' + id + '"]'); if (l) lbl = (l.textContent || '').trim(); }
            const s = Math.max(sc(aria), sc(ph), sc(nm), sc(id), sc(lbl));
            if (s > bestScore) { bestScore = s; best = el; }
          }
          if (!best || bestScore === 0) return null;
          const aria = best.getAttribute('aria-label');
          const ph   = best.getAttribute('placeholder');
          const id   = best.id;
          const nm   = best.getAttribute('name');
          let xpath;
          if (id)        xpath = `//*[@id="${id}"]`;
          else if (aria) xpath = `//*[@aria-label="${aria}"]`;
          else if (ph)   xpath = `//input[@placeholder="${ph}"]`;
          else if (nm)   xpath = `//*[@name="${nm}"]`;
          else return null;
          return xpath;
        }, { name: action.element });

        if (loc) {
          await page.fill(`xpath=${loc}`, action.value, { timeout: 5000 });
          uiActions.push({
            type: 'input', element: action.element, value: action.value,
            controlKind: 'textbox', href: page.url(),
            locator: ['xpath', loc], timestamp: Date.now(),
          });
          log(`  ✔   Done.\n`);
        } else {
          log(`  ⚠️   Input not found for: "${action.element}"\n`);
        }

      // ── Click button / link ───────────────────────────────────────────────
      } else if (action.type === 'click') {
        log(`  ${stepNum} 🖱  Click "${action.element}"\n`);
        await page.evaluate(n => window.__domStatus && window.__domStatus('Clicking → ' + n), action.element).catch(() => {});

        const info = await page.evaluate(({ name }) => {
          const lower = name.toLowerCase().trim();
          function sc(v) {
            const vl = (v || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!vl) return 0;
            if (vl === lower) return 100;
            if (vl.includes(lower) || lower.includes(vl)) return 55;
            return 0;
          }
          let best = null, bestScore = 0;
          for (const el of document.querySelectorAll(
            'button, a, [role="button"], [role="link"], input[type="submit"], input[type="button"]'
          )) {
            if (el.id === '__dom_overlay__' || el.closest('#__dom_overlay__')) continue;
            const txt  = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
            const aria = el.getAttribute('aria-label') || '';
            const id   = el.id || '';
            const s = Math.max(sc(txt), sc(aria), sc(id));
            if (s > bestScore) { bestScore = s; best = el; }
          }
          if (!best || bestScore === 0) return null;
          const tag  = best.tagName.toLowerCase();
          const role = (best.getAttribute('role') || '').toLowerCase();
          const kind = (tag === 'a' || role === 'link') ? 'link' : 'button';
          const txt  = (best.textContent || best.value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          const aria = best.getAttribute('aria-label');
          const id   = best.id;
          let xpath;
          if (id)              xpath = `//*[@id="${id}"]`;
          else if (aria)       xpath = `//*[@aria-label="${aria}"]`;
          else if (tag === 'button') xpath = `//button[normalize-space()="${txt}"]`;
          else if (tag === 'a')      xpath = `//a[normalize-space()="${txt}"]`;
          else                       xpath = `//*[normalize-space()="${txt}"]`;
          return { xpath, kind };
        }, { name: action.element });

        if (info && info.xpath) {
          const hrefBefore = page.url();
          await page.click(`xpath=${info.xpath}`, { timeout: 5000 });
          await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
          await page.waitForLoadState('networkidle',      { timeout: 5000 }).catch(() => {});
          uiActions.push({
            type: 'click', element: action.element,
            controlKind: info.kind, href: hrefBefore,
            locator: ['xpath', info.xpath], timestamp: Date.now(),
          });
          log(`  ✔   Done.\n`);
        } else {
          log(`  ⚠️   Clickable element not found: "${action.element}"\n`);
        }

      // ── Select dropdown ───────────────────────────────────────────────────
      } else if (action.type === 'select') {
        log(`  ${stepNum} 📋  Select "${action.value}" from "${action.element}"\n`);
        await page.evaluate(n => window.__domStatus && window.__domStatus('Selecting from → ' + n), action.element).catch(() => {});

        const loc = await page.evaluate(({ name }) => {
          const lower = name.toLowerCase().trim();
          function sc(v) {
            const vl = (v || '').toLowerCase().trim();
            if (!vl) return 0;
            if (vl === lower) return 100;
            if (vl.includes(lower) || lower.includes(vl)) return 55;
            return 0;
          }
          let best = null, bestScore = 0;
          for (const el of document.querySelectorAll('select')) {
            const aria = el.getAttribute('aria-label') || '';
            const nm   = el.getAttribute('name') || '';
            const id   = el.id || '';
            let lbl    = '';
            if (id) { const l = document.querySelector('label[for="' + id + '"]'); if (l) lbl = (l.textContent || '').trim(); }
            const s = Math.max(sc(aria), sc(nm), sc(id), sc(lbl));
            if (s > bestScore) { bestScore = s; best = el; }
          }
          if (!best || bestScore === 0) return null;
          const id = best.id;
          const nm = best.getAttribute('name');
          if (id) return `//select[@id="${id}"]`;
          if (nm) return `//select[@name="${nm}"]`;
          return null;
        }, { name: action.element });

        if (loc) {
          await page.selectOption(`xpath=${loc}`, { label: action.value }, { timeout: 5000 })
            .catch(() => page.selectOption(`xpath=${loc}`, { value: action.value }, { timeout: 5000 }));
          uiActions.push({
            type: 'select', element: action.element, value: action.value,
            controlKind: 'select', href: page.url(),
            locator: ['xpath', loc], timestamp: Date.now(),
          });
          log(`  ✔   Done.\n`);
        } else {
          log(`  ⚠️   Select element not found: "${action.element}"\n`);
        }

      // ── Checkbox ──────────────────────────────────────────────────────────
      } else if (action.type === 'checkbox') {
        log(`  ${stepNum} ☑  Check "${action.element}"\n`);
        await page.evaluate(n => window.__domStatus && window.__domStatus('Checking → ' + n), action.element).catch(() => {});

        const loc = await page.evaluate(({ name }) => {
          const lower = name.toLowerCase().trim();
          function sc(v) {
            const vl = (v || '').toLowerCase().trim();
            if (!vl) return 0;
            if (vl === lower) return 100;
            if (vl.includes(lower) || lower.includes(vl)) return 55;
            return 0;
          }
          let best = null, bestScore = 0;
          for (const el of document.querySelectorAll('input[type="checkbox"]')) {
            const aria = el.getAttribute('aria-label') || '';
            const id   = el.id || '';
            const nm   = el.getAttribute('name') || '';
            let lbl    = '';
            if (id) { const l = document.querySelector('label[for="' + id + '"]'); if (l) lbl = (l.textContent || '').trim(); }
            const s = Math.max(sc(aria), sc(id), sc(nm), sc(lbl));
            if (s > bestScore) { bestScore = s; best = el; }
          }
          if (!best || bestScore === 0) return null;
          const id = best.id;
          const nm = best.getAttribute('name');
          if (id) return `//input[@type="checkbox" and @id="${id}"]`;
          if (nm) return `//input[@type="checkbox" and @name="${nm}"]`;
          return null;
        }, { name: action.element });

        if (loc) {
          await page.check(`xpath=${loc}`, { timeout: 5000 });
          uiActions.push({
            type: 'checkbox', element: action.element,
            controlKind: 'checkbox', href: page.url(),
            locator: ['xpath', loc], timestamp: Date.now(),
          });
          log(`  ✔   Done.\n`);
        } else {
          log(`  ⚠️   Checkbox not found: "${action.element}"\n`);
        }

      // ── Verify text visible ───────────────────────────────────────────────
      } else if (action.type === 'verify') {
        log(`  ${stepNum} 👁  Verify "${action.text}" is visible\n`);
        await page.evaluate(t => window.__domStatus && window.__domStatus('Verifying text → ' + t), action.text).catch(() => {});
        const visible = await page.locator(`text=${action.text}`).first()
          .isVisible({ timeout: 5000 }).catch(() => false);
        if (visible) {
          log(`  ✔   "${action.text}" found on page.\n`);
          uiActions.push({
            type: 'verify', element: action.text, value: action.text,
            controlKind: 'text', href: page.url(),
            locator: ['xpath', `//*[contains(normalize-space(.), "${action.text}")]`],
            timestamp: Date.now(),
          });
        } else {
          log(`  ⚠️   "${action.text}" not visible on page — step skipped.\n`);
        }

      // ── Verify web table — scan live DOM, capture headers + rows ───────────
      } else if (action.type === 'verify_table') {
        log(`  ${stepNum} 📊  Verify web table "${action.tableName}"\n`);
        await page.evaluate(t => window.__domStatus && window.__domStatus('Scanning table → ' + t), action.tableName).catch(() => {});

        const tableData = await page.evaluate(({ name }) => {
          const lower = name.toLowerCase().trim();
          function scoreTable(el) {
            // caption, aria-label, summary, id, or a th that contains the name
            const caption  = (el.querySelector('caption') || {}).textContent || '';
            const aria     = el.getAttribute('aria-label') || '';
            const summary  = el.getAttribute('summary') || '';
            const id       = el.id || '';
            const thTexts  = [...el.querySelectorAll('thead th, tr:first-child th')]
              .map(th => (th.textContent || '').trim()).join(' ');
            const candidates = [caption, aria, summary, id, thTexts];
            for (const c of candidates) {
              const cl = c.toLowerCase();
              if (cl === lower) return 100;
              if (cl.includes(lower) || lower.includes(cl)) return 55;
            }
            return 0;
          }

          const tables = [...document.querySelectorAll('table')];
          if (!tables.length) return null;

          // Find best-matching table; fall back to the first table on the page
          let best = tables[0], bestScore = 0;
          for (const tbl of tables) {
            const s = scoreTable(tbl);
            if (s > bestScore) { bestScore = s; best = tbl; }
          }

          // Extract headers from <thead th> or first <tr th>
          const headerEls = best.querySelectorAll('thead th, thead td');
          const headers = headerEls.length
            ? [...headerEls].map(h => (h.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
            : [...(best.querySelector('tr') || { querySelectorAll: () => [] })
                .querySelectorAll('th, td')]
              .map(h => (h.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);

          // Extract body rows (skip header row)
          const bodyRows = best.querySelectorAll('tbody tr');
          const srcRows  = bodyRows.length
            ? [...bodyRows]
            : [...best.querySelectorAll('tr')].slice(1);

          const rows = srcRows.slice(0, 10).map(tr =>
            [...tr.querySelectorAll('td, th')]
              .map(td => (td.textContent || '').replace(/\s+/g, ' ').trim())
          ).filter(r => r.some(c => c));

          // Resolve a caption or aria-label to use as the table name
          const resolvedName =
            (best.querySelector('caption') || {}).textContent ||
            best.getAttribute('aria-label') || name;

          return { tableName: resolvedName.trim(), headers, rows };
        }, { name: action.tableName });

        if (tableData && (tableData.headers.length || tableData.rows.length)) {
          const payload = JSON.stringify({
            tableName: tableData.tableName,
            headers  : tableData.headers,
            rows     : tableData.rows,
          });
          uiActions.push({
            type: 'assert_web_table', element: tableData.tableName, value: payload,
            controlKind: 'table', href: page.url(),
            locator: ['xpath', '//table'], timestamp: Date.now(),
          });
          log(`  ✔   Captured "${tableData.tableName}" — ` +
              `${tableData.headers.length} column(s), ${tableData.rows.length} row(s).\n`);
        } else {
          log(`  ⚠️   No table found matching "${action.tableName}" — step skipped.\n`);
        }
      }

      await new Promise(r => setTimeout(r, 350));   // brief pause between steps

    } catch (err) {
      log(`  ⚠️   ${stepNum} Failed: ${err.message || String(err)}\n`);
    }
  }

  await page.evaluate(() => window.__domStatus && window.__domStatus('Done ✓ — generating files...')).catch(() => {});
  await new Promise(r => setTimeout(r, 1200));

  try { await browser.close(); } catch {}

  log(`  ✔   DOM Mode complete — ${uiActions.length} action(s) captured.\n`);
  return firstUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
main().catch(err => {
  log('\n  ❌  ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
