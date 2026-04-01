/**
 * Local UI + API for "AI Fix".
 *
 * - Lists generated *.bundle.json files under test-results/ai-fix/
 * - Lets user enter "what changed"
 * - Calls local Ollama (default model: gpt-oss:20b-cloud)
 * - Can apply changes back to the referenced .feature and YAML locator files (with backups)
 *
 * Run:
 *   node scripts/ai-fix-ui.cjs
 * Then open:
 *   http://127.0.0.1:7077
 */
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AI_FIX_DIR = path.join(ROOT, 'test-results', 'ai-fix');

function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function text(res, code, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

function safeReadJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function listBundles() {
  if (!fs.existsSync(AI_FIX_DIR)) return [];
  const files = fs.readdirSync(AI_FIX_DIR).filter((f) => f.endsWith('.bundle.json'));
  const items = files
    .map((f) => {
      const p = path.join(AI_FIX_DIR, f);
      const st = fs.statSync(p);
      return { file: f, path: p, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return items.map((it) => {
    try {
      const b = safeReadJson(it.path);
      return {
        id: it.file,
        stamp: b.stamp,
        scenarioName: b.scenarioName,
        currentPageKey: b.currentPageKey,
        featurePath: b.featurePath,
        pageYamlPath: b.pageYamlPath,
        markdownPath: b.markdownPath,
        mtimeMs: it.mtimeMs,
      };
    } catch {
      return { id: it.file, broken: true, mtimeMs: it.mtimeMs };
    }
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

function baseUrl() {
  const raw = (process.env.OLLAMA_HOST || '').trim();
  return (raw ? raw : 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

function ollamaModel() {
  return (process.env.AI_FIX_OLLAMA_MODEL || '').trim() || 'gpt-oss:20b-cloud';
}

async function ollamaGenerate(prompt) {
  const res = await fetch(`${baseUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel(), prompt, stream: false }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Ollama error: ${res.status} ${res.statusText}\n${t}`.trim());
  }
  const data = await res.json();
  return String(data.response || '');
}

function between(text, startTag, endTag) {
  const s = text.indexOf(startTag);
  if (s < 0) return null;
  const e = text.indexOf(endTag, s + startTag.length);
  if (e < 0) return null;
  return text.slice(s + startTag.length, e).replace(/^\s*\n/, '').replace(/\n\s*$/, '') + '\n';
}

function backupAndWrite(targetPath, contents) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(targetPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = `${targetPath}.bak.${stamp}`;
    fs.copyFileSync(targetPath, bak);
  }
  fs.writeFileSync(targetPath, contents, 'utf8');
}

function buildPrompt(markdown, userProblem) {
  // Enforce the exact tags we parse for apply.
  return [
    'You are a senior test automation engineer.',
    'Update the failing Playwright+Cucumber test artifacts to match the CURRENT UI structure.',
    '',
    'User described change:',
    userProblem || '(none provided)',
    '',
    'Output format rules (MANDATORY):',
    '- Output MUST contain ONLY these XML-like sections, in this order:',
    '  1) <FEATURE_FILE> ... </FEATURE_FILE>',
    '  2) <PAGE_LOCATORS_YAML> ... </PAGE_LOCATORS_YAML> (include if page locators exist / are relevant)',
    '  3) <COMMON_LOCATORS_YAML> ... </COMMON_LOCATORS_YAML> (include only if needed)',
    '- No markdown fences. No extra commentary.',
    '',
    'Context bundle:',
    markdown,
  ].join('\n');
}

const INDEX_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Fix (Local)</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: #0b1020; color: #e7eaf0; }
      header { padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.03); }
      main { padding: 20px; display: grid; gap: 14px; max-width: 1100px; margin: 0 auto; }
      .row { display: grid; gap: 10px; }
      label { font-size: 12px; color: rgba(231,234,240,.8); }
      select, textarea, button, input { font: inherit; }
      select, textarea, input { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); color: #e7eaf0; }
      textarea { min-height: 110px; resize: vertical; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; }
      button { padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18); background: rgba(93, 135, 255, .2); color: #e7eaf0; cursor: pointer; }
      button.secondary { background: rgba(255,255,255,.06); }
      button.danger { background: rgba(255, 82, 82, .22); }
      pre { white-space: pre-wrap; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.10); padding: 12px; border-radius: 12px; overflow: auto; }
      .hint { font-size: 12px; color: rgba(231,234,240,.75); }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); margin-left: 8px; font-size: 12px; }
    </style>
  </head>
  <body>
    <header>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700">AI Fix (Local UI)</div>
          <div class="hint">Uses Ollama on this machine. Model: <span id="model" class="pill"></span></div>
        </div>
        <button class="secondary" id="refresh">Refresh bundles</button>
      </div>
    </header>
    <main>
      <div class="row">
        <label>Failed scenario bundle</label>
        <select id="bundle"></select>
        <div class="hint" id="bundleMeta"></div>
      </div>
      <div class="row">
        <label>What changed in the UI?</label>
        <textarea id="problem" placeholder="Example: The Submit button moved into the dialog footer and the label changed to 'Continue'"></textarea>
      </div>
      <div class="actions">
        <button id="generate">Generate fix (LLM)</button>
        <button id="apply" class="danger">Apply fix to files (backup first)</button>
      </div>
      <div class="row">
        <label>LLM output</label>
        <pre id="out">(nothing yet)</pre>
        <div class="hint">Apply expects tags: &lt;FEATURE_FILE&gt;, &lt;PAGE_LOCATORS_YAML&gt;, &lt;COMMON_LOCATORS_YAML&gt;</div>
      </div>
    </main>
    <script>
      const $ = (id) => document.getElementById(id);
      async function api(path, opts) {
        const r = await fetch(path, opts);
        const t = await r.text();
        if (!r.ok) throw new Error(t || (r.status + ' ' + r.statusText));
        return t ? JSON.parse(t) : null;
      }
      function fmtBundleLabel(b) {
        if (b.broken) return b.id + ' (broken)';
        const k = b.currentPageKey ? (' | screen: ' + b.currentPageKey) : '';
        return (b.scenarioName || b.id) + k;
      }
      async function load() {
        const cfg = await api('/api/config');
        $('model').textContent = cfg.model;
        const list = await api('/api/bundles');
        const sel = $('bundle');
        sel.innerHTML = '';
        for (const b of list) {
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = fmtBundleLabel(b);
          sel.appendChild(opt);
        }
        sel.onchange = () => showMeta(list.find(x => x.id === sel.value));
        showMeta(list[0]);
      }
      function showMeta(b) {
        if (!b) { $('bundleMeta').textContent = ''; return; }
        $('bundleMeta').textContent = b.broken ? 'Bundle JSON could not be read.' :
          ('Feature: ' + b.featurePath + ' | Page YAML: ' + (b.pageYamlPath || '(none)'));
      }
      $('refresh').onclick = load;
      $('generate').onclick = async () => {
        $('out').textContent = 'Generating...';
        const id = $('bundle').value;
        const userProblem = $('problem').value;
        const r = await api('/api/fix', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ id, userProblem }) });
        $('out').textContent = r.output || '(empty)';
      };
      $('apply').onclick = async () => {
        if (!confirm('Apply will overwrite files after creating .bak backups. Continue?')) return;
        const id = $('bundle').value;
        const userProblem = $('problem').value;
        const r = await api('/api/apply', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ id, userProblem }) });
        $('out').textContent = r.output || '(empty)';
        alert('Applied. Backups created next to edited files.');
      };
      load().catch(e => { $('out').textContent = String(e && e.message ? e.message : e); });
    </script>
  </body>
</html>`;

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  try {
    if (req.method === 'GET' && u.pathname === '/') {
      return text(res, 200, INDEX_HTML, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && u.pathname === '/api/config') {
      return json(res, 200, { model: ollamaModel(), ollamaHost: baseUrl(), aiFixDir: AI_FIX_DIR });
    }
    if (req.method === 'GET' && u.pathname === '/api/bundles') {
      return json(res, 200, listBundles());
    }
    if (req.method === 'POST' && (u.pathname === '/api/fix' || u.pathname === '/api/apply')) {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const id = String(body.id || '');
      const userProblem = String(body.userProblem || '');
      if (!id) return json(res, 400, { error: 'Missing id' });
      const bundlePath = path.join(AI_FIX_DIR, id);
      if (!bundlePath.startsWith(AI_FIX_DIR) || !fs.existsSync(bundlePath)) return json(res, 404, { error: 'Bundle not found' });
      const bundle = safeReadJson(bundlePath);
      const md = fs.readFileSync(bundle.markdownPath, 'utf8');
      const prompt = buildPrompt(md, userProblem);
      const output = await ollamaGenerate(prompt);

      // Save output next to bundle for traceability.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outPath = path.join(AI_FIX_DIR, `ui-${stamp}-${id}.llm.txt`);
      fs.writeFileSync(outPath, output, 'utf8');

      if (u.pathname === '/api/apply') {
        const feature = between(output, '<FEATURE_FILE>', '</FEATURE_FILE>');
        const pageYaml = between(output, '<PAGE_LOCATORS_YAML>', '</PAGE_LOCATORS_YAML>');
        const commonYaml = between(output, '<COMMON_LOCATORS_YAML>', '</COMMON_LOCATORS_YAML>');
        if (!feature) return json(res, 400, { error: 'LLM output missing <FEATURE_FILE> section', output });

        backupAndWrite(bundle.featurePath, feature);
        if (pageYaml && bundle.pageYamlPath) backupAndWrite(bundle.pageYamlPath, pageYaml);
        if (commonYaml && bundle.commonYamlPath) backupAndWrite(bundle.commonYamlPath, commonYaml);
      }

      return json(res, 200, { output, savedTo: outPath });
    }
    return text(res, 404, 'Not found');
  } catch (e) {
    return text(res, 500, String(e && e.stack ? e.stack : e));
  }
});

const host = env('AI_FIX_UI_HOST', '127.0.0.1');
const port = Number(env('AI_FIX_UI_PORT', '7077'));
server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`AI Fix UI running at http://${host}:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Ollama: ${baseUrl()} | Model: ${ollamaModel()}`);
});

