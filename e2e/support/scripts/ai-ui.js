'use strict';
/**
 * ai-ui.js  —  Browser UI for the AI Scenario CLI
 *
 * Usage:  npm run ai:ui
 *
 * Mirrors every /command from ai-cli.js as a visual control:
 *   • Copilot command template
 *   • Test LLM  (like /testllm)
 *   • Mode: gherkin | spec | both
 *   • Locator layout: combined | perpage
 *   • Locator format: yaml | json
 *   • URL input
 *   • Name prefix
 *   • Notes: drag-and-drop files OR paste plain text
 *   • Prompt textarea + Generate button
 *   • Scrape button
 *   • Fix feature: drag-and-drop .feature file + optional error text
 *   • Live output log + generated file list
 */

const path    = require('path');
const fs      = require('fs');
const { chromium } = require('playwright');

// Re-use the core engine from ai-cli.js
const cli = require('./ai-cli.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1200,860', '--window-position=0,0'] });
  // null viewport = tracks the real window size on resize
  const context = await browser.newContext({ viewport: null });
  const page    = await context.newPage();

  // ── Shared mutable state ────────────────────────────────────────────────────
  let cfg   = cli.loadConfig();
  // Notes live on cli.notes (module-level) so generate() picks them up automatically.
  let logs  = [];          // string lines pushed to the UI

  function pushLog(line) {
    logs.push(line);
    page.evaluate((l) => window.__aiLog && window.__aiLog(l), line).catch(() => {});
  }

  // ── Exposed functions (Node → Browser calls them, Browser → Node calls these)
  await page.exposeFunction('aiGetConfig', () => cfg);

  await page.exposeFunction('aiSaveConfig', async (patch) => {
    // Validate copilot command: must be a template only, not contain actual prompt text
    if (patch.copilot !== undefined) {
      const cmd = String(patch.copilot).trim();
      // If user typed an actual prompt into the command field, warn and don't save it
      if (cmd && !cmd.includes('{prompt}') && cmd.split(' ').length > 4) {
        return { ok: false, error: 'The Copilot command field should be a template like: copilot -p {prompt}\nYour actual test description goes in the Prompt tab on the right.' };
      }
    }
    Object.assign(cfg, patch);
    cli.saveConfig(cfg);
    return { ok: true };
  });

  await page.exposeFunction('aiTestLlm', async () => {
    try {
      const out = await cli.runCopilot(cfg, 'Reply with exactly: OK');
      return { ok: true, output: out.trim() };
    } catch (e) {
      return { ok: false, output: String(e.message || e) };
    }
  });

  await page.exposeFunction('aiScrape', async () => {
    if (!cfg.url) return { ok: false, output: 'No URL set.' };
    try {
      const raw  = await cli.scrapePage(cfg.url);
      // scrapePage returns a single {elements:[]} object from page.evaluate — wrap in array
      const info = Array.isArray(raw) ? raw : (raw ? [{ pageKey: 'page', url: cfg.url, elements: raw.elements || [] }] : []);
      const lines = [`URL : ${cfg.url}`, `Elements found: ${info.reduce((s,p)=>s+(p.elements||[]).length,0)}`];
      for (const p of info) {
        lines.push(`\n── ${p.pageKey || 'page'}  (${p.url || cfg.url})`);
        for (const el of (p.elements || []).slice(0, 30)) lines.push(`   [${el.kind||'el'}] ${el.name}  →  ${el.xpath||el.selector||''}`);
        if ((p.elements || []).length > 30) lines.push(`   … +${p.elements.length - 30} more`);
      }
      return { ok: true, output: lines.join('\n') };
    } catch (e) {
      return { ok: false, output: String(e.message || e) };
    }
  });

  await page.exposeFunction('aiGenerate', async (prompt) => {
    if (!prompt) return { ok: false, output: 'No prompt.' };
    if (!cfg.url)  return { ok: false, output: 'Set a URL first.' };
    try {
      const result = await cli.generate(cfg, prompt);
      // generate() returns undefined when the LLM returns no scenarios — handle gracefully
      if (!result) return { ok: false, output: 'LLM returned no scenarios. Check the Output log and try a more specific prompt.' };
      return { ok: true, files: result.files || [], output: result.summary || 'Done.' };
    } catch (e) {
      return { ok: false, output: String(e.message || e) };
    }
  });

  // Notes use cli.notes (the module-level array) so generate() picks them up via notesBlock()
  await page.exposeFunction('aiAddNoteFile', async (absPath) => {
    try {
      const text = await cli.extractFileText(absPath);
      const name = path.basename(absPath);
      cli.notes.push({ name, text });
      return { ok: true, name };
    } catch (e) {
      return { ok: false, output: String(e.message || e) };
    }
  });

  await page.exposeFunction('aiAddNoteText', async (text) => {
    if (!text.trim()) return { ok: false };
    cli.notes.push({ name: 'inline note', text });
    return { ok: true };
  });

  await page.exposeFunction('aiClearNotes', async () => {
    cli.notes.splice(0, cli.notes.length);  // clear in-place so generate() sees the empty array
    return { ok: true };
  });

  await page.exposeFunction('aiGetNotes', () => cli.notes.map(n => n.name));

  await page.exposeFunction('aiFix', async (featurePath, errorText) => {
    try {
      const arg = [featurePath, errorText].filter(Boolean).join(' ');
      await cli.runFix(cfg, arg);
      return { ok: true, output: 'Fix applied.' };
    } catch (e) {
      return { ok: false, output: String(e.message || e) };
    }
  });

  // ── Load page ───────────────────────────────────────────────────────────────
  await page.goto('about:blank');
  await page.evaluate(buildUI, { initCfg: cfg });

  browser.on('disconnected', () => process.exit(0));
}

// ─────────────────────────────────────────────────────────────────────────────
// buildUI — serialised and executed inside the browser page
// ─────────────────────────────────────────────────────────────────────────────
function buildUI({ initCfg }) {
  /* global document, window */

  // ── state ──────────────────────────────────────────────────────────────────
  let cfg        = { ...initCfg };
  let noteNames  = [];
  let generating = false;

  // ── helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs || {})) {
      if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    }
    return e;
  }
  function div(cls, ...children) { return el('div', { class: cls }, ...children); }

  // ── styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }

    html, body {
      height:100%; min-height:0;
      background:#020617; color:#e2e8f0;
      font-family:system-ui,'Segoe UI',Roboto,sans-serif;
    }
    body { display:flex; flex-direction:row; overflow:hidden; height:100vh; }

    /* ── sidebar ── */
    .sidebar {
      width:clamp(260px, 32vw, 380px);
      flex-shrink:0;
      background:#0f172a;
      border-right:1px solid rgba(148,163,184,0.1);
      display:flex; flex-direction:column;
      min-height:0; overflow:hidden;
    }
    .sidebar-header {
      padding:12px 16px 10px;
      border-bottom:1px solid rgba(148,163,184,0.08);
      flex-shrink:0;                /* header never scrolls away */
    }
    .sidebar-title { font-size:14px; font-weight:900; color:#f1f5f9; letter-spacing:-.3px; }
    .sidebar-sub   { font-size:10.5px; color:#475569; margin-top:2px; line-height:1.4; }
    /* sidebar body: full scroll — all controls reachable no matter height */
    .sidebar-body {
      flex:1; min-height:0; overflow-y:auto; overflow-x:hidden;
      padding:12px 14px 32px;      /* 32px bottom pad so last item clears the edge */
      display:flex; flex-direction:column; gap:12px;
    }

    /* ── field ── */
    .field { display:flex; flex-direction:column; gap:5px; flex-shrink:0; }
    .label { font-size:10.5px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.5px; }
    .input {
      background:#1e293b; border:1px solid rgba(148,163,184,0.15);
      border-radius:8px; color:#e2e8f0; font-size:12px;
      padding:7px 10px; outline:none; width:100%;
      transition:border-color .15s;
    }
    .input:focus { border-color:#6366f1; }
    .input::placeholder { color:#334155; }
    textarea.input { resize:vertical; min-height:52px; font-family:inherit; line-height:1.5; }

    /* ── segmented control ── */
    .seg { display:flex; gap:3px; background:#0a0f1e; border-radius:9px; padding:3px; }
    .seg-btn {
      flex:1; padding:5px 0; border-radius:7px; border:0; cursor:pointer;
      background:transparent; color:#475569; font-size:11px; font-weight:700;
      transition:all .15s; white-space:nowrap;
    }
    .seg-btn.active { background:#4f46e5; color:#fff; }

    /* ── buttons ── */
    .btn {
      padding:7px 12px; border-radius:9px; border:0; cursor:pointer;
      font-size:11.5px; font-weight:800; transition:opacity .15s; white-space:nowrap;
    }
    .btn:hover { opacity:.85; }
    .btn:disabled { opacity:.35; cursor:default; }
    .btn-primary { background:linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; }
    .btn-ghost   { background:rgba(148,163,184,0.08); color:#94a3b8; }
    .btn-danger  { background:rgba(239,68,68,0.15); color:#f87171; }
    .btn-success { background:rgba(34,197,94,0.15); color:#4ade80; }
    .btn-row { display:flex; gap:6px; flex-wrap:wrap; flex-shrink:0; }

    /* ── drop zone ── */
    .dropzone {
      border:2px dashed rgba(148,163,184,0.2); border-radius:10px;
      padding:12px; text-align:center; color:#475569; font-size:11.5px;
      cursor:pointer; transition:all .15s; position:relative; flex-shrink:0;
    }
    .dropzone.over { border-color:#6366f1; background:rgba(99,102,241,0.06); color:#a5b4fc; }
    .dropzone input[type=file] {
      position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%;
    }
    .note-chip {
      display:inline-flex; align-items:center; gap:5px;
      background:rgba(99,102,241,0.15); color:#a5b4fc;
      border-radius:20px; padding:3px 10px 3px 8px;
      font-size:11px; font-weight:700; margin:2px;
    }
    .note-chip button {
      background:none; border:0; color:#6366f1; cursor:pointer; font-size:13px; line-height:1; padding:0;
    }

    /* ── divider ── */
    .divider { height:1px; background:rgba(148,163,184,0.08); margin:1px 0; flex-shrink:0; }

    /* ── main area ── */
    .main {
      flex:1; min-width:0; display:flex; flex-direction:column; overflow:hidden;
    }

    /* ── tabs — wrap on very narrow windows ── */
    .main-tabs {
      display:flex; gap:2px; padding:8px 16px 0; flex-wrap:wrap;
      background:#0f172a; border-bottom:1px solid rgba(148,163,184,0.08);
      flex-shrink:0;
    }
    .tab {
      padding:6px 12px; border-radius:8px 8px 0 0; border:0;
      background:transparent; color:#475569; font-size:11.5px; font-weight:800;
      cursor:pointer; transition:all .15s; border:1px solid transparent;
      border-bottom:none; position:relative; top:1px; white-space:nowrap;
    }
    .tab.active { background:#020617; color:#a5b4fc; border-color:rgba(148,163,184,0.12); }
    .tab:hover:not(.active) { color:#94a3b8; }
    /* Pane: fills remaining height, clips overflow — each pane's inner
       container handles its own scroll.                                 */
    .pane { flex:1; min-height:0; overflow:hidden; display:none; flex-direction:column; }
    .pane.active { display:flex; }

    /* ── prompt pane ──
       The whole prompt-area is the scroll container.
       textarea has a FIXED height (not flex:1) so the Generate button
       is always rendered below it and scrolled into view.              */
    .prompt-area {
      flex:1; min-height:0;
      overflow-y:auto;           /* entire area scrolls — nothing clips  */
      display:flex; flex-direction:column;
      padding:14px 16px 16px; gap:10px;
    }
    textarea#prompt-input {
      width:100%;
      height:260px;              /* fixed — user can see button below    */
      min-height:100px;
      background:#0a0f1e; border:1px solid rgba(148,163,184,0.12);
      border-radius:12px; color:#e2e8f0; font-size:13px; font-family:inherit;
      padding:12px 14px; resize:vertical; outline:none; line-height:1.6;
      transition:border-color .15s; flex-shrink:0;
    }
    textarea#prompt-input:focus { border-color:#6366f1; }
    textarea#prompt-input::placeholder { color:#334155; }
    /* Generate bar — sits below textarea, always reachable by scrolling */
    .prompt-bar {
      display:flex; gap:8px; align-items:center;
      flex-shrink:0;
      padding:6px 0 4px;
      border-top:1px solid rgba(148,163,184,0.08);
    }
    .prompt-bar .btn-primary { flex-shrink:0; padding:10px 22px; font-size:13px; }

    /* ── log pane ── */
    .log-header {
      display:flex; align-items:center; gap:8px;
      padding:8px 16px 0; flex-shrink:0;
    }
    .log-area {
      flex:1; min-height:0; overflow-y:auto; padding:10px 16px 16px;
      font-family:'Cascadia Code','Fira Code','Courier New',monospace;
      font-size:12px; line-height:1.7;
    }
    .log-line { white-space:pre-wrap; word-break:break-all; }
    .log-line.info  { color:#93c5fd; }
    .log-line.ok    { color:#4ade80; }
    .log-line.warn  { color:#fbbf24; }
    .log-line.err   { color:#f87171; }
    .log-line.dim   { color:#475569; }
    .log-line.head  { color:#c084fc; font-weight:900; }

    /* ── files pane ── */
    .files-area { flex:1; min-height:0; overflow-y:auto; padding:14px 16px; display:flex; flex-direction:column; gap:8px; }
    .file-card {
      background:#0f172a; border:1px solid rgba(148,163,184,0.1);
      border-radius:10px; padding:10px 14px; display:flex; align-items:center; gap:10px;
      flex-shrink:0;
    }
    .file-icon { font-size:18px; flex-shrink:0; }
    .file-name { font-size:12.5px; color:#e2e8f0; font-weight:700; }
    .file-path { font-size:11px; color:#475569; margin-top:2px; word-break:break-all; }
    .file-badge {
      margin-left:auto; padding:3px 8px; border-radius:6px;
      font-size:10px; font-weight:900; flex-shrink:0;
    }
    .badge-feature  { background:rgba(99,102,241,0.2); color:#a5b4fc; }
    .badge-locator  { background:rgba(34,197,94,0.15); color:#4ade80; }
    .badge-spec     { background:rgba(251,191,36,0.15); color:#fbbf24; }

    /* ── fix pane ── */
    .fix-area { flex:1; min-height:0; padding:14px 16px; display:flex; flex-direction:column; gap:12px; overflow-y:auto; }
    .fix-dropzone {
      border:2px dashed rgba(148,163,184,0.2); border-radius:12px;
      padding:20px; text-align:center; color:#475569; font-size:13px;
      cursor:pointer; transition:all .15s; position:relative; flex-shrink:0;
    }
    .fix-dropzone.over, .fix-dropzone.has-file { border-color:#4f46e5; background:rgba(79,70,229,0.06); }
    .fix-dropzone input[type=file] { position:absolute; inset:0; opacity:0; cursor:pointer; }
    .fix-dropzone.has-file .fix-drop-label { color:#a5b4fc; }

    /* ── spinner ── */
    @keyframes spin { to { transform:rotate(360deg); } }
    .spinner {
      width:14px; height:14px; border:2px solid rgba(255,255,255,0.2);
      border-top-color:#fff; border-radius:50%;
      animation:spin .7s linear infinite; flex-shrink:0;
    }

    /* ── narrow window: collapse sidebar to icon rail ── */
    @media (max-width:680px) {
      .sidebar { width:48px; min-width:48px; }
      .sidebar-header, .sidebar-body { display:none; }
      .sidebar::after {
        content:'⚙'; font-size:20px; color:#475569;
        display:flex; align-items:center; justify-content:center;
        height:100%; cursor:default;
        writing-mode:vertical-rl; letter-spacing:0;
      }
    }

    /* scrollbars */
    ::-webkit-scrollbar { width:5px; }
    ::-webkit-scrollbar-track { background:transparent; }
    ::-webkit-scrollbar-thumb { background:rgba(148,163,184,0.15); border-radius:3px; }
  `;
  document.head.appendChild(style);

  // ── LOG helpers ─────────────────────────────────────────────────────────────
  const logArea = null; // assigned after DOM build
  let logEl;
  function appendLog(text, cls) {
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = 'log-line ' + (cls || 'info');
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  window.__aiLog = (line) => {
    const cls = line.startsWith('✓') || line.startsWith('  ✓') ? 'ok'
              : line.startsWith('✗') || line.startsWith('  ✗') || line.includes('error') ? 'err'
              : line.startsWith('  ›') || line.startsWith('›') ? 'dim'
              : line.startsWith('⚙') || line.startsWith('  ⚙') ? 'warn'
              : 'info';
    appendLog(line, cls);
    switchTab('log');
  };

  // ── DOM BUILD ───────────────────────────────────────────────────────────────
  document.body.style.margin = '0';

  // ═══ SIDEBAR ════════════════════════════════════════════════════════════════
  const sidebar = div('sidebar');

  const sideHeader = div('sidebar-header');
  sideHeader.innerHTML = `
    <div class="sidebar-title">🤖 AI Scenario UI</div>
    <div class="sidebar-sub">GitHub Copilot CLI backend · all settings saved automatically</div>
  `;
  sidebar.appendChild(sideHeader);

  const sideBody = div('sidebar-body');

  // ── Copilot command ─────────────────────────────────────────────────────────
  const copilotInput = el('input', { class:'input', placeholder:'copilot -p {prompt} --allow-all-tools', value: cfg.copilot || '' });
  copilotInput.addEventListener('change', async () => {
    const r = await window.aiSaveConfig({ copilot: copilotInput.value.trim() });
    if (r && !r.ok && r.error) {
      // Reset field to last good value and show error in log
      copilotInput.value = cfg.copilot || '';
      copilotInput.style.borderColor = '#f87171';
      appendLog('✗ ' + r.error, 'err');
      switchTab('log');
      setTimeout(() => { copilotInput.style.borderColor = ''; }, 3000);
    } else {
      cfg.copilot = copilotInput.value.trim();
    }
  });

  const testBtn = el('button', { class:'btn btn-ghost', style:{ fontSize:'11.5px' } }, '🧪 Test LLM');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = '⏳ Testing…';
    switchTab('log');
    appendLog('Testing Copilot CLI…', 'head');
    const r = await window.aiTestLlm();
    appendLog(r.ok ? '✓ ' + r.output : '✗ ' + r.output, r.ok ? 'ok' : 'err');
    testBtn.disabled = false;
    testBtn.textContent = '🧪 Test LLM';
  });

  const copilotField = div('field',
    el('label', { class:'label' }, '/copilot — Command template'),
    copilotInput,
    el('div', { style:{ fontSize:'11px', color:'#334155', marginTop:'2px' } }, 'Use {prompt} where the prompt goes, or omit to pipe via stdin'),
    div('btn-row', testBtn)
  );
  sideBody.appendChild(copilotField);
  sideBody.appendChild(div('divider'));

  // ── URL ─────────────────────────────────────────────────────────────────────
  const urlInput = el('input', { class:'input', placeholder:'https://app.example.com', value: cfg.url || '' });
  urlInput.addEventListener('change', async () => {
    cfg.url = urlInput.value.trim();
    await window.aiSaveConfig({ url: cfg.url });
  });
  const scrapeBtn = el('button', { class:'btn btn-ghost', style:{ fontSize:'11.5px' } }, '🔍 Scrape URL');
  scrapeBtn.addEventListener('click', async () => {
    cfg.url = urlInput.value.trim();
    await window.aiSaveConfig({ url: cfg.url });
    if (!cfg.url) { appendLog('Set a URL first.', 'err'); switchTab('log'); return; }
    scrapeBtn.disabled = true; scrapeBtn.textContent = '⏳ Scraping…';
    switchTab('log'); appendLog(`Scraping ${cfg.url} …`, 'head');
    const r = await window.aiScrape();
    appendLog(r.ok ? r.output : '✗ ' + r.output, r.ok ? 'info' : 'err');
    scrapeBtn.disabled = false; scrapeBtn.textContent = '🔍 Scrape URL';
  });
  sideBody.appendChild(div('field',
    el('label', { class:'label' }, '/url — Target URL'),
    urlInput,
    div('btn-row', scrapeBtn)
  ));

  // ── Name prefix ──────────────────────────────────────────────────────────────
  const nameInput = el('input', { class:'input', placeholder:'(AI names files per scenario)', value: cfg.fileName || '' });
  nameInput.addEventListener('change', async () => {
    cfg.fileName = nameInput.value.trim();
    await window.aiSaveConfig({ fileName: cfg.fileName });
  });
  sideBody.appendChild(div('field',
    el('label', { class:'label' }, '/name — File prefix (optional)'),
    nameInput
  ));
  sideBody.appendChild(div('divider'));

  // ── Mode ────────────────────────────────────────────────────────────────────
  function makeSeg(options, current, onChange) {
    const wrap = div('seg');
    for (const { value, label } of options) {
      const b = el('button', { class: 'seg-btn' + (value === current ? ' active' : '') }, label);
      b.dataset.value = value;
      b.addEventListener('click', () => {
        wrap.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        onChange(value);
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  const modeSeg = makeSeg(
    [{ value:'gherkin', label:'Gherkin' }, { value:'spec', label:'spec.ts' }, { value:'both', label:'Both' }],
    cfg.mode || 'gherkin',
    async (v) => { cfg.mode = v; await window.aiSaveConfig({ mode: v }); }
  );
  sideBody.appendChild(div('field',
    el('label', { class:'label' }, '/mode — What to generate'),
    modeSeg,
    el('div', { style:{ fontSize:'11px', color:'#334155' } }, 'Gherkin = .feature + locators  ·  spec.ts = Playwright spec  ·  Both = all')
  ));

  // ── Locator layout ──────────────────────────────────────────────────────────
  const layoutSeg = makeSeg(
    [{ value:'combined', label:'Combined' }, { value:'perpage', label:'Per-page' }],
    cfg.locatorlayout || 'combined',
    async (v) => { cfg.locatorlayout = v; await window.aiSaveConfig({ locatorlayout: v }); }
  );
  sideBody.appendChild(div('field',
    el('label', { class:'label' }, '/locatorlayout — File structure'),
    layoutSeg,
    el('div', { style:{ fontSize:'11px', color:'#334155' } }, 'Combined = one file, all pages nested  ·  Per-page = one file per page')
  ));

  // ── Locator format ──────────────────────────────────────────────────────────
  const formatSeg = makeSeg(
    [{ value:'yaml', label:'YAML' }, { value:'json', label:'JSON' }],
    cfg.locatorformat || 'yaml',
    async (v) => { cfg.locatorformat = v; await window.aiSaveConfig({ locatorformat: v }); }
  );
  sideBody.appendChild(div('field',
    el('label', { class:'label' }, '/locatorformat — File format'),
    formatSeg,
    el('div', { style:{ fontSize:'11px', color:'#334155' } }, 'YAML or JSON locator files — runtime accepts both')
  ));
  sideBody.appendChild(div('divider'));

  // ── Notes ───────────────────────────────────────────────────────────────────
  const noteChips = div('', );
  noteChips.id = 'note-chips';
  noteChips.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;min-height:4px;';

  function refreshNoteChips(names) {
    noteChips.innerHTML = '';
    names.forEach((name, i) => {
      const chip = div('note-chip', '📎 ' + name);
      const rm = el('button', {}, '×');
      rm.addEventListener('click', async () => {
        // Remove by index: clear all and re-add without this one
        const r = await window.aiGetNotes();
        // easiest: clear + re-add is complex; just notify user to clear all
        appendLog(`To remove individual notes, use Clear All Notes.`, 'warn');
      });
      chip.appendChild(rm);
      noteChips.appendChild(chip);
    });
  }

  const noteDropzone = div('dropzone');
  noteDropzone.innerHTML = `
    <div>📂 Drag &amp; drop <strong>.txt .md .docx</strong> files here</div>
    <div style="font-size:11px;margin-top:4px;">or click to browse</div>
    <input type="file" multiple accept=".txt,.md,.docx" />
  `;
  noteDropzone.querySelector('input').addEventListener('change', async function() {
    for (const file of this.files) {
      const r = await window.aiAddNoteFile(file.path);
      if (r.ok) { appendLog(`✓ Note loaded: ${r.name}`, 'ok'); }
      else appendLog('✗ ' + (r.output || 'Failed'), 'err');
    }
    const names = await window.aiGetNotes();
    refreshNoteChips(names);
    this.value = '';
  });
  noteDropzone.addEventListener('dragover', e => { e.preventDefault(); noteDropzone.classList.add('over'); });
  noteDropzone.addEventListener('dragleave', () => noteDropzone.classList.remove('over'));
  noteDropzone.addEventListener('drop', async e => {
    e.preventDefault(); noteDropzone.classList.remove('over');
    for (const file of e.dataTransfer.files) {
      const r = await window.aiAddNoteFile(file.path);
      if (r.ok) appendLog(`✓ Note loaded: ${r.name}`, 'ok');
      else appendLog('✗ ' + (r.output || 'Failed'), 'err');
    }
    const names = await window.aiGetNotes();
    refreshNoteChips(names);
  });

  // Inline text note
  const noteTextarea = el('textarea', { class:'input', placeholder:'Or paste plain-text notes here…', rows:'3' });
  const addNoteTextBtn = el('button', { class:'btn btn-ghost', style:{ fontSize:'11.5px' } }, '+ Add text note');
  addNoteTextBtn.addEventListener('click', async () => {
    const t = noteTextarea.value.trim();
    if (!t) return;
    const r = await window.aiAddNoteText(t);
    if (r.ok) { noteTextarea.value = ''; appendLog('✓ Inline note added', 'ok'); }
    const names = await window.aiGetNotes();
    refreshNoteChips(names);
  });

  const clearNotesBtn = el('button', { class:'btn btn-danger', style:{ fontSize:'11.5px' } }, '🗑 Clear notes');
  clearNotesBtn.addEventListener('click', async () => {
    await window.aiClearNotes();
    refreshNoteChips([]);
    appendLog('Notes cleared.', 'dim');
  });

  sideBody.appendChild(div('field',
    el('label', { class:'label' }, '/notes — Context files or text'),
    noteDropzone,
    noteChips,
    noteTextarea,
    div('btn-row', addNoteTextBtn, clearNotesBtn)
  ));

  sidebar.appendChild(sideBody);
  document.body.appendChild(sidebar);

  // ═══ MAIN ════════════════════════════════════════════════════════════════════
  const main = div('main');

  // tabs
  const tabBar = div('main-tabs');
  function makeTab(id, label) {
    const b = el('button', { class:'tab' + (id === 'prompt' ? ' active' : '') }, label);
    b.dataset.tab = id;
    b.addEventListener('click', () => switchTab(id));
    return b;
  }
  function switchTab(id) {
    tabBar.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    main.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + id));
  }
  tabBar.appendChild(makeTab('prompt', '✏️ Prompt'));
  tabBar.appendChild(makeTab('log',    '📟 Output log'));
  tabBar.appendChild(makeTab('files',  '📁 Generated files'));
  tabBar.appendChild(makeTab('fix',    '🔧 Fix feature'));
  main.appendChild(tabBar);

  // ── Prompt pane ─────────────────────────────────────────────────────────────
  const promptPane = div('pane active');
  promptPane.id = 'pane-prompt';

  // Prompt pane: textarea grows, Generate bar is always pinned at bottom
  const promptArea = div('prompt-area');
  const promptInput = el('textarea', { id:'prompt-input', placeholder:'Describe what you want to test…\n\ne.g.  test the login flow including wrong password and locked account\n      cover all eligibility quiz scenarios and edge cases' });
  promptArea.appendChild(promptInput);

  const genSpinner = div('spinner');
  genSpinner.style.display = 'none';
  const genBtn = el('button', { class:'btn btn-primary' }, '⚡ Generate');

  genBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    if (generating) return;
    generating = true;
    genBtn.disabled = true; genSpinner.style.display = 'block';
    switchTab('log');
    appendLog(`Generating  [mode:${cfg.mode}  layout:${cfg.locatorlayout}  format:${cfg.locatorformat}]`, 'head');
    appendLog(`URL: ${cfg.url || '(none)'}`, 'dim');

    const r = await window.aiGenerate(prompt);
    if (r.ok) {
      appendLog('✓ Generation complete', 'ok');
      if (r.output) appendLog(r.output, 'dim');
      renderFiles(r.files || []);
    } else {
      appendLog('✗ ' + r.output, 'err');
    }
    genBtn.disabled = false; genSpinner.style.display = 'none';
    generating = false;
  });

  const promptBar = div('prompt-bar');
  promptBar.appendChild(genSpinner);
  promptBar.appendChild(genBtn);
  promptArea.appendChild(promptBar);
  promptPane.appendChild(promptArea);

  // ── Log pane ─────────────────────────────────────────────────────────────────
  const logPane = div('pane');
  logPane.id = 'pane-log';
  const logHeader = div('log-header');
  const clearLogBtn = el('button', { class:'btn btn-ghost', style:{ fontSize:'11px' } }, '🗑 Clear log');
  clearLogBtn.addEventListener('click', () => { logEl.innerHTML = ''; });
  logHeader.appendChild(clearLogBtn);
  logPane.appendChild(logHeader);
  logEl = div('log-area');
  logEl.id = 'log-area';
  logPane.appendChild(logEl);

  // ── Files pane ───────────────────────────────────────────────────────────────
  const filesPane = div('pane');
  filesPane.id = 'pane-files';
  const filesArea = div('files-area');
  filesArea.id = 'files-area';
  const filesEmpty = div('', );
  filesEmpty.style.cssText = 'color:#334155;font-size:13px;padding:20px;text-align:center;';
  filesEmpty.textContent = 'No files generated yet. Write a prompt and click Generate.';
  filesArea.appendChild(filesEmpty);
  filesPane.appendChild(filesArea);

  function renderFiles(files) {
    if (!files.length) return;
    filesArea.innerHTML = '';
    for (const f of files) {
      const ext  = (f.path || '').split('.').pop();
      const icon = ext === 'feature' ? '📄' : ext === 'json' ? '{}' : ext === 'yaml' ? '📋' : '📝';
      const badge = ext === 'feature' ? 'badge-feature' : ext === 'ts' ? 'badge-spec' : 'badge-locator';
      const label = ext === 'feature' ? 'feature' : ext === 'ts' ? 'spec.ts' : 'locator';
      const card = div('file-card');
      card.innerHTML = `
        <span class="file-icon">${icon}</span>
        <div style="flex:1;min-width:0;">
          <div class="file-name">${esc((f.path || '').split(/[\\/]/).pop())}</div>
          <div class="file-path">${esc(f.path || '')}</div>
        </div>
        <span class="file-badge ${badge}">${label}</span>
      `;
      filesArea.appendChild(card);
    }
    switchTab('files');
  }

  // ── Fix pane ─────────────────────────────────────────────────────────────────
  const fixPane = div('pane');
  fixPane.id = 'pane-fix';
  const fixArea = div('fix-area');

  let fixFilePath = '';
  const fixDropzone = div('fix-dropzone');
  fixDropzone.innerHTML = `
    <div class="fix-drop-label">📄 Drag &amp; drop a <strong>.feature</strong> file here to fix</div>
    <div style="font-size:11px;margin-top:6px;color:#334155;">or click to browse</div>
    <input type="file" accept=".feature" />
  `;
  fixDropzone.querySelector('input').addEventListener('change', function() {
    if (this.files[0]) {
      fixFilePath = this.files[0].path;
      fixDropzone.querySelector('.fix-drop-label').textContent = '✓ ' + this.files[0].name;
      fixDropzone.classList.add('has-file');
    }
  });
  fixDropzone.addEventListener('dragover', e => { e.preventDefault(); fixDropzone.classList.add('over'); });
  fixDropzone.addEventListener('dragleave', () => fixDropzone.classList.remove('over'));
  fixDropzone.addEventListener('drop', e => {
    e.preventDefault(); fixDropzone.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.feature')) {
      fixFilePath = file.path;
      fixDropzone.querySelector('.fix-drop-label').textContent = '✓ ' + file.name;
      fixDropzone.classList.add('has-file');
    }
  });

  const fixErrorInput = el('textarea', { class:'input', placeholder:'Paste the error message or test failure output here (optional)…', rows:'5' });
  const fixBtn = el('button', { class:'btn btn-primary' }, '🔧 Run Fix');
  fixBtn.addEventListener('click', async () => {
    if (!fixFilePath) { appendLog('Drop a .feature file first.', 'err'); switchTab('log'); return; }
    fixBtn.disabled = true; fixBtn.textContent = '⏳ Fixing…';
    switchTab('log'); appendLog(`Fixing: ${fixFilePath}`, 'head');
    const r = await window.aiFix(fixFilePath, fixErrorInput.value.trim());
    appendLog(r.ok ? '✓ ' + r.output : '✗ ' + r.output, r.ok ? 'ok' : 'err');
    fixBtn.disabled = false; fixBtn.textContent = '🔧 Run Fix';
  });

  fixArea.appendChild(div('field',
    el('label', { class:'label' }, '/fix — Auto-correct a failing feature'),
    fixDropzone
  ));
  fixArea.appendChild(div('field',
    el('label', { class:'label' }, 'Error output (optional)'),
    fixErrorInput
  ));
  fixArea.appendChild(div('btn-row', fixBtn));
  fixPane.appendChild(fixArea);

  // ── Assemble ─────────────────────────────────────────────────────────────────
  main.appendChild(promptPane);
  main.appendChild(logPane);
  main.appendChild(filesPane);
  main.appendChild(fixPane);
  document.body.appendChild(main);
}

main().catch(e => { console.error(e); process.exit(1); });
