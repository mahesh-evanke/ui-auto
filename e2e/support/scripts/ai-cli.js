#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  AI Scenario CLI  —  standalone interactive assistant (separate from pw/record)
 * ────────────────────────────────────────────────────────────────────────────
 *  Run:  npm run ai
 *
 *  An interactive REPL (like the Claude Code / Codex CLI). The LLM backend is the
 *  GitHub Copilot CLI — there are NO direct HTTP/API calls. You point it at a URL,
 *  then describe what you want tested in plain English. It:
 *    1. Scrapes the live page for real interactive elements + unique xpaths.
 *    2. Asks Copilot CLI to design ALL relevant test scenarios (happy path,
 *       negative, boundary, validation, etc.) using the framework's Gherkin grammar.
 *    3. Writes <name>.feature and <name>.yaml into the generated/ai folder.
 *
 *  Commands inside the REPL:
 *    /copilot <command>   set the Copilot CLI command template (use {prompt})
 *    /testllm             verify the Copilot backend works
 *    /url <url>           set the target URL to analyze
 *    /name <prefix>       optional filename prefix (default: AI names files per scenario)
 *    /notes <path>        attach a .txt/.md/.docx requirements file
 *    /fix <feature>       replay a feature live + auto-correct steps and yaml
 *    /show                show current config
 *    /scrape              re-scrape the current URL and list found elements
 *    /config /clear /help /exit
 *
 *  Anything else you type is treated as a generation prompt.
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── Paths ───────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'e2e', 'config', 'llm.json');
const FEATURE_DIR = path.join(ROOT, 'e2e', 'features', 'generated', 'ai');
const LOCATOR_DIR = path.join(ROOT, 'e2e', 'locators', 'generated', 'ai');
// Per-page yamls written here for runtime (findLocatorFile looks here).
const LOCATOR_PAGES_DIR = path.join(LOCATOR_DIR, 'pages');
// Playwright spec.ts files for "spec" / "both" modes.
const SPEC_DIR = path.join(ROOT, 'e2e', 'spec', 'generated', 'ai');

// ── Colors ──────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  magenta: '\x1b[35m', blue: '\x1b[34m', gray: '\x1b[90m',
};
// When embedded (e.g. the MCP server), send all human logs to STDERR so STDOUT
// stays a clean JSON-RPC channel. Set AI_MCP=1 to enable.
const OUT = process.env.AI_MCP ? process.stderr : process.stdout;
const log = (s = '') => OUT.write(s + '\n');
const info = (s) => log(`${c.cyan}${s}${c.reset}`);
const ok = (s) => log(`${c.green}${s}${c.reset}`);
const warn = (s) => log(`${c.yellow}${s}${c.reset}`);
const err = (s) => log(`${c.red}${s}${c.reset}`);

// ── Notes / requirements context (loaded via /notes) ──────────────────────────
// Holds extracted text from .txt / .md / .docx files the user attaches so the LLM
// designs scenarios from real requirements, not just the page DOM.
const notes = []; // [{ name, text }]

// Extract plain text from a .txt, .md, or .docx file.
async function extractFileText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const JSZip = require('jszip');
    const buf = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) throw new Error('not a valid .docx (missing word/document.xml)');
    const xml = await docXmlFile.async('string');
    // Paragraph breaks → newlines; <w:t> runs → text; strip the rest.
    return xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  if (ext === '.doc') throw new Error('legacy .doc not supported — save as .docx or .txt');
  // .txt, .md, anything else → read as UTF-8 text
  return fs.readFileSync(filePath, 'utf8');
}

function notesBlock() {
  if (!notes.length) return '';
  const joined = notes.map((n) => `=== ${n.name} ===\n${n.text}`).join('\n\n');
  // Cap to keep the request within model limits.
  const capped = joined.length > 16000 ? joined.slice(0, 16000) + '\n…(truncated)…' : joined;
  return `\nRequirements / notes provided by the tester (treat these as the source of truth for WHAT to test):\n${capped}\n`;
}

// ── Config ──────────────────────────────────────────────────────────────────
// The LLM backend is the GitHub Copilot CLI (no direct HTTP/API calls).
// `copilot` is a command TEMPLATE. Use {prompt} where the prompt text should go
// as a single argument; if {prompt} is omitted, the prompt is piped via stdin.
// mode controls what the LLM generates:
//   'gherkin' — .feature + locators yaml  (default)
//   'spec'    — Playwright spec.ts only
//   'both'    — .feature + locators yaml + spec.ts
//
// yamlformat controls how locator yaml files are written:
//   'combined' — ONE file with all pages as top-level sections (default)
//                  birthday:
//                    MONTH:
//                      - xpath
//                      - //*[@id='B-month']
//   'perpage'  — one <pageKey>.yaml file per page (legacy format)
const DEFAULT_CONFIG = {
  copilot: 'copilot -p {prompt} --allow-all-tools',  // adjust to match your CLI; verify with /testllm
  url: '',
  fileName: '',
  mode: 'gherkin',
  yamlformat: 'combined',
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // fileName is intentionally NOT restored — feature files are named by the AI
      // from each scenario, so a leftover /name must not bleed into a new target.
      return { ...DEFAULT_CONFIG, ...raw, fileName: '' };
    }
  } catch (e) {
    warn(`  Could not read config (${e.message}); using defaults.`);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  const toSave = { copilot: cfg.copilot, url: cfg.url, mode: cfg.mode, yamlformat: cfg.yamlformat };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf8');
}

// ── LLM client (GitHub Copilot CLI) ──────────────────────────────────────────
// Splits a command template into argv, respecting simple quotes. {prompt} → the
// prompt as one argv entry; otherwise the prompt is piped to the process stdin.
function tokenizeCommand(tpl) {
  return (String(tpl || '').match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
}

// cmd.exe (used when shell:true on Windows) has an 8191-char command-line limit.
// For prompts that would exceed it, we fall back to piping via stdin instead of
// passing the prompt as a -p <arg> (copilot reads from stdin when no -p given).
const CMD_LINE_LIMIT = 7000;

// Resolve bare "copilot" to the actual platform executable path so the spawned
// shell can find it regardless of how the parent process was launched.
// Returns the resolved command string (may be unchanged if already a full path).
function resolveCopilotBin(cmd) {
  // Already a full/relative path — use as-is.
  if (cmd.includes('/') || cmd.includes('\\')) return cmd;

  if (process.platform === 'win32') {
    // npm global bin on Windows is %APPDATA%\npm\<name>.cmd
    const npmBin = process.env.APPDATA ? require('path').join(process.env.APPDATA, 'npm') : '';
    const candidate = npmBin ? require('path').join(npmBin, `${cmd}.cmd`) : '';
    if (candidate && fs.existsSync(candidate)) return candidate;
  } else {
    // Linux / macOS: npm global prefix is usually /usr/local or ~/.npm-global
    const prefixCandidates = ['/usr/local/bin', '/usr/bin', `${process.env.HOME || ''}/.npm-global/bin`];
    for (const dir of prefixCandidates) {
      const candidate = require('path').join(dir, cmd);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return cmd; // fall back to bare name — rely on PATH
}

// Build a PATH string that includes both the npm global bin dir and the Node.js
// binary dir. copilot.cmd calls "node" internally, so node must be findable.
function buildSpawnEnv() {
  const env = { ...process.env };
  const sep = process.platform === 'win32' ? ';' : ':';
  const extra = [];

  // npm global bin (so bare "copilot" resolves)
  if (process.platform === 'win32' && process.env.APPDATA) {
    extra.push(require('path').join(process.env.APPDATA, 'npm'));
  }
  // Node.js binary dir (copilot.cmd calls "node"; it must be on PATH in the subshell)
  const nodeBin = require('path').dirname(process.execPath);
  if (nodeBin) extra.push(nodeBin);

  const currentPath = env.PATH || env.Path || '';
  const additions = extra.filter((d) => d && !currentPath.includes(d)).join(sep);
  if (additions) env.PATH = additions + sep + currentPath;
  return env;
}

function runCopilot(cfg, prompt) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const tokens = tokenizeCommand(cfg.copilot || 'copilot -p {prompt}');
    if (!tokens.length) return reject(new Error('Empty copilot command. Set it with /copilot <command>.'));

    // Resolve the executable and build an enriched PATH for the child process.
    const rawCmd = tokens[0];
    const cmd = resolveCopilotBin(rawCmd);
    const spawnEnv = buildSpawnEnv();
    const usesPlaceholder = tokens.includes('{prompt}');

    // .cmd/.bat shims on Windows must be run through a shell.
    // On Linux/Mac we never need a shell (avoids all quoting pitfalls).
    const useShell = process.platform === 'win32' && (cmd.endsWith('.cmd') || cmd.endsWith('.bat'));

    // On Windows, cmd.exe mangles quoted args (outer-quote stripping, newline truncation,
    // 8191-char limit). The safest fix: always pipe via stdin when running through a shell.
    // On Linux/Mac the -p arg works fine so only fall back on very long prompts.
    const promptTooLong = usesPlaceholder && (cmd.length + prompt.length) > CMD_LINE_LIMIT;
    const useStdin = !usesPlaceholder || (useShell && usesPlaceholder) || promptTooLong;

    // When shell:true on Windows, cmd.exe uses "" to escape a double-quote inside
    // a quoted arg. Newlines inside cmd.exe quoted args terminate the string — collapse.
    const quoteArg = (s) => useShell
      ? `"${s.replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`
      : s;

    // Build args: when using stdin, drop the -p flag and {prompt} placeholder.
    const tailTokens = tokens.slice(1);
    const args = useStdin
      ? tailTokens.filter((t, i) => {
          if (t === '{prompt}') return false;
          if (tailTokens[i + 1] === '{prompt}') return false;
          return true;
        })
      : tailTokens.map((t) => (t === '{prompt}' ? quoteArg(prompt) : t));

    let child;
    try {
      child = spawn(cmd, args, { shell: useShell, windowsHide: true, env: spawnEnv });
    } catch (e) {
      return reject(new Error(`Cannot start "${cmd}": ${e.message}`));
    }
    let out = '', erro = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { erro += d; });
    child.on('error', (e) => reject(new Error(`Cannot run "${cmd}": ${e.message} (set the command with /copilot, e.g. "cmd /c copilot -p {prompt}")`)));
    child.on('close', (code) => {
      if (!out.trim() && code !== 0) reject(new Error(`copilot exited ${code}: ${erro.slice(0, 400) || '(no output)'}`));
      else resolve(out);
    });
    if (useStdin) { try { child.stdin.write(prompt); child.stdin.end(); } catch { /* ignore */ } }
  });
}

async function chatLLM(cfg, messages) {
  // Flatten the chat messages into a single prompt for the Copilot CLI.
  const prompt = messages
    .map((m) => (m.role === 'system' ? '# Instructions\n' : m.role === 'assistant' ? '# Previous answer\n' : '# Task\n') + m.content)
    .join('\n\n')
    + '\n\nReturn ONLY the JSON described above. No prose, no explanations, no markdown code fences.';
  return runCopilot(cfg, prompt);
}

// ── Page scraping ─────────────────────────────────────────────────────────────
// Wait for an SPA (React/Angular/Vue) page to finish rendering its interactive
// content before scraping/acting. Many apps (e.g. the SSA quiz) render the form
// after JS hydration, so a fixed short delay misses everything.
async function settlePage(page) {
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.locator('[data-test], input, button, select, [role="radio"], a[href]').first()
    .waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function scrapePage(url) {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settlePage(page);
    return await page.evaluate(scrapeBrowserSide);
  } finally {
    await browser.close();
  }
}

/* eslint-disable */
function scrapeBrowserSide() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const lit = (s) => {
    s = String(s);
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    return 'concat(' + s.split("'").map((p) => `"${p}"`).join(`,"'",`) + ')';
  };
  const count = (xp) => {
    try { return document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength; }
    catch { return -1; }
  };
  function uniqueXPath(el) {
    const tag = el.tagName.toLowerCase();
    const text = norm(el.textContent);
    const cands = [];
    const id = el.getAttribute('id');
    const aria = el.getAttribute('aria-label');
    const ph = el.getAttribute('placeholder');
    const name = el.getAttribute('name');
    if (id) cands.push(`//*[@id=${lit(id)}]`);
    if (aria) cands.push(`//*[@aria-label=${lit(aria)}]`);
    if (ph) cands.push(`//${tag}[@placeholder=${lit(ph)}]`);
    if (name) cands.push(`//${tag}[@name=${lit(name)}]`);
    for (const a of Array.from(el.attributes)) {
      if (a.name.indexOf('data-') === 0 && a.value) cands.push(`//${tag}[@${a.name}=${lit(a.value)}]`);
    }
    if ((tag === 'a' || tag === 'button') && text && text.length < 80) cands.push(`//${tag}[normalize-space(.)=${lit(text)}]`);
    for (const x of cands) if (count(x) === 1) return x;
    for (const x of cands) if (count(x) >= 1) return `(${x})[1]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const nid = node.getAttribute && node.getAttribute('id');
      if (nid && count(`//*[@id=${lit(nid)}]`) === 1) return `//*[@id=${lit(nid)}]` + (parts.length ? '/' + parts.join('/') : '');
      let i = 1, sib = node.previousElementSibling;
      while (sib) { if (sib.tagName === node.tagName) i++; sib = sib.previousElementSibling; }
      parts.unshift(`${node.tagName.toLowerCase()}[${i}]`);
      node = node.parentElement;
    }
    return '/html/' + parts.join('/');
  }
  function labelFor(el) {
    const aria = el.getAttribute('aria-label'); if (aria) return aria.trim();
    if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) return norm(l.textContent); }
    const wrap = el.closest('label'); if (wrap) return norm(wrap.textContent);
    return '';
  }
  function nameOf(el, kind) {
    const tag = el.tagName.toLowerCase();
    return norm(
      labelFor(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
      (tag === 'a' || tag === 'button' ? norm(el.textContent) : '') ||
      el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('title') || kind
    ).slice(0, 60);
  }
  const out = [];
  const seen = new Set();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  // Skip page chrome — footer, nav, cookie/gov banners — so scenarios focus on the
  // actual content (e.g. the quiz), not "About SSA / Privacy / FOIA" footer links.
  const inChrome = (el) => !!(el.closest && el.closest(
    'footer, nav, [role="contentinfo"], [role="navigation"], [role="banner"], header, ' +
    '.usa-footer, .usa-banner, [class*="footer"], [class*="cookie"], [class*="skip"]'
  ));
  const add = (el, kind) => {
    if (!visible(el) || inChrome(el)) return;
    const name = nameOf(el, kind);
    if (!name) return;
    const key = kind + '::' + name;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, kind, xpath: uniqueXPath(el) });
  };

  // Custom controls FIRST so quiz options (data-test radios, ARIA radios, option
  // cards) are captured even when they are not native <input> elements.
  // IMPORTANT: skip the hidden native <input> of a custom radio/checkbox — clicking
  // it does not register in React; the visible <label> is the real clickable. So we
  // capture LABELS for radios/checkboxes and skip the *-button/*-input inputs.
  document.querySelectorAll('[data-test], [role="radio"], [role="checkbox"], [role="option"]').forEach((e) => {
    const dt = (e.getAttribute('data-test') || '').toLowerCase();
    const role = (e.getAttribute('role') || '').toLowerCase();
    const tag = e.tagName.toLowerCase();
    // Hidden input half of a custom control → skip; its label is captured below.
    if (tag === 'input' && /radio|check/.test(dt)) return;
    let kind = 'button';
    if (role === 'radio' || /radio/.test(dt)) kind = 'radio';
    else if (role === 'checkbox' || /check/.test(dt)) kind = 'checkbox';
    else if (role === 'option' || /option|item|answer|choice/.test(dt)) kind = 'option';
    else if (/next|submit|continue|start|btn|button/.test(dt)) kind = 'button';
    add(e, kind);
  });
  // Quiz answer labels: a <label> that wraps or points to a radio/checkbox input.
  // Only treat it as radio/checkbox when the ASSOCIATED input is actually that type —
  // labels for text fields (e.g. "Month"/"Day"/"Year" for DOB inputs) must NOT be
  // captured as radios, or the planner clicks them instead of typing the date.
  document.querySelectorAll('label').forEach((e) => {
    let inner = e.querySelector('input[type="radio"],input[type="checkbox"]');
    if (!inner && e.getAttribute('for')) inner = document.getElementById(e.getAttribute('for'));
    if (!inner || inner.tagName.toLowerCase() !== 'input') return;
    const t = (inner.getAttribute('type') || '').toLowerCase();
    if (t === 'radio') add(e, 'radio');
    else if (t === 'checkbox') add(e, 'checkbox');
    // label for a textbox/select → skip; the input itself is captured separately
  });

  // Native radios/checkboxes: only capture the ones that are NOT paired with a label
  // (a label[for] or wrapping label) — those were already captured as the label.
  document.querySelectorAll('input[type="radio"], [role="radio"]').forEach((e) => {
    const hasLabel = (e.id && document.querySelector(`label[for="${e.id}"]`)) || (e.closest && e.closest('label'));
    if (!hasLabel) add(e, 'radio');
  });
  document.querySelectorAll('input[type="checkbox"], [role="checkbox"]').forEach((e) => {
    const hasLabel = (e.id && document.querySelector(`label[for="${e.id}"]`)) || (e.closest && e.closest('label'));
    if (!hasLabel) add(e, 'checkbox');
  });
  document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"], input[type="number"], input:not([type]), textarea').forEach((e) => add(e, 'textbox'));
  document.querySelectorAll('select, [role="combobox"]').forEach((e) => add(e, 'dropdown'));
  document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((e) => add(e, 'button'));
  document.querySelectorAll('a[href]').forEach((e) => add(e, 'link'));

  return { title: document.title, elements: out.slice(0, 150) };
}
/* eslint-enable */

// ── Prompt building ───────────────────────────────────────────────────────────
function systemPrompt() {
  return [
    'You are a senior QA automation engineer. You design Gherkin (Cucumber) test',
    'scenarios for a Playwright framework. You MUST only use these exact step templates:',
    '',
    '  Given User navigates to "<url>" URL',
    '  And User is on "<pageKey>" screen',
    '  When User clicks on "<name>" button',
    '  When clicks on "<name>" link',
    '  When clicks on "<name>" Radio button',
    '  Given select "<name>" Checkbox',
    '  Given enters "<value>" text in "<name>" textbox',
    '  When selects "<value>" text from "<name>" Drop-down list',
    '  When verify "<text>" text is present on the screen',
    '  When verify "<name>" web table contains',
    '',
    'Hard rules:',
    '- "<name>" must be an element name taken EXACTLY from the provided element list.',
    '- Do NOT invent element names that are not in the list.',
    '- Each scenario is independent; list only the action/verify steps (do NOT include',
    '  the navigate or "User is on" lines — those are added automatically).',
    '- Respond with STRICT JSON only (no markdown, no prose).',
    '',
    'Think like an experienced manual + automation tester. Do NOT just write the happy',
    'path. For the given page/requirements, systematically enumerate test conditions:',
    '  1. HAPPY PATH — the main successful flow.',
    '  2. NEGATIVE / INVALID INPUT — wrong values, wrong format, mismatched data,',
    '     invalid credentials, unsupported characters.',
    '  3. REQUIRED-FIELD VALIDATION — submit with each required field empty, one at a time,',
    '     and all empty; expect the validation/error message.',
    '  4. BOUNDARY / EQUIVALENCE — min, max, just-under, just-over, zero, very long input.',
    '  5. FORMAT RULES — email without @, numbers in text fields, special characters,',
    '     leading/trailing spaces, case sensitivity.',
    '  6. STATE / COMBINATIONS — checkbox on vs off, each radio option, each dropdown value,',
    '     and meaningful combinations of selections ("if I pick X and Y, what happens").',
    '  7. SECURITY-ish — SQL/script-injection style strings in inputs (e.g. \'" OR 1=1, <script>).',
    '  8. NAVIGATION / CANCEL — cancel, back, re-submit, double-click submit.',
    'For each condition, assert the EXPECTED outcome with a verify step (success message,',
    'error/validation text, or that the user lands on the next screen). When the user',
    'gives notes/requirements, derive scenarios from THEM (acceptance criteria, business',
    'rules, allowed/disallowed values) — those define what "what happens if…" should check.',
    '',
    'Output discipline:',
    '- Generate ALL scenarios needed to fully cover the page/flow (happy path, every negative',
    '  case, every validation, every branch, every meaningful combination). Do NOT cap or',
    '  merge scenarios unless they are truly identical. More coverage is always better.',
    '- Keep each step text concise.',
    '- CRITICAL: inside any step string, escape double-quotes as \\". For injection/edge',
    '  values prefer single quotes (e.g. enters "\' OR 1=1" ...) so the JSON stays valid.',
    '- Output MINIFIED JSON, complete and not truncated.',
    '',
    'JSON shape:',
    '  {',
    '    "featureName": "Human readable feature title",',
    '    "pageKey": "shortCamelCaseKey",',
    '    "scenarios": [ { "name": "Scenario title", "steps": ["When ...", "Given ..."] } ]',
    '  }',
  ].join('\n');
}

function userPrompt(url, prompt, scraped) {
  const els = scraped.elements
    .map((e, i) => `${i + 1}. [${e.kind}] "${e.name}"`)
    .join('\n');
  return [
    `Target URL: ${url}`,
    `Page title: ${scraped.title}`,
    '',
    'Available elements on the page (use these exact names):',
    els || '(none detected)',
    notesBlock(),
    'User request:',
    prompt,
    '',
    'Now enumerate the FULL set of test scenarios a thorough tester would run',
    '(happy + negative + boundary + validation + combinations). Strict JSON only.',
  ].join('\n');
}

// ── Output assembly ────────────────────────────────────────────────────────────
function stripFences(s) {
  return String(s || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// Append the closing brackets/quotes needed to make a truncated JSON parseable.
// Tracks string state so braces inside strings are ignored.
function autoCloseJson(t) {
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = t;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, ''); // drop a dangling comma from a cut-off element
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';
  return out;
}

function parseLlmJson(raw) {
  let t = stripFences(raw);
  const first = t.indexOf('{');
  if (first > 0) t = t.slice(first);

  // 1. Direct parse (trim trailing prose after the last closing brace).
  const last = t.lastIndexOf('}');
  if (last >= 0) { try { return JSON.parse(t.slice(0, last + 1)); } catch { /* next */ } }

  // 2. Auto-close a truncated document.
  try { return JSON.parse(autoCloseJson(t)); } catch { /* next */ }

  // 3. Cut back to the last complete object, then auto-close the wrappers.
  const lb = t.lastIndexOf('}');
  if (lb > 0) { try { return JSON.parse(autoCloseJson(t.slice(0, lb + 1))); } catch { /* next */ } }

  throw new Error('unparseable JSON from model');
}

// Call the model and parse JSON, with one repair retry on malformed output.
async function chatJson(cfg, messages) {
  const raw = await chatLLM(cfg, messages);
  try { return parseLlmJson(raw); }
  catch (e) {
    const retry = messages.concat([
      { role: 'assistant', content: String(raw).slice(0, 1500) },
      { role: 'user', content: `Your previous output was not valid JSON (${e.message}). Respond again with ONLY valid, complete, MINIFIED JSON for the same data. Escape every double-quote inside a string value as \\". Do not truncate; keep it concise.` },
    ]);
    return parseLlmJson(await chatLLM(cfg, retry));
  }
}

function escFeature(s) {
  return String(s ?? '').replace(/"/g, '\\"');
}

// ── Page-key + name helpers ─────────────────────────────────────────────────
function derivePageKey(url, idx) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() || u.hostname.split('.')[0] || '';
    const k = seg.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 30);
    return k || `page${idx + 1}`;
  } catch {
    return `page${idx + 1}`;
  }
}
function uniqueKey(base, set) {
  let k = base;
  let n = 2;
  while (set.has(k)) k = `${base}${n++}`;
  set.add(k);
  return k;
}
// Escape a locator-name for YAML: quote if it contains special characters.
function yamlKey(name) {
  return /[:#{}\[\],&*?|<>=!%@`"]/.test(name) ? `'${name.replace(/'/g, "''")}'` : name;
}

// Build the locator lines for one page's referenced elements.
// Returns an array of raw YAML lines (flat, no page-level indentation).
function buildPageLocatorLines(pageKey, elements, steps) {
  const referenced = new Set();
  for (const step of steps) {
    const matches = String(step).match(/"([^"]+)"/g) || [];
    for (const m of matches) referenced.add(m.slice(1, -1));
  }
  const byName = new Map(elements.map((e) => [e.name, e]));
  const lines = [];
  for (const name of referenced) {
    const el = byName.get(name);
    if (!el) continue;
    lines.push(`${yamlKey(name)}:`);
    lines.push('  - xpath');
    lines.push(`  - ${el.xpath}`);
  }
  return lines;
}

// Write ONE combined YAML file that contains all pages as top-level sections:
//
//   birthday:
//     MONTH:
//       - xpath
//       - //*[@id='B-month']
//
//   married:
//     Yes:
//       - xpath
//       - //label[@data-test='radio-label-0']
//
// Separately writes per-page yamls to LOCATOR_PAGES_DIR so the Cucumber runtime
// (findLocatorFile) can still resolve each page independently.
function writeCombinedYaml(name, elementsByPage, scenarios) {
  // Collect all steps per page across all scenarios.
  const stepsByPage = new Map();
  for (const sc of scenarios) {
    for (const pg of sc.pages || []) {
      if (!pg.pageKey) continue;
      if (!stepsByPage.has(pg.pageKey)) stepsByPage.set(pg.pageKey, []);
      stepsByPage.get(pg.pageKey).push(...(pg.steps || []));
    }
  }

  const combinedLines = [];
  fs.mkdirSync(LOCATOR_DIR, { recursive: true });
  fs.mkdirSync(LOCATOR_PAGES_DIR, { recursive: true });

  for (const [pageKey, steps] of stepsByPage) {
    const pageLines = buildPageLocatorLines(pageKey, elementsByPage.get(pageKey) || [], steps);
    if (!pageLines.length) continue;

    // Combined file: indent each locator line by 2 spaces under the page key.
    combinedLines.push(`${yamlKey(pageKey)}:`);
    for (const l of pageLines) combinedLines.push(`  ${l}`);
    combinedLines.push('');

    // Per-page file for the runtime (findLocatorFile looks in LOCATOR_PAGES_DIR).
    const pagePath = path.join(LOCATOR_PAGES_DIR, `${pageKey}.yaml`);
    fs.writeFileSync(pagePath, pageLines.join('\n') + '\n', 'utf8');
  }

  const combinedName = (name || 'locators').replace(/[^a-zA-Z0-9_-]/g, '_');
  const combinedPath = path.join(LOCATOR_DIR, `${combinedName}.yaml`);
  fs.writeFileSync(combinedPath, combinedLines.join('\n'), 'utf8');
  return combinedPath;
}

// Minimal grammar-only prompt for the crawl planner. The crawl walks the HAPPY
// PATH to discover pages — it must NOT enumerate negative/edge cases (that is the
// job of scenario generation), or the flow becomes a giant unrunnable scenario.
function plannerSystemPrompt() {
  return [
    'You are navigating a web flow step by step. You MUST only use these exact step templates:',
    '  When User clicks on "<name>" button',
    '  When clicks on "<name>" link',
    '  When clicks on "<name>" Radio button',
    '  Given select "<name>" Checkbox',
    '  Given enters "<value>" text in "<name>" textbox',
    '  When selects "<value>" text from "<name>" Drop-down list',
    '  When verify "<text>" text is present on the screen',
    '',
    'Return ONLY the MINIMAL happy-path steps to advance the goal on THIS page',
    '(typically 1-6 steps). Do NOT enumerate negative, boundary, or validation cases here.',
    'Use ONLY element names from the provided list. The final step should be the click',
    'that moves to the next page (if the flow continues).',
  ].join('\n');
}

// ── Per-page action planner (LLM) ───────────────────────────────────────────
async function askPagePlan(cfg, goal, url, title, elements, priorKeys) {
  const sys = plannerSystemPrompt();
  const els = elements.map((e, i) => `${i + 1}. [${e.kind}] "${e.name}"`).join('\n');
  // NOTE: notes are intentionally NOT included here — the crawl only needs to walk
  // the happy path to discover screens. Notes drive scenario generation later.
  const user = [
    `Overall goal: reach the end of this flow by answering each question (pick the FIRST option when unsure).`,
    `Original request (context): ${goal}`,
    `Current page URL: ${url}`,
    `Current page title: ${title}`,
    `Pages already completed: ${priorKeys.length ? priorKeys.join(', ') : '(none — this is the first page)'}`,
    '',
    'Elements available on THIS page (use these EXACT names):',
    els || '(none detected)',
    '',
    'Return STRICT JSON: {"steps":["..."],"done":true|false}',
    '- steps = the MINIMAL steps to answer THIS question/screen and move to the next one.',
    '- Pick exactly one answer (the first radio option) if a choice is required, fill any required',
    '  inputs with valid values, then click the Next/Continue/Submit button as the LAST step.',
    '- Use ONLY element names from the list above. Do NOT include navigate or "User is on" lines.',
    '- Set done=true ONLY when there is no Next/Continue button (the final results screen).',
  ].join('\n');
  const parsed = await chatJson(cfg, [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]);
  return { steps: Array.isArray(parsed.steps) ? parsed.steps : [], done: !!parsed.done };
}

// Execute a page's Gherkin steps in the live browser so the flow advances.
async function executeSteps(page, steps, elements) {
  const byName = new Map(elements.map((e) => [e.name, e]));
  const loc = (name) => {
    const el = byName.get(name);
    return el ? page.locator(`xpath=${el.xpath}`).first() : null;
  };
  let clicked = false;
  for (const step of steps) {
    const s = String(step);
    try {
      let m;
      if ((m = s.match(/enters "(.*?)" text in "(.*?)" textbox/))) {
        const l = loc(m[2]); if (l) await l.fill(m[1], { timeout: 6000 }).catch(() => {});
      } else if ((m = s.match(/selects "(.*?)" text from "(.*?)" Drop-down list/))) {
        const l = loc(m[2]);
        if (l) {
          try { await l.selectOption({ label: m[1] }, { timeout: 4000 }); }
          catch { try { await l.selectOption(m[1], { timeout: 4000 }); } catch { await l.click({ timeout: 3000 }).catch(() => {}); } }
        }
      } else if ((m = s.match(/select "(.*?)" Checkbox/))) {
        const l = loc(m[1]); if (l) await l.check({ force: true, timeout: 4000 }).catch(() => {});
      } else if ((m = s.match(/(?:User clicks on|clicks on) "(.*?)" (?:Radio button|link|button)/))) {
        const l = loc(m[1]);
        if (l) { await l.click({ timeout: 6000 }).catch(async () => { await l.click({ force: true }).catch(() => {}); }); clicked = true; }
      }
      // verify steps perform no action during the crawl
    } catch { /* keep going */ }
  }
  return clicked;
}

// ── Generation flow ────────────────────────────────────────────────────────────
const MAX_PAGES = 16;

async function generate(cfg, prompt) {
  if (!cfg.url) { warn('  No URL set. Use /url <url> first.'); return; }
  if (!cfg.copilot) { warn('  No copilot command set. Use /copilot <command>.'); return; }

  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const visited = []; // { pageKey, url, title, elements, steps }
  const usedKeys = new Set();
  const seenUrls = new Set();

  try {
    const page = await browser.newPage();
    info(`\n  ⏳ Opening ${cfg.url} ...`);
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settlePage(page);

    for (let i = 0; i < MAX_PAGES; i++) {
      const curUrl = page.url();
      seenUrls.add(curUrl.split('#')[0]);
      const title = await page.title().catch(() => '');
      const elements = (await page.evaluate(scrapeBrowserSide).catch(() => ({ elements: [] }))).elements;
      const pageKey = uniqueKey(derivePageKey(curUrl, i), usedKeys);
      ok(`  ✓ Page ${i + 1}: "${title}" — ${elements.length} element(s)  [${pageKey}]`);

      info(`  🤖 Planning actions for this page ...`);
      let plan;
      try {
        plan = await askPagePlan(cfg, prompt, curUrl, title, elements, visited.map((v) => v.pageKey));
      } catch (e) {
        err(`  LLM planning failed: ${e.message}`);
        break;
      }
      visited.push({ pageKey, url: curUrl, title, elements, steps: plan.steps });
      if (process.env.AI_DEBUG) log(`     ${c.gray}[debug] elements=${JSON.stringify(elements.map((e) => e.kind + ':' + e.name))}\n     [debug] plan done=${plan.done} steps=${JSON.stringify(plan.steps)}${c.reset}`);

      if (plan.done || !plan.steps.length) break;

      const clicked = await executeSteps(page, plan.steps, elements);
      await settlePage(page);
      const nextUrl = page.url();
      if (process.env.AI_DEBUG) log(`     ${c.gray}[debug] clicked=${clicked}  ${curUrl}  ->  ${nextUrl}${c.reset}`);
      // Stop if nothing navigated us forward (avoids looping on the same page).
      if (nextUrl === curUrl && !clicked) break;
      // Stop if we have circled back to a page we already visited (e.g. logout → login).
      if (seenUrls.has(nextUrl.split('#')[0])) break;
    }
  } catch (e) {
    err(`  Crawl failed: ${e.message}`);
    await browser.close();
    return;
  }
  await browser.close();

  const pagesWithSteps = visited.filter((p) => p.steps && p.steps.length);
  if (!pagesWithSteps.length) { warn('  No actionable steps were produced.'); return; }

  // Optional grouping prefix from /name; empty by default so files are named purely
  // after the AI scenario (e.g. happy-login-with-valid-credentials.feature).
  const prefix = (cfg.fileName || '').trim();
  fs.mkdirSync(FEATURE_DIR, { recursive: true });

  if (visited.length === 1) {
    await generateMultiScenario(cfg, prompt, visited[0], prefix);  // single page
  } else {
    await generateMultiPath(cfg, prompt, visited, prefix);          // multi-page quiz/flow
  }
}

// kebab slug for filenames
function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'scenario';
}

// Canonicalize a generated step to EXACTLY match the framework's step definitions,
// so the LLM's phrasing variants (e.g. "User clicks on X radio button") still run.
function normalizeStep(step) {
  let s = String(step || '').trim().replace(/^(Given|When|Then|And)\s+/i, '').trim();
  let m;
  if ((m = s.match(/clicks?\s+on\s+"([^"]+)"\s+radio(?:\s*button)?/i)))
    return `When clicks on "${m[1]}" Radio button`;
  if ((m = s.match(/(?:select|check|tick)\s+"([^"]+)"\s+checkbox/i)))
    return `Given select "${m[1]}" Checkbox`;
  if ((m = s.match(/clicks?\s+on\s+"([^"]+)"\s+link/i)))
    return `When clicks on "${m[1]}" link`;
  if ((m = s.match(/enters?\s+"([^"]*)"\s+(?:text\s+)?(?:in|into)\s+"([^"]+)"\s+(?:textbox|text\s*box|field|input)/i)))
    return `Given enters "${m[1]}" text in "${m[2]}" textbox`;
  if ((m = s.match(/selects?\s+"([^"]+)"\s+(?:text\s+)?from\s+"([^"]+)"\s+(?:drop-?down(?:\s*list)?|dropdown|select)/i)))
    return `When selects "${m[1]}" text from "${m[2]}" Drop-down list`;
  if ((m = s.match(/verify\s+"([^"]+)"\s+(?:text\s+)?(?:is\s+)?(?:present|displayed|shown|visible)/i)))
    return `When verify "${m[1]}" text is present on the screen`;
  if ((m = s.match(/(?:User\s+)?clicks?\s+on\s+"([^"]+)"\s+button/i)))
    return `When User clicks on "${m[1]}" button`;
  // Unrecognized → keep as-is (already had its keyword stripped, re-prefix With When)
  return `When ${s}`;
}

function normalizeScenarios(scenarios) {
  for (const sc of scenarios) {
    for (const pg of sc.pages || []) {
      pg.steps = (pg.steps || []).map(normalizeStep);
    }
  }
  return scenarios;
}

// Write ONE feature file per scenario. scenarios: [{ name, pages: [{pageKey, steps}] }]
// The FILE NAME is derived from the AI scenario name (slug), so each file is named
// after what it actually tests. `prefix` (from /name, optional) groups a batch when set.
function writeScenarioFeatureFiles(prefix, featureName, url, scenarios) {
  fs.mkdirSync(FEATURE_DIR, { recursive: true });
  const written = [];
  const usedNames = new Set();
  scenarios.forEach((sc, i) => {
    const name = sc.name || `Scenario ${i + 1}`;
    const lines = [`Feature: ${featureName} — ${name}`, '', `  Scenario: ${name}`, ''];
    lines.push(`    Given User navigates to "${escFeature(url)}" URL`);
    for (const pg of sc.pages || []) {
      if (!pg.pageKey || !(pg.steps && pg.steps.length)) continue;
      lines.push('');
      lines.push(`    And User is on "${pg.pageKey}" screen`);
      for (const s of pg.steps) lines.push(`    ${String(s).trim()}`);
    }
    // Filename: [prefix_]NN_<ai-scenario-slug>, unique within this batch.
    const idx = String(i + 1).padStart(2, '0');
    let base = `${prefix ? prefix + '_' : ''}${idx}_${slug(name)}`;
    let unique = base; let n = 2;
    while (usedNames.has(unique)) unique = `${base}-${n++}`;
    usedNames.add(unique);
    const fp = path.join(FEATURE_DIR, `${unique}.feature`);
    fs.writeFileSync(fp, lines.join('\n').trimEnd() + '\n', 'utf8');
    written.push(fp);
  });
  return written;
}

// Write locator yaml(s) based on cfg.yamlformat:
//   'combined' (default) — one file, all pages as top-level sections
//   'perpage'            — one <pageKey>.yaml per page (legacy)
function writeYamlsForScenarios(cfg, name, elementsByPage, scenarios) {
  if ((cfg.yamlformat || 'combined') === 'perpage') {
    return writePerPageYamls(elementsByPage, scenarios);
  }
  return [writeCombinedYaml(name, elementsByPage, scenarios)];
}

// Legacy per-page format: one <pageKey>.yaml per page in LOCATOR_DIR.
function writePerPageYamls(elementsByPage, scenarios) {
  const stepsByPage = new Map();
  for (const sc of scenarios) {
    for (const pg of sc.pages || []) {
      if (!pg.pageKey) continue;
      if (!stepsByPage.has(pg.pageKey)) stepsByPage.set(pg.pageKey, []);
      stepsByPage.get(pg.pageKey).push(...(pg.steps || []));
    }
  }
  fs.mkdirSync(LOCATOR_DIR, { recursive: true });
  const written = [];
  for (const [pageKey, steps] of stepsByPage) {
    const lines = buildPageLocatorLines(pageKey, elementsByPage.get(pageKey) || [], steps);
    if (!lines.length) continue;
    const fp = path.join(LOCATOR_DIR, `${pageKey}.yaml`);
    fs.writeFileSync(fp, lines.join('\n') + '\n', 'utf8');
    written.push(fp);
  }
  return written;
}

// Ask the LLM to generate a Playwright spec.ts from scenarios + locators, then
// write it to SPEC_DIR/<specName>.spec.ts.  Returns the written file path.
async function generateSpecTs(cfg, featureName, url, scenarios, elementsByPage, specName) {
  // Build a compact summary of scenarios and their locators for the LLM.
  const scenarioSummary = scenarios.map((sc, i) => {
    const pages = (sc.pages || []).map((pg) => {
      const locLines = buildPageLocatorLines(pg.pageKey, elementsByPage.get(pg.pageKey) || [], pg.steps || []);
      const locMap = {};
      for (let j = 0; j < locLines.length; j += 3) {
        const key = locLines[j].replace(/:$/, '').replace(/^'|'$/g, '');
        locMap[key] = locLines[j + 2] ? locLines[j + 2].trim() : '';
      }
      return `  Screen "${pg.pageKey}":\n    Steps:\n${(pg.steps || []).map((s) => `      ${s}`).join('\n')}\n    Locators: ${JSON.stringify(locMap)}`;
    }).join('\n');
    return `Scenario ${i + 1}: "${sc.name}"\n${pages}`;
  }).join('\n\n');

  const prompt = [
    'Generate a Playwright TypeScript spec file for these test scenarios.',
    `Feature: ${featureName}`,
    `Start URL: ${url}`,
    '',
    scenarioSummary,
    '',
    'Rules:',
    '- Use `import { test, expect } from "@playwright/test";`',
    '- One `test(...)` block per scenario.',
    '- Use `page.goto(url)` at the start of each test.',
    '- Use `page.locator("xpath=<xpath>")` with the exact xpaths provided.',
    '- Map each Gherkin step to the equivalent Playwright action:',
    '    "User clicks on X button/link"  → await locator.click()',
    '    "enters X text in Y textbox"    → await locator.fill("X")',
    '    "selects X from Y Drop-down"    → await locator.selectOption("X")',
    '    "clicks on X Radio button"      → await locator.click()',
    '    "verify X text is present"      → await expect(page.getByText("X")).toBeVisible()',
    '- Add `{ timeout: 10000 }` to each locator action.',
    '- No comments, no extra imports, no markdown fences.',
    'Return ONLY the TypeScript file content, nothing else.',
  ].join('\n');

  const raw = await chatLLM(cfg, [{ role: 'user', content: prompt }]);
  // Strip markdown fences if the LLM wrapped the output.
  const content = String(raw).replace(/^```(?:typescript|ts)?\n?/i, '').replace(/\n?```\s*$/, '').trim() + '\n';

  fs.mkdirSync(SPEC_DIR, { recursive: true });
  const name = (specName || 'generated').replace(/[^a-zA-Z0-9_-]/g, '_');
  const specPath = path.join(SPEC_DIR, `${name}.spec.ts`);
  fs.writeFileSync(specPath, content, 'utf8');
  return specPath;
}

// Rich single-page generation → MULTIPLE scenarios, each its own feature file.
async function generateMultiScenario(cfg, prompt, pageInfo, prefix) {
  info(`  🤖 Designing scenarios via Copilot CLI ...`);
  let parsed;
  try {
    parsed = await chatJson(cfg, [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userPrompt(cfg.url, prompt, pageInfo) },
    ]);
  } catch (e) {
    err(`  LLM call/parse failed: ${e.message}`);
    return;
  }
  const raw = parsed.scenarios || [];
  if (!raw.length) { warn('  LLM returned no scenarios.'); return; }

  const pageKey = derivePageKey(cfg.url, 0);
  const featureName = parsed.featureName || pageInfo.title || 'AI Generated Tests';
  // Normalise each scenario to the {name, pages:[{pageKey, steps}]} shape.
  const scenarios = normalizeScenarios(raw.map((sc) => ({ name: sc.name, pages: [{ pageKey, steps: sc.steps || [] }] })));
  const elementsByPage = new Map([[pageKey, pageInfo.elements]]);

  const mode = cfg.mode || 'gherkin';
  const specName = prefix || slug(featureName) || 'generated';
  let featureFiles = [], yamlFiles = [], specFile = null;

  if (mode === 'gherkin' || mode === 'both') {
    featureFiles = writeScenarioFeatureFiles(prefix, featureName, cfg.url, scenarios);
    yamlFiles = writeYamlsForScenarios(cfg, specName, elementsByPage, scenarios);
  }
  if (mode === 'spec' || mode === 'both') {
    info('  📝 Generating Playwright spec.ts ...');
    try { specFile = await generateSpecTs(cfg, featureName, cfg.url, scenarios, elementsByPage, specName); }
    catch (e) { err(`  Spec generation failed: ${e.message}`); }
  }
  reportGenerated(mode, scenarios, featureFiles, yamlFiles, specFile);
}

// Multi-page flow / quiz → MULTIPLE end-to-end scenarios across the crawled pages,
// each written to its own feature file. Uses notes as the source of truth for
// which answers to pick and what outcome to verify.
async function generateMultiPath(cfg, prompt, visited, prefix) {
  info(`  🤖 Designing test paths across ${visited.length} screen(s) via Copilot CLI ...`);

  // Build a per-screen element catalog and the elements map for yaml output.
  const elementsByPage = new Map();
  const catalog = visited.map((p) => {
    elementsByPage.set(p.pageKey, p.elements);
    const els = p.elements.map((e) => `[${e.kind}] "${e.name}"`).join(', ');
    return `Screen "${p.pageKey}" (${p.title}): ${els || '(no elements)'}`;
  }).join('\n');

  const sys = systemPrompt();
  const user = [
    `Target URL (first screen): ${cfg.url}`,
    '',
    'The flow has these screens, in the order discovered (each is one questionnaire step):',
    catalog,
    notesBlock(),
    'User request:',
    prompt,
    '',
    'Design MULTIPLE end-to-end test scenarios that PLAY THROUGH the screens and verify',
    'the OUTCOME of each (the next question that appears, or the final result). Cover:',
    '- the happy path to the end,',
    '- each meaningful answer branch/combination described in the notes,',
    '- required-answer validation (click Next without choosing → expect the error, stay on screen),',
    '- date-of-birth and other input validations.',
    'Use ONLY the element names listed per screen. Group each scenario\'s steps by screen.',
    '',
    'Return STRICT JSON: {"featureName":"...","scenarios":[{"name":"...","pages":[{"pageKey":"...","steps":["..."]}]}]}',
  ].join('\n');

  let parsed;
  try {
    parsed = await chatJson(cfg, [{ role: 'system', content: sys }, { role: 'user', content: user }]);
  } catch (e) {
    err(`  LLM call/parse failed: ${e.message}`);
    return;
  }
  const scenarios = normalizeScenarios((parsed.scenarios || []).filter((s) => s && Array.isArray(s.pages) && s.pages.length));
  if (!scenarios.length) { warn('  LLM returned no scenarios.'); return; }

  const featureName = parsed.featureName || (visited[0] && visited[0].title) || 'AI Generated Flow';
  const mode = cfg.mode || 'gherkin';
  const specName = prefix || slug(featureName) || 'generated';
  let featureFiles = [], yamlFiles = [], specFile = null;

  if (mode === 'gherkin' || mode === 'both') {
    featureFiles = writeScenarioFeatureFiles(prefix, featureName, cfg.url, scenarios);
    yamlFiles = writeYamlsForScenarios(cfg, specName, elementsByPage, scenarios);
  }
  if (mode === 'spec' || mode === 'both') {
    info('  📝 Generating Playwright spec.ts ...');
    try { specFile = await generateSpecTs(cfg, featureName, cfg.url, scenarios, elementsByPage, specName); }
    catch (e) { err(`  Spec generation failed: ${e.message}`); }
  }
  reportGenerated(mode, scenarios, featureFiles, yamlFiles, specFile);
}

function reportGenerated(mode, scenarios, featureFiles, yamlFiles, specFile) {
  log('');
  if (featureFiles.length) {
    ok(`  ✓ ${scenarios.length} scenario(s) → ${featureFiles.length} feature file(s):`);
    scenarios.forEach((sc, i) => log(`     ${c.dim}•${c.reset} ${sc.name}  ${c.gray}(${path.basename(featureFiles[i] || '')})${c.reset}`));
    log('');
  }
  for (const yp of yamlFiles) ok(`  📄 Locators: ${path.relative(ROOT, yp)}`);
  if (specFile) ok(`  📄 Spec:     ${path.relative(ROOT, specFile)}`);
  if (mode === 'gherkin' || mode === 'both') log(`  ${c.gray}Run Gherkin tests with:  npm run test:ai${c.reset}`);
  if (mode === 'spec' || mode === 'both') log(`  ${c.gray}Run Playwright spec with: npx playwright test ${path.relative(ROOT, specFile || '').replace(/\\/g, '/')}${c.reset}`);
}

// ── /fix mode ─────────────────────────────────────────────────────────────────
// Replays a generated feature in a real browser, observes what ACTUALLY happens
// (which locators resolve, which asserted texts are really present), then asks the
// LLM to correct the feature steps + the related <pageKey>.yaml locators.

function findFeatureFile(token) {
  if (!token) return null;
  const t = token.replace(/^["']|["']$/g, '');
  const direct = path.isAbsolute(t) ? t : path.join(ROOT, t);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  if (!fs.existsSync(FEATURE_DIR)) return null;
  const files = fs.readdirSync(FEATURE_DIR).filter((f) => f.endsWith('.feature'));
  const tl = t.toLowerCase();
  const want = tl.endsWith('.feature') ? tl : `${tl}.feature`;
  const hit = files.find((f) => f.toLowerCase() === want) || files.find((f) => f.toLowerCase().includes(tl));
  return hit ? path.join(FEATURE_DIR, hit) : null;
}

function parseFeatureFile(text) {
  let featureName = 'AI Generated', scenarioName = 'Scenario', url = '';
  const segments = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^Feature:\s*(.+)$/))) featureName = m[1];
    else if ((m = line.match(/^Scenario:\s*(.+)$/))) scenarioName = m[1];
    else if ((m = line.match(/User navigates to "([^"]+)" URL/))) url = m[1];
    else if ((m = line.match(/User is on "([^"]+)" screen/))) { cur = { pageKey: m[1], steps: [] }; segments.push(cur); }
    else if (/^(Given|When|Then|And) /.test(line) && cur) cur.steps.push(line);
  }
  return { featureName, scenarioName, url, segments };
}

function readPageYaml(pageKey) {
  const fp = path.join(LOCATOR_DIR, `${pageKey}.yaml`);
  if (!fs.existsSync(fp)) return {};
  try {
    const doc = require('js-yaml').load(fs.readFileSync(fp, 'utf8')) || {};
    const map = {};
    for (const [k, v] of Object.entries(doc)) if (Array.isArray(v) && v.length >= 2) map[k] = v[1];
    return map;
  } catch { return {}; }
}

function mergePageYaml(pageKey, locators) {
  const existing = readPageYaml(pageKey);
  for (const [name, xp] of Object.entries(locators)) if (xp) existing[name] = xp;
  const lines = [];
  for (const [name, xp] of Object.entries(existing)) {
    lines.push(`${/[:#{}\[\],&*?|<>=!%@`"]/.test(name) ? `'${name.replace(/'/g, "''")}'` : name}:`);
    lines.push('  - xpath');
    lines.push(`  - ${xp}`);
  }
  fs.mkdirSync(LOCATOR_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCATOR_DIR, `${pageKey}.yaml`), lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

async function applyStepObserve(page, step, ymap) {
  const s = String(step);
  const loc = (name) => (ymap[name] ? page.locator(`xpath=${ymap[name]}`).first() : null);
  let m;
  try {
    if ((m = s.match(/enters "(.*?)" text in "(.*?)" textbox/))) {
      const l = loc(m[2]); if (!l) return `MISSING-LOCATOR "${m[2]}"`;
      if (!(await l.count())) return `NOT-FOUND "${m[2]}"`;
      await l.fill(m[1], { timeout: 5000 }); return 'ok';
    }
    if ((m = s.match(/selects "(.*?)" text from "(.*?)" Drop-down list/))) {
      const l = loc(m[2]); if (!l || !(await l.count())) return `NOT-FOUND "${m[2]}"`;
      try { await l.selectOption({ label: m[1] }, { timeout: 4000 }); }
      catch { try { await l.selectOption(m[1], { timeout: 4000 }); } catch { await l.click().catch(() => {}); } }
      return 'ok';
    }
    if ((m = s.match(/select "(.*?)" Checkbox/))) {
      const l = loc(m[1]); if (!l || !(await l.count())) return `NOT-FOUND "${m[1]}"`;
      await l.check({ force: true, timeout: 4000 }).catch(() => {}); return 'ok';
    }
    if ((m = s.match(/clicks on "(.*?)" (?:Radio button|link|button)/)) || (m = s.match(/clicks on "(.*?)" button/))) {
      const l = loc(m[1]); if (!l || !(await l.count())) return `NOT-FOUND "${m[1]}"`;
      await l.click({ timeout: 6000 }).catch(async () => { await l.click({ force: true }).catch(() => {}); });
      await settlePage(page); return 'clicked';
    }
    if ((m = s.match(/verify "(.*?)" text is present/))) {
      const text = m[1];
      const present = await page.getByText(text, { exact: false }).first().isVisible({ timeout: 4000 }).catch(() => false);
      if (present) return `PASS present "${text}"`;
      const snap = await page.evaluate(() => {
        const norm = (x) => (x || '').replace(/\s+/g, ' ').trim();
        const heads = Array.from(document.querySelectorAll('h1,h2,h3,[role=heading],legend,[class*=title],[class*=heading]'))
          .map((e) => norm(e.textContent)).filter(Boolean).slice(0, 10);
        return { heads, body: norm(document.body.innerText).slice(0, 500) };
      });
      return `FAIL absent "${text}" | url=${page.url()} | headings=${JSON.stringify(snap.heads)} | bodyText=${JSON.stringify(snap.body)}`;
    }
  } catch (e) { return `ERROR ${e.message}`; }
  return 'skipped';
}

async function observeReplay(url, segments, yamlByPage) {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const obs = [];
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settlePage(page);
    for (const seg of segments) {
      const ymap = yamlByPage[seg.pageKey] || {};
      for (const step of seg.steps) obs.push(`[${seg.pageKey}] ${step}  =>  ${await applyStepObserve(page, step, ymap)}`);
    }
  } catch (e) { obs.push(`replay error: ${e.message}`); }
  finally { await browser.close(); }
  return obs;
}

async function runFix(cfg, arg) {
  if (!cfg.copilot) { warn('  No copilot command set. Use /copilot <command>.'); return; }
  const trimmed = String(arg || '').trim();
  if (!trimmed) { warn('  Usage: /fix <feature-name> [error description]'); return; }
  const featToken = trimmed.split(/\s+/)[0];
  const errorText = trimmed.slice(featToken.length).trim();

  const fp = findFeatureFile(featToken);
  if (!fp) { err(`  Feature not found: ${featToken} (looked in ${path.relative(ROOT, FEATURE_DIR)})`); return; }

  const text = fs.readFileSync(fp, 'utf8');
  const parsed = parseFeatureFile(text);
  if (!parsed.url) { err('  Could not find the navigate URL in the feature.'); return; }
  const yamlByPage = {};
  for (const seg of parsed.segments) yamlByPage[seg.pageKey] = readPageYaml(seg.pageKey);

  info(`\n  🔬 Replaying ${path.basename(fp)} against ${parsed.url} ...`);
  const obs = await observeReplay(parsed.url, parsed.segments, yamlByPage);
  obs.forEach((o) => log(`     ${c.gray}${o}${c.reset}`));

  info(`  🤖 Asking Copilot CLI to correct the feature + locators ...`);
  const user = [
    'A generated Cucumber feature is failing. Fix the STEPS and the LOCATORS so it runs and',
    'asserts REAL outcomes that actually appear on the page.',
    errorText ? `Tester-reported problem: ${errorText}` : '(no explicit error — rely on the runtime observations)',
    '',
    'Current feature file:',
    text,
    '',
    'Current locators per screen (name -> xpath):',
    JSON.stringify(yamlByPage, null, 2),
    notesBlock(),
    'Runtime observations from replaying it just now (the ground truth):',
    obs.join('\n'),
    '',
    'Fix rules:',
    '- Keep the same screens/pageKeys and overall intent.',
    '- For a verify step that FAILED (absent), replace the asserted text with text that is',
    '  ACTUALLY present per the observation headings/bodyText (or move the assert to the right screen).',
    '- For a NOT-FOUND/MISSING-LOCATOR element, provide a corrected xpath in that page\'s locators.',
    '- Use ONLY the step templates; do not invent outcomes that are not in the observations.',
    '',
    'Return STRICT JSON: {"featureName":"...","scenarioName":"...","pages":[{"pageKey":"...","steps":["..."],"locators":{"Name":"//xpath"}}],"summary":"what changed"}',
  ].join('\n');

  let res;
  try { res = await chatJson(cfg, [{ role: 'system', content: systemPrompt() }, { role: 'user', content: user }]); }
  catch (e) { err(`  Fix failed: ${e.message}`); return; }

  const pages = (res.pages || []).filter((p) => p && p.pageKey);
  if (!pages.length) { warn('  LLM returned no pages — nothing changed.'); return; }

  // Rebuild the feature file (same path/filename).
  const featureName = res.featureName || parsed.featureName;
  const scenarioName = res.scenarioName || parsed.scenarioName;
  const lines = [`Feature: ${featureName}`, '', `  Scenario: ${scenarioName}`, '', `    Given User navigates to "${escFeature(parsed.url)}" URL`];
  for (const p of pages) {
    const steps = (p.steps || []).map(normalizeStep);
    if (!steps.length) continue;
    lines.push('');
    lines.push(`    And User is on "${p.pageKey}" screen`);
    for (const st of steps) lines.push(`    ${st}`);
  }
  fs.writeFileSync(fp, lines.join('\n').trimEnd() + '\n', 'utf8');

  // Merge corrected locators into each page's yaml.
  const updated = [];
  for (const p of pages) {
    if (p.locators && Object.keys(p.locators).length) { mergePageYaml(p.pageKey, p.locators); updated.push(p.pageKey); }
  }

  log('');
  ok(`  ✓ Fixed ${path.relative(ROOT, fp)}`);
  if (updated.length) for (const k of updated) ok(`  📄 Updated locators: ${path.relative(ROOT, path.join(LOCATOR_DIR, k + '.yaml'))}`);
  if (res.summary) log(`  ${c.gray}${res.summary}${c.reset}`);
  log(`  ${c.gray}Re-run with:  npm run test:ai ${path.basename(fp, '.feature')}${c.reset}`);
}

// ── Commands ───────────────────────────────────────────────────────────────────
function showHelp() {
  log(`
${c.bold}AI Scenario CLI — commands  (backend: GitHub Copilot CLI)${c.reset}
  ${c.cyan}/copilot <command>${c.reset}  set the Copilot CLI command template (use {prompt}); e.g.
                     /copilot copilot -p {prompt} --allow-all-tools
  ${c.cyan}/testllm${c.reset}           run a tiny prompt to verify the Copilot backend works
  ${c.cyan}/mode gherkin|spec|both${c.reset}
                     gherkin — generate .feature + locators yaml (default)
                     spec    — generate Playwright spec.ts only
                     both    — generate .feature + yaml + spec.ts
  ${c.cyan}/yamlformat combined|perpage${c.reset}
                     combined — one yaml file, all pages as top-level sections (default)
                                  birthday:
                                    MONTH: [xpath, //*[@id='B-month']]
                     perpage  — one <pageKey>.yaml file per page (legacy)
  ${c.cyan}/url <url>${c.reset}         set the target URL to analyze
  ${c.cyan}/name <prefix>${c.reset}     optional filename prefix (default: AI names each file by scenario)
  ${c.cyan}/notes <path>${c.reset}      attach a .txt/.md/.docx requirements file as context
  ${c.cyan}/notes${c.reset}             list loaded notes   ·   ${c.cyan}/notes clear${c.reset} to reset
  ${c.cyan}/fix <feature> [error]${c.reset}  replay a feature live, then auto-correct its steps + yaml
  ${c.cyan}/show${c.reset}              show current config
  ${c.cyan}/scrape${c.reset}           re-scrape the URL and list found elements
  ${c.cyan}/config${c.reset}            how to set the Copilot command
  ${c.cyan}/clear${c.reset}            clear the screen   ·   ${c.cyan}/help${c.reset}  this help   ·   ${c.cyan}/exit${c.reset}  leave

${c.dim}Typical flow:
  /testllm                                   (verify Copilot CLI works first)
  /mode gherkin                              (or: spec / both)
  /url https://app.com/quiz
  /notes ./requirements/quiz-rules.docx
  test every answer combination and the validation messages${c.reset}
`);
}

function showConfig(cfg) {
  log(`
${c.bold}Current config${c.reset}
  backend  : GitHub Copilot CLI
  copilot  : ${cfg.copilot}
  mode       : ${cfg.mode || 'gherkin'}  (gherkin=feature+yaml | spec=spec.ts | both=all)
  yamlformat : ${cfg.yamlformat || 'combined'}  (combined=single file | perpage=one file per page)
  url      : ${cfg.url || '(not set)'}
  name     : ${cfg.fileName || '(AI names files per scenario)'}
`);
}

function printConfigGuide(cfg) {
  showConfig(cfg);
  log(`${c.dim}  The LLM backend is the GitHub Copilot CLI. Set the command template with:
    /copilot copilot -p {prompt} --allow-all-tools
  Use {prompt} where the prompt text goes (omit it to pipe via stdin).
  Verify it works with:  /testllm${c.reset}
`);
}

// ── REPL ────────────────────────────────────────────────────────────────────────
// Parse non-interactive CLI flags so the tool can be driven by other CLIs/agents
// (GitHub Copilot CLI, scripts, CI) as a single command instead of the REPL.
function parseCliArgs(argv) {
  const o = { notes: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    switch (a) {
      case '--url': o.url = val(); break;
      case '--prompt': case '-p': o.prompt = val(); break;
      case '--notes': o.notes.push(val()); break;
      case '--fix': o.fix = val(); break;
      case '--error': o.error = val(); break;
      case '--name': o.name = val(); break;
      case '--copilot': o.copilot = val(); break;
      case '--mode': o.mode = val(); break;
      case '--yamlformat': o.yamlformat = val(); break;
      case '--help': case '-h': o.help = true; break;
      default: break;
    }
  }
  return o;
}

async function main() {
  const cfg = loadConfig();
  const opts = parseCliArgs(process.argv.slice(2));

  // Apply overrides from flags (used by both modes).
  if (opts.copilot) cfg.copilot = opts.copilot;
  if (opts.url) cfg.url = opts.url;
  if (opts.name) cfg.fileName = opts.name;
  if (opts.mode && ['gherkin', 'spec', 'both'].includes(opts.mode)) cfg.mode = opts.mode;
  if (opts.yamlformat && ['combined', 'perpage'].includes(opts.yamlformat)) cfg.yamlformat = opts.yamlformat;
  for (const np of opts.notes) {
    try {
      const abs = path.isAbsolute(np) ? np : path.join(ROOT, np);
      notes.push({ name: path.basename(abs), text: await extractFileText(abs) });
      ok(`  ✓ Loaded notes "${path.basename(abs)}"`);
    } catch (e) { err(`  Could not read notes "${np}": ${e.message}`); }
  }

  if (opts.help) {
    log('Usage: node ai-cli.js [--url U] [--prompt "..."] [--notes f]... [--fix <feature> [--error "..."]]');
    log('                      [--name P] [--copilot "copilot -p {prompt}"]');
    log('Backend: GitHub Copilot CLI. No --prompt/--fix → interactive REPL.');
    return;
  }

  // ── One-shot (non-interactive) mode: run once and exit ──────────────────────
  if (opts.prompt || opts.fix) {
    try {
      if (opts.fix) await runFix(cfg, [opts.fix, opts.error].filter(Boolean).join(' '));
      else await generate(cfg, opts.prompt);
    } catch (e) { err(`  ${e.message}`); process.exitCode = 1; }
    return;
  }

  // ── Interactive REPL mode ───────────────────────────────────────────────────
  log(`${c.bold}${c.magenta}
  ╭────────────────────────────────────────────╮
  │   AI Scenario CLI  ·  Gherkin generator     │
  ╰────────────────────────────────────────────╯${c.reset}`);
  log(`${c.gray}  Backend: GitHub Copilot CLI · Command: ${cfg.copilot}${c.reset}`);
  log(`${c.gray}  Verify the backend works with /testllm. ${cfg.url ? '' : 'Set a target with /url <url>.'} /help for more.${c.reset}`);
  log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const promptStr = () => `${c.green}ai>${c.reset} `;

  const handle = async (lineRaw) => {
    const line = lineRaw.trim();
    if (!line) return true;

    if (line.startsWith('/')) {
      const [cmd, ...rest] = line.split(/\s+/);
      const arg = rest.join(' ').trim();
      switch (cmd) {
        case '/exit': case '/quit': return false;
        case '/help': showHelp(); return true;
        case '/show': showConfig(cfg); return true;
        case '/config': printConfigGuide(cfg); return true;
        case '/copilot': if (arg) { cfg.copilot = arg; saveConfig(cfg); ok(`  ✓ Copilot command set to: ${arg}`); } else warn('  Usage: /copilot copilot -p {prompt}'); return true;
        case '/mode': {
          const m = arg.toLowerCase();
          if (m === 'gherkin' || m === 'spec' || m === 'both') {
            cfg.mode = m; saveConfig(cfg);
            ok(`  ✓ Mode set to: ${m}  (${m === 'gherkin' ? 'feature + yaml only' : m === 'spec' ? 'Playwright spec.ts only' : 'feature + yaml + spec.ts'})`);
          } else warn('  Usage: /mode gherkin|spec|both');
          return true;
        }
        case '/yamlformat': {
          const f = arg.toLowerCase();
          if (f === 'combined' || f === 'perpage') {
            cfg.yamlformat = f; saveConfig(cfg);
            ok(`  ✓ YAML format set to: ${f}  (${f === 'combined' ? 'single file, all pages as sections' : 'one <pageKey>.yaml per page'})`);
          } else warn('  Usage: /yamlformat combined|perpage');
          return true;
        }
        case '/testllm': {
          info('  🧪 Testing the Copilot CLI backend ...');
          try {
            const out = await chatLLM(cfg, [{ role: 'user', content: 'Reply with exactly this JSON and nothing else: {"ok":true}' }]);
            log(`  ${c.gray}raw output:${c.reset} ${String(out).slice(0, 300)}`);
            try { const j = parseLlmJson(out); ok(`  ✓ Parsed JSON OK: ${JSON.stringify(j)}`); }
            catch { warn('  ⚠️  Backend ran but JSON could not be parsed — adjust /copilot so it returns plain text/JSON.'); }
          } catch (e) { err(`  ✗ ${e.message}`); }
          return true;
        }
        case '/url': if (arg) { cfg.url = arg; saveConfig(cfg); ok(`  ✓ Target URL set.`); } else warn('  Usage: /url <url>'); return true;
        case '/name': if (arg) { cfg.fileName = arg.replace(/[^a-zA-Z0-9_-]/g, ''); saveConfig(cfg); ok(`  ✓ Output name set to ${cfg.fileName}.`); } else warn('  Usage: /name <fileName>'); return true;
        case '/scrape': {
          if (!cfg.url) { warn('  Set a URL first with /url <url>.'); return true; }
          info(`  ⏳ Scraping ${cfg.url} ...`);
          try {
            const s = await scrapePage(cfg.url);
            ok(`  ✓ ${s.elements.length} element(s) on "${s.title}":`);
            s.elements.forEach((e) => log(`     ${c.dim}[${e.kind}]${c.reset} ${e.name}`));
          } catch (e) { err(`  Scrape failed: ${e.message}`); }
          return true;
        }
        case '/notes': {
          if (!arg) {
            if (!notes.length) { log('  No notes loaded. Usage: /notes <path-to.txt|.md|.docx>'); return true; }
            ok(`  ${notes.length} note file(s) loaded:`);
            notes.forEach((n) => log(`     ${c.dim}•${c.reset} ${n.name} (${n.text.length} chars)`));
            return true;
          }
          if (arg.toLowerCase() === 'clear') { notes.length = 0; ok('  ✓ Notes cleared.'); return true; }
          // Allow quoted paths and ~ expansion-free absolute/relative paths.
          const fp = arg.replace(/^["']|["']$/g, '');
          const abs = path.isAbsolute(fp) ? fp : path.join(ROOT, fp);
          if (!fs.existsSync(abs)) { err(`  File not found: ${abs}`); return true; }
          try {
            const text = await extractFileText(abs);
            notes.push({ name: path.basename(abs), text });
            ok(`  ✓ Loaded "${path.basename(abs)}" (${text.length} chars). It will guide scenario design.`);
          } catch (e) { err(`  Could not read file: ${e.message}`); }
          return true;
        }
        case '/fix': await runFix(cfg, arg); return true;
        case '/clear': log('\x1Bc'); return true;
        default: warn(`  Unknown command: ${cmd}. Type /help.`); return true;
      }
    }

    // Treat as a generation prompt
    try { await generate(cfg, line); }
    catch (e) { err(`  Generation error: ${e.message}`); }
    return true;
  };

  // Event-driven line queue — robust for both interactive typing and piped/
  // scripted input (the recursive rl.question pattern drops buffered lines).
  const queue = [];
  let processing = false;
  let ended = false;     // stdin EOF / readline closed
  let exiting = false;   // user typed /exit
  let rlClosed = false;

  const safePrompt = () => { if (!rlClosed) try { rl.prompt(); } catch { /* closed */ } };

  rl.setPrompt(promptStr());
  safePrompt();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (!exiting) log(`${c.gray}  Bye.${c.reset}`);
    if (!rlClosed) try { rl.close(); } catch { /* already closed */ }
    // Detach stdin so node's event loop can drain cleanly. Forcing process.exit()
    // while the tty/pipe handle is mid-close triggers a libuv assertion on Windows;
    // unref + a deferred exit avoids that race.
    try { process.stdin.pause(); process.stdin.unref(); } catch { /* ignore */ }
    setImmediate(() => { try { process.exit(0); } catch { /* ignore */ } });
  };

  const pump = async () => {
    if (processing) return;
    processing = true;
    while (queue.length && !exiting) {
      const line = queue.shift();
      let keepGoing = true;
      try { keepGoing = await handle(line); }
      catch (e) { err(`  ${e.message}`); }
      if (!keepGoing) { exiting = true; break; }
      safePrompt();
    }
    processing = false;
    if (exiting || (ended && !queue.length)) finish();
  };

  rl.on('line', (line) => { queue.push(line); pump(); });
  rl.on('close', () => { rlClosed = true; ended = true; if (!processing) finish(); });
}

// Run the CLI only when invoked directly; when required as a module (MCP server),
// expose the building blocks instead.
if (require.main === module) {
  main().catch((e) => { err(`Fatal: ${e.stack || e.message}`); process.exit(1); });
}

module.exports = {
  loadConfig, extractFileText, notes,
  generate, runFix, scrapePage,
  FEATURE_DIR, LOCATOR_DIR, ROOT,
};
