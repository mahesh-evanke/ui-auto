/**
 * inspect.js — Visual element inspector for the Playwright Cucumber framework.
 *
 * Usage:
 *   node e2e/support/scripts/inspect.js <url|pageKey>
 *
 * Examples:
 *   node e2e/support/scripts/inspect.js https://customer-billing-deve.vercel.app/login
 *   node e2e/support/scripts/inspect.js endtoend
 *
 * Hover an element to highlight it.
 * Click an element to open the inspector panel with suggested locators.
 * Press ESC or click × to close the panel and keep browsing.
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const yaml = require('js-yaml');

// ── Resolve URL from argument ─────────────────────────────────────────────────
const arg = process.argv[2] || '';
let targetUrl = arg;

if (arg && !arg.startsWith('http')) {
  // Treat as page key → look up URL in its locator YAML
  const cats = ['endtoend', 'web', 'api'];
  const locRoot = path.join(process.cwd(), 'e2e', 'locators', 'generated');
  for (const cat of cats) {
    const fp = path.join(locRoot, cat, `${arg}.yaml`);
    if (fs.existsSync(fp)) {
      try {
        const doc = yaml.load(fs.readFileSync(fp, 'utf8')) || {};
        const urls = doc.urls || {};
        targetUrl = Object.values(urls)[0] || '';
      } catch {}
      break;
    }
  }
  if (!targetUrl) {
    // fall back to config.yaml
    const cfgPath = path.join(process.cwd(), 'e2e', 'config', 'config.yaml');
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {};
        targetUrl = (cfg.baseUrl || cfg.base_url || '').replace(/\/$/, '');
      } catch {}
    }
  }
}

if (!targetUrl) {
  console.error('Usage: node inspect.js <url|pageKey>');
  process.exit(1);
}

console.log(`\n🔍  Inspector launching → ${targetUrl}\n`);
console.log('  Hover  : highlight element');
console.log('  Click  : open locator panel');
console.log('  ESC    : close panel');
console.log('  Ctrl+C : quit\n');

// ── Inspector overlay injected into the page ─────────────────────────────────
const OVERLAY_SCRIPT = /* js */ `
(function () {
  if (document.getElementById('__ccinsp_root')) return;

  /* ── styles ─────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = \`
    #__ccinsp_highlight {
      position: fixed; pointer-events: none; z-index: 2147483645;
      box-sizing: border-box;
      border: 2px solid #4f8ef7;
      background: rgba(79,142,247,.12);
      border-radius: 3px;
      transition: all .08s ease;
    }
    #__ccinsp_label {
      position: fixed; pointer-events: none; z-index: 2147483646;
      background: #4f8ef7; color: #fff;
      font: 700 11px/1 monospace; padding: 3px 6px; border-radius: 3px;
      white-space: nowrap; max-width: 400px; overflow: hidden; text-overflow: ellipsis;
    }
    #__ccinsp_panel {
      position: fixed; z-index: 2147483647;
      top: 0; right: 0; bottom: 0;
      width: 380px;
      background: #1e1e2e; color: #cdd6f4;
      font: 13px/1.5 -apple-system, 'Segoe UI', sans-serif;
      box-shadow: -4px 0 24px rgba(0,0,0,.5);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    #__ccinsp_panel.hidden { display: none !important; }
    .__ccinsp_header {
      background: #181825; padding: 14px 16px 12px;
      border-bottom: 1px solid #313244;
      display: flex; align-items: center; gap: 8px;
    }
    .__ccinsp_header h2 {
      margin: 0; font-size: 14px; font-weight: 700; color: #cba6f7; flex: 1;
    }
    .__ccinsp_close {
      background: none; border: none; color: #6c7086; cursor: pointer;
      font-size: 18px; line-height:1; padding: 0 4px;
    }
    .__ccinsp_close:hover { color: #f38ba8; }
    .__ccinsp_body { flex: 1; overflow-y: auto; padding: 12px 14px; }
    .__ccinsp_section { margin-bottom: 14px; }
    .__ccinsp_section h3 {
      margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: .08em;
      text-transform: uppercase; color: #585b70;
    }
    .__ccinsp_tag {
      display: inline-block; background: #313244; color: #89dceb;
      font: 700 12px/1 monospace; padding: 2px 8px; border-radius: 12px; margin-bottom: 8px;
    }
    .__ccinsp_attr_grid {
      display: grid; grid-template-columns: auto 1fr; gap: 2px 8px;
      font-size: 12px;
    }
    .__ccinsp_attr_key { color: #89b4fa; white-space: nowrap; }
    .__ccinsp_attr_val {
      color: #a6e3a1; font-family: monospace; font-size: 11px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .__ccinsp_locator_row {
      margin-bottom: 8px; background: #181825; border-radius: 6px;
      border: 1px solid #313244; overflow: hidden;
    }
    .__ccinsp_loc_header {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px; background: #11111b; border-bottom: 1px solid #313244;
    }
    .__ccinsp_loc_badge {
      font: 700 10px/1 monospace; padding: 2px 6px; border-radius: 10px;
      background: #313244; color: #cba6f7;
    }
    .__ccinsp_loc_desc { font-size: 11px; color: #6c7086; flex: 1; }
    .__ccinsp_copy_btn {
      background: none; border: 1px solid #45475a; color: #cdd6f4;
      font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
      white-space: nowrap;
    }
    .__ccinsp_copy_btn:hover { background: #313244; border-color: #cba6f7; color: #cba6f7; }
    .__ccinsp_copy_btn.copied { border-color: #a6e3a1; color: #a6e3a1; }
    .__ccinsp_loc_code {
      font: 12px/1.6 monospace; padding: 8px 10px;
      color: #f9e2af; word-break: break-all; white-space: pre-wrap;
    }
    .__ccinsp_yaml_box {
      background: #181825; border-radius: 6px; border: 1px solid #313244;
    }
    .__ccinsp_yaml_head {
      display: flex; align-items: center; padding: 6px 10px;
      background: #11111b; border-bottom: 1px solid #313244; gap: 6px;
    }
    .__ccinsp_yaml_head span { font-size: 11px; color: #6c7086; flex: 1; }
    .__ccinsp_yaml_code {
      font: 12px/1.6 monospace; padding: 8px 10px;
      color: #94e2d5; white-space: pre;
    }
    .__ccinsp_footer {
      padding: 10px 14px; border-top: 1px solid #313244;
      font-size: 11px; color: #6c7086; text-align: center;
    }
  \`;
  document.head.appendChild(style);

  /* ── DOM elements ────────────────────────────────────────────── */
  const hl    = Object.assign(document.createElement('div'), { id: '__ccinsp_highlight' });
  const lbl   = Object.assign(document.createElement('div'), { id: '__ccinsp_label' });
  const panel = Object.assign(document.createElement('div'), { id: '__ccinsp_panel' });
  panel.classList.add('hidden');
  document.body.append(hl, lbl, panel);

  /* ── Helpers ─────────────────────────────────────────────────── */
  function esc(s) {
    return String(s || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
  }
  function escYaml(s) {
    return String(s || '').replace(/'/g, "''");
  }
  function inferRole(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button' || (tag === 'input' && type === 'button') || (tag === 'input' && type === 'submit')) return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'input' && (type === '' || type === 'text' || type === 'email' || type === 'password' || type === 'search' || type === 'tel' || type === 'url' || type === 'number')) return 'textbox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input' && type === 'checkbox') return 'checkbox';
    if (tag === 'input' && type === 'radio') return 'radio';
    return el.getAttribute('role') || '';
  }
  function getLabel(el) {
    // explicit aria-label
    const al = el.getAttribute('aria-label');
    if (al) return al.trim();
    // aria-labelledby
    const alby = el.getAttribute('aria-labelledby');
    if (alby) {
      const ref = document.getElementById(alby);
      if (ref) return ref.textContent.trim();
    }
    // <label for="id">
    const id = el.id;
    if (id) {
      const lbl = document.querySelector(\`label[for="\${id}"]\`);
      if (lbl) return lbl.textContent.trim();
    }
    // placeholder
    const ph = el.getAttribute('placeholder');
    if (ph) return ph.trim();
    // inner text (truncated)
    const t = el.textContent.trim().replace(/\\s+/g, ' ');
    if (t && t.length <= 60) return t;
    return '';
  }

  function generateLocators(el) {
    const tag     = el.tagName.toLowerCase();
    const role    = el.getAttribute('role') || inferRole(el);
    const ariaLabel = el.getAttribute('aria-label');
    const ph      = el.getAttribute('placeholder');
    const id      = el.id;
    const name    = el.getAttribute('name');
    const type    = el.getAttribute('type');
    const text    = el.textContent.trim().replace(/\\s+/g, ' ');
    const labelTxt = (() => {
      const lid = el.id;
      if (lid) { const l = document.querySelector(\`label[for="\${lid}"]\`); if (l) return l.textContent.trim(); }
      return '';
    })();

    const out = [];

    // 1. aria-label (most reliable)
    if (ariaLabel) {
      out.push({
        badge: 'aria-label', desc: 'Exact match on aria-label attribute',
        xpath:  \`//\${tag}[@aria-label='\${esc(ariaLabel)}']\`,
        pw:     \`getByLabel('\${esc(ariaLabel)}')\`,
        yamlKey: ariaLabel,
      });
    }

    // 2. placeholder
    if (ph) {
      out.push({
        badge: 'placeholder', desc: 'Input placeholder text',
        xpath:  \`//input[@placeholder='\${esc(ph)}']\`,
        pw:     \`getByPlaceholder('\${esc(ph)}')\`,
        yamlKey: ph,
      });
    }

    // 3. label association
    if (labelTxt) {
      out.push({
        badge: 'label', desc: 'Associated <label> element text',
        xpath:  \`//*[@id=//label[normalize-space(.)='\${esc(labelTxt)}']/@for]\`,
        pw:     \`getByLabel('\${esc(labelTxt)}')\`,
        yamlKey: labelTxt,
      });
    }

    // 4. role + accessible name
    if (role && (ariaLabel || labelTxt || (text && text.length <= 60))) {
      const accName = ariaLabel || labelTxt || text;
      out.push({
        badge: 'role', desc: \`ARIA role "\${role}" with accessible name\`,
        xpath:  \`//*[@role='\${role}' and (@aria-label='\${esc(accName)}' or normalize-space(.)='\${esc(accName)}')]\`,
        pw:     \`getByRole('\${role}', { name: '\${esc(accName)}' })\`,
        yamlKey: accName || role,
      });
    }

    // 5. button / link by text
    if ((tag === 'button' || tag === 'a') && text && text.length <= 60) {
      out.push({
        badge: 'text', desc: \`\${tag} matched by visible text\`,
        xpath:  \`//\${tag}[normalize-space(.)='\${esc(text)}']\`,
        pw:     \`getByText('\${esc(text)}', { exact: true })\`,
        yamlKey: text,
      });
    }

    // 6. id
    if (id) {
      out.push({
        badge: 'id', desc: 'Element id attribute',
        xpath:  \`//*[@id='\${esc(id)}']\`,
        pw:     \`locator('#\${esc(id)}')\`,
        yamlKey: id,
      });
    }

    // 7. name attribute (forms)
    if (name && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
      out.push({
        badge: 'name', desc: 'Form field name attribute',
        xpath:  \`//\${tag}[@name='\${esc(name)}']\`,
        pw:     \`locator('\${tag}[name="\${esc(name)}"]')\`,
        yamlKey: name,
      });
    }

    // 8. data-testid
    const dtid = el.getAttribute('data-testid');
    if (dtid) {
      out.push({
        badge: 'testid', desc: 'data-testid attribute (most stable)',
        xpath:  \`//*[@data-testid='\${esc(dtid)}']\`,
        pw:     \`getByTestId('\${esc(dtid)}')\`,
        yamlKey: dtid,
      });
    }

    return out;
  }

  function updateHighlight(el) {
    if (el === hl || el === lbl || panel.contains(el)) return;
    const r = el.getBoundingClientRect();
    hl.style.cssText += \`; top:\${r.top}px; left:\${r.left}px; width:\${r.width}px; height:\${r.height}px\`;
    hl.style.display = 'block';
    const tag = el.tagName.toLowerCase();
    const role = inferRole(el);
    const label = getLabel(el);
    lbl.textContent = label ? \`<\${tag}> · \${label}\` : \`<\${tag}>\`;
    lbl.style.top  = Math.max(r.top - 22, 0) + 'px';
    lbl.style.left = r.left + 'px';
    lbl.style.display = 'block';
  }
  function hideHighlight() {
    hl.style.display = 'none';
    lbl.style.display = 'none';
  }

  function showPanel(el) {
    const tag  = el.tagName.toLowerCase();
    const attrs = [...el.attributes].filter(a => !['class','style'].includes(a.name));
    const locs = generateLocators(el);
    const bestLoc = locs[0];

    let attrHtml = '';
    for (const a of attrs) {
      attrHtml += \`<div class="__ccinsp_attr_key">\${a.name}</div><div class="__ccinsp_attr_val" title="\${a.value}">\${a.value || '(empty)'}</div>\`;
    }
    if (!attrHtml) attrHtml = '<div style="color:#585b70;grid-column:span 2">no attributes</div>';

    let locHtml = '';
    for (const loc of locs) {
      locHtml += \`
        <div class="__ccinsp_locator_row">
          <div class="__ccinsp_loc_header">
            <span class="__ccinsp_loc_badge">\${loc.badge}</span>
            <span class="__ccinsp_loc_desc">\${loc.desc}</span>
            <button class="__ccinsp_copy_btn" data-copy="\${loc.xpath.replace(/"/g,'&quot;')}">Copy XPath</button>
          </div>
          <div class="__ccinsp_loc_code">\${loc.xpath}</div>
        </div>
      \`;
    }
    if (!locHtml) locHtml = '<div style="color:#585b70;font-size:12px">No reliable locators found — inspect a more specific element.</div>';

    // Best YAML entry
    const yamlKey  = bestLoc ? bestLoc.yamlKey : getLabel(el) || tag;
    const yamlXpath = bestLoc ? bestLoc.xpath : \`//\${tag}\`;
    const yamlEntry = \`\${yamlKey}:\\n  - xpath\\n  - \${yamlXpath}\`;

    panel.innerHTML = \`
      <div class="__ccinsp_header">
        <h2>🔍 Element Inspector</h2>
        <button class="__ccinsp_close" id="__ccinsp_close_btn" title="Close (ESC)">×</button>
      </div>
      <div class="__ccinsp_body">
        <div class="__ccinsp_section">
          <h3>Element</h3>
          <span class="__ccinsp_tag">&lt;\${tag}&gt;</span>
          <div class="__ccinsp_attr_grid">\${attrHtml}</div>
        </div>
        <div class="__ccinsp_section">
          <h3>Suggested Locators</h3>
          \${locHtml}
        </div>
        <div class="__ccinsp_section">
          <h3>YAML Entry</h3>
          <div class="__ccinsp_yaml_box">
            <div class="__ccinsp_yaml_head">
              <span>Paste into your page locator YAML</span>
              <button class="__ccinsp_copy_btn" data-copy="\${yamlEntry.replace(/"/g,'&quot;')}">Copy YAML</button>
            </div>
            <pre class="__ccinsp_yaml_code">\${yamlEntry}</pre>
          </div>
        </div>
      </div>
      <div class="__ccinsp_footer">Click any element · ESC to close panel</div>
    \`;

    panel.classList.remove('hidden');

    // copy buttons
    panel.querySelectorAll('.__ccinsp_copy_btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = btn.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = '✓ Copied';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = btn.textContent.includes('YAML') ? 'Copy YAML' : 'Copy XPath'; btn.classList.remove('copied'); }, 1500);
        });
      });
    });

    document.getElementById('__ccinsp_close_btn').addEventListener('click', closePanel);
  }

  function closePanel() {
    panel.classList.add('hidden');
    locked = false;
  }

  /* ── Event listeners ─────────────────────────────────────────── */
  let locked = false;

  document.addEventListener('mouseover', (e) => {
    if (locked) return;
    if (e.target === hl || e.target === lbl || panel.contains(e.target)) return;
    updateHighlight(e.target);
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (locked) return;
    if (e.target === hl || e.target === lbl) return;
    hideHighlight();
  }, true);

  document.addEventListener('click', (e) => {
    if (panel.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    locked = true;
    updateHighlight(e.target);
    showPanel(e.target);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  console.log('[Inspector] Ready — click any element to inspect it.');
})();
`;

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctx  = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();

  // Re-inject the overlay on every navigation (SPA route changes, reloads, etc.)
  await ctx.addInitScript(OVERLAY_SCRIPT);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Also inject immediately for the first load
  await page.evaluate(OVERLAY_SCRIPT).catch(() => {});

  console.log('Inspector ready. Browser window is open.\n');
  console.log('When you are done, press Ctrl+C here to close.\n');

  // Keep alive until the user presses Ctrl+C
  await new Promise((resolve) => {
    process.on('SIGINT', resolve);
    page.on('close', resolve);
    ctx.on('close', resolve);
  });

  await browser.close().catch(() => {});
  console.log('\nInspector closed.');
})();
