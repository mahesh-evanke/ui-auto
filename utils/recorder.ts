/**
 * Custom recorder: Chromium + injected capture script + Playwright-backed selector resolution.
 * Does not launch Playwright codegen or inspector UI.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { launchRecorderBrowser, shutdownBrowser } from './browser';
import { MARK_ATTR, resolveLocator, type ElementSnapshot } from './selectorEngine';
import { capitalizeWords, convertToArtifacts, type RecordedAction } from './converter';
import { attachApiCapture, type CapturedApi } from './capture';
import { generateApiStepsFromCapturedApis, generateFeatureFromCapturedApis } from './formatter';
import { ollamaGenerate, ollamaModel } from './ollamaClient';
import {
  generatePageKey,
  registerPage,
  resolvePageLocatorPath,
  resolvePagesYamlPath,
  writePageLocatorsYaml,
} from './pageRegistry';

const ROOT = path.resolve(__dirname, '..');
const AI_FIX_DIR = path.join(ROOT, 'test-results', 'ai-fix');

type AiFixBundleRow = {
  id: string;
  stamp?: string;
  scenarioName?: string;
  currentPageKey?: string | null;
  featurePath?: string;
  pageYamlPath?: string | null;
  commonYamlPath?: string | null;
  markdownPath?: string;
  mtimeMs?: number;
  broken?: boolean;
};

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function safeReadJsonFile<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

function listAiFixBundles(): AiFixBundleRow[] {
  try {
    if (!fs.existsSync(AI_FIX_DIR)) return [];
    const files = fs.readdirSync(AI_FIX_DIR).filter((f) => f.endsWith('.bundle.json'));
    const rows = files
      .map((f) => {
        const fp = path.join(AI_FIX_DIR, f);
        const st = fs.statSync(fp);
        return { id: f, path: fp, mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return rows.map((r) => {
      try {
        const b = safeReadJsonFile<any>(r.path);
        return {
          id: r.id,
          stamp: b.stamp,
          scenarioName: b.scenarioName,
          currentPageKey: b.currentPageKey ?? null,
          featurePath: b.featurePath,
          pageYamlPath: b.pageYamlPath ?? null,
          commonYamlPath: b.commonYamlPath ?? null,
          markdownPath: b.markdownPath,
          mtimeMs: r.mtimeMs,
        } satisfies AiFixBundleRow;
      } catch {
        return { id: r.id, broken: true, mtimeMs: r.mtimeMs } satisfies AiFixBundleRow;
      }
    });
  } catch {
    return [];
  }
}

function betweenTags(text: string, startTag: string, endTag: string): string | null {
  const s = text.indexOf(startTag);
  if (s < 0) return null;
  const e = text.indexOf(endTag, s + startTag.length);
  if (e < 0) return null;
  return text
    .slice(s + startTag.length, e)
    .replace(/^\s*\n/, '')
    .replace(/\n\s*$/, '') + '\n';
}

function backupAndWriteFile(targetPath: string, contents: string): void {
  ensureDir(path.dirname(targetPath));
  if (fs.existsSync(targetPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(targetPath, `${targetPath}.bak.${stamp}`);
  }
  fs.writeFileSync(targetPath, contents, 'utf8');
}

function buildAiFixUiPrompt(markdown: string, userProblem: string): string {
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

type UploadedFile = { key: string; name: string; content: string };

function parseFeatureForUrlAndScreen(featureText: string): { url?: string; screen?: string } {
  const text = String(featureText || '');
  const urlMatch = text.match(/User navigates to\s+"([^"]+)"\s+URL/i);
  const screenMatch = text.match(/User is on\s+"([^"]+)"\s+screen/i);
  return { url: urlMatch?.[1], screen: screenMatch?.[1] };
}

function collectQuotedElementNames(featureText: string): string[] {
  // For steps like: clicks on "X" link, User clicks on "X" button, enters "t" text in "X" textbox
  const names: string[] = [];
  const re = /"(.*?)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(featureText || '')))) {
    const v = String(m[1] || '').trim();
    if (!v) continue;
    // ignore obvious URLs
    if (/^https?:\/\//i.test(v)) continue;
    names.push(v);
  }
  // de-dupe keep order
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseLocatorYaml(content: string): Record<string, [string, string]> {
  const doc = yaml.load(String(content || '')) as unknown;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {};
  const out: Record<string, [string, string]> = {};
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length >= 2) out[String(k)] = [String(v[0]), String(v[1])];
  }
  return out;
}

function locatorFromTuple(tuple: [string, string]): { kind: string; expr: string; selectorText: string } {
  const kind = String(tuple?.[0] || '').toLowerCase();
  const expr = String(tuple?.[1] || '');
  if (kind === 'xpath') return { kind, expr, selectorText: `xpath=${expr}` };
  return { kind: 'css', expr, selectorText: expr };
}

type ReportPayload = {
  type: string;
  markId: string;
  snapshot: ElementSnapshot;
  href: string;
  extra?: { value?: string };
};

type HoverPreviewPayload = {
  markId: string;
  snapshot: ElementSnapshot;
};

type HoverPreviewResponse = {
  role: string;
  name: string;
  locator: string;
  fallback: string;
};

type QuickAssertPayload = {
  kind: 'text' | 'web_table';
  /** Selected/global text for text assertions */
  text?: string;
  /** Table logical name/id for web table assertions */
  objName?: string;
  /** Page locator for the &lt;table&gt; (xpath tuple); written to page YAML on generate */
  locator?: [string, string];
  /** Structured table verification config (headers + rows) */
  tableConfig?: {
    tableName?: string;
    headers?: string[];
    rows?: string[][];
    selectedColumns?: number[];
    selectedRows?: number[];
    /** Full matrix: row 0 = header cells, rest = data (same as Gherkin DataTable) */
    data?: string[][];
  };
  href?: string;
};

type InspectorObjectRow = {
  element: string;
  locator: [string, string];
};

function getInjectScript(resetOnStart: boolean): string {
  return `
(() => {
  if (window.__PW_CUSTOM_RECORDER_INSTALLED__) return;
  window.__PW_CUSTOM_RECORDER_INSTALLED__ = true;

  const MARK = ${JSON.stringify(MARK_ATTR)};
  const RESET_ON_START = ${JSON.stringify(resetOnStart)};

  let isRecording = false;
  let isGenerating = false;
  let captureMode = 'UI+API';
  let isInspectorOpen = false;
  let isObjectInspectorOpen = false;
  let inspectorDirty = false;
  let generatedFeatureContent = '';
  const NO_STEPS_TEXT = 'No steps recorded yet...';
  let suppressInspectorInput = false;
  let fileName = 'recordedflow';
  let currentHoverEl = null;
  let hoverReqSeq = 0;
  let hoverTooltipText = '';
  let pwRecSuppressTableClickOnce = false;
  let pwRecTableModalCleanup = null;

  function cleanupWebTableModalInteraction() {
    try {
      if (typeof pwRecTableModalCleanup === 'function') pwRecTableModalCleanup();
    } catch (e) {}
    pwRecTableModalCleanup = null;
    window.__pw_rec_activeTableEl = null;
    try {
      delete window.__pwRecTableCellToggle;
    } catch (e) {
      window.__pwRecTableCellToggle = null;
    }
    pwRecSuppressTableClickOnce = false;
  }

  function sanitizeFileName(raw) {
    const v = String(raw || '').trim();
    if (!v) return 'recordedflow';
    const key = v.replace(/\\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    return key || 'recordedflow';
  }

  function uid() {
    return 'pw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function cleanText(s) {
    return String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  }

  function findAssociatedLabel(el) {
    try {
      const id = el && el.id ? String(el.id) : '';
      if (id) {
        const labels = Array.prototype.slice.call(document.querySelectorAll('label'));
        const found = labels.find((l) => String(l.htmlFor || '') === id);
        if (found) return cleanText(found.textContent || '');
      }
      if (el && el.closest) {
        const closest = el.closest('label');
        if (closest) return cleanText(closest.textContent || '');
      }
    } catch (e) {}
    return '';
  }

  function snap(el) {
    if (!el || el.nodeType !== 1) return {};
    const tagName = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();

    let text = cleanText(el.innerText || el.textContent || '');
    if (tagName === 'input' && (type === 'button' || type === 'submit')) {
      text = cleanText(el.value || '');
    }

    if (tagName === 'select') {
      const opt = el.options[el.selectedIndex];
      return {
        tagName: 'select',
        type: 'select',
        id: el.id || '',
        name: el.name || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        label: findAssociatedLabel(el),
        text: text,
        role: el.getAttribute('role') || '',
        value: el.value || '',
        selectedLabel: opt ? cleanText(opt.text || '') : '',
      };
    }

    return {
      tagName,
      type: type || '',
      id: el.id || '',
      name: el.name || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      label: findAssociatedLabel(el),
      text: text,
      href: tagName === 'a' ? (el.getAttribute('href') || '') : '',
      role: el.getAttribute('role') || '',
      value: (el.value || ''),
    };
  }

  function updateToggleUi(toggleBtn) {
    toggleBtn.disabled = isGenerating;
    toggleBtn.style.opacity = toggleBtn.disabled ? '0.55' : '1';
    if (isRecording) {
      toggleBtn.title = 'Stop Recording';
      toggleBtn.textContent = '';
      toggleBtn.style.background = '#dc2626';
      toggleBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none">' +
        '<rect x="6.5" y="5" width="3.2" height="14" rx="1.1" fill="currentColor"></rect>' +
        '<rect x="14.3" y="5" width="3.2" height="14" rx="1.1" fill="currentColor"></rect>' +
        '</svg>';
    } else {
      toggleBtn.title = 'Start Recording';
      toggleBtn.textContent = '';
      toggleBtn.style.background = '#16a34a';
      toggleBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none">' +
        '<polygon points="9 18 15 12 9 6 9 18" fill="currentColor"></polygon>' +
        '</svg>';
    }
  }

  function mountUi() {
    if (document.getElementById('pw-recorder-ui-root')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'pw-recorder-ui-root';
    document.body.appendChild(wrapper);

    const root = document.createElement('div');
    root.id = '__pw_recorder_ui__';
    root.setAttribute('style', [
      'position:fixed',
      'top:16px',
      'right:16px',
      'z-index:2147483647',
      'font-family:system-ui,Segoe UI,Roboto,sans-serif',
      'background:rgba(2,6,23,0.55)',
      'border:1px solid rgba(148,163,184,0.35)',
      'padding:8px',
      'border-radius:14px',
      'box-shadow:0 10px 30px rgba(0,0,0,0.25)',
      'display:flex',
      'flex-direction:row',
      'gap:8px',
      'align-items:center',
    ].join(';'));

    const fileInput = document.createElement('input');
    fileInput.type = 'text';
    fileInput.id = '__pw_rec_filename__';
    fileInput.value = fileName;
    fileInput.placeholder = 'Enter file name...';
    fileInput.setAttribute(
      'style',
      [
        'width:170px',
        'padding:8px 10px',
        'border-radius:10px',
        'border:1px solid rgba(148,163,184,0.35)',
        'background:rgba(15,23,42,0.35)',
        'color:#e5e7eb',
        'outline:none',
        'font-size:12px',
      ].join(';'),
    );
    fileInput.addEventListener('blur', () => {
      fileName = sanitizeFileName(fileInput.value);
      fileInput.value = fileName;
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.id = '__pw_rec_btn_toggle__';
    toggleBtn.textContent = '';
    toggleBtn.setAttribute('style', [
      'padding:8px 10px',
      'border-radius:10px',
      'border:0',
      'cursor:pointer',
      'font-weight:700',
      'font-size:12px',
      'color:#fff',
      'background:#dc2626',
    ].join(';'));
    toggleBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none">' +
      '<rect x="6.5" y="5" width="3.2" height="14" rx="1.1" fill="currentColor"></rect>' +
      '<rect x="14.3" y="5" width="3.2" height="14" rx="1.1" fill="currentColor"></rect>' +
      '</svg>';

    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.id = '__pw_rec_btn_gen__';
    genBtn.textContent = '⚡ Generate';
    genBtn.setAttribute('style', [
      'padding:8px 10px',
      'border-radius:10px',
      'border:0',
      'cursor:pointer',
      'font-weight:700',
      'font-size:12px',
      'color:#fff',
      'background:linear-gradient(135deg,#2563eb,#7c3aed)',
      'box-shadow:0 8px 24px rgba(37,99,235,0.35)',
    ].join(';'));

    toggleBtn.addEventListener('click', () => {
      if (isGenerating) return;
      if (isRecording) {
        isRecording = false;
        updateToggleUi(toggleBtn);
        if (window.pwRecorderSetRecording) window.pwRecorderSetRecording(false, false).catch(() => {});
      } else {
        isRecording = true;
        inspectorDirty = false;
        updateToggleUi(toggleBtn);
        if (window.pwRecorderSetRecording) window.pwRecorderSetRecording(true, RESET_ON_START).catch(() => {});
      }
    });

    genBtn.addEventListener('click', async () => {
      if (isGenerating) return;
      isGenerating = true;
      isRecording = false;
      updateToggleUi(toggleBtn);
      try {
        const fileInputEl = document.getElementById('__pw_rec_filename__');
        const rawName = fileInputEl && typeof fileInputEl.value === 'string' ? fileInputEl.value : '';
        fileName = sanitizeFileName(rawName);
        if (fileInputEl && typeof fileInputEl.value === 'string') fileInputEl.value = fileName;

        const editorEl = document.getElementById('__pw_rec_feature_editor__');
        const featureText = editorEl && typeof editorEl.value === 'string' ? editorEl.value : '';
        const useEdited = inspectorDirty;
        inspectorDirty = false;
        if (window.pwRecorderGenerate) await window.pwRecorderGenerate({ featureText, useEdited, fileName });
      } catch (err) {
        console.error(err);
        alert('Generate failed — see console');
      } finally {
        isGenerating = false;
        updateToggleUi(toggleBtn);
      }
    });

    root.appendChild(fileInput);

    const barRow = document.createElement('div');
    barRow.setAttribute('style', ['display:flex', 'gap:8px', 'align-items:center', 'justify-content:flex-end'].join(';'));
    let captureSelect = document.createElement('select');
    captureSelect.id = '__pw_rec_capture_mode__';
    captureSelect.setAttribute(
      'style',
      [
        'padding:8px 10px',
        'border-radius:10px',
        'border:1px solid rgba(148,163,184,0.35)',
        'background:rgba(15,23,42,0.35)',
        'color:#e5e7eb',
        'outline:none',
        'font-size:12px',
        'font-weight:700',
      ].join(';'),
    );
    const captureOptions = ['UI', 'API', 'UI+API'];
    for (const opt of captureOptions) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === captureMode) o.selected = true;
      captureSelect.appendChild(o);
    }
    captureSelect.addEventListener('change', () => {
      captureMode = String(captureSelect.value || '').trim().toUpperCase();
      if (window.pwRecorderSetCaptureSelection) window.pwRecorderSetCaptureSelection(captureMode).catch(() => {});
      if (isInspectorOpen) (async () => { try { await renderApiInline(); } catch {} })();
    });
    barRow.appendChild(captureSelect);
    barRow.appendChild(toggleBtn);
    barRow.appendChild(genBtn);
    root.appendChild(barRow);

    const inspectorBtn = document.createElement('button');
    inspectorBtn.type = 'button';
    inspectorBtn.id = '__pw_rec_btn_inspector__';
    inspectorBtn.textContent = '🔍 preview';
    inspectorBtn.setAttribute(
      'style',
      [
        'padding:8px 10px',
        'border-radius:10px',
        'border:0',
        'cursor:pointer',
        'font-weight:700',
        'font-size:12px',
        'color:#fff',
        'background:rgba(37,99,235,0.95)',
        'box-shadow:0 8px 24px rgba(37,99,235,0.25)',
      ].join(';'),
    );
    barRow.appendChild(inspectorBtn);

    const objectInspectorBtn = document.createElement('button');
    objectInspectorBtn.type = 'button';
    objectInspectorBtn.id = '__pw_rec_btn_object_inspector__';
    objectInspectorBtn.textContent = 'Inspector';
    objectInspectorBtn.setAttribute(
      'style',
      [
        'padding:8px 10px',
        'border-radius:10px',
        'border:0',
        'cursor:pointer',
        'font-weight:700',
        'font-size:12px',
        'color:#fff',
        'background:rgba(2,132,199,0.95)',
        'box-shadow:0 8px 24px rgba(2,132,199,0.25)',
      ].join(';'),
    );
    barRow.appendChild(objectInspectorBtn);

    const aiFixBtn = document.createElement('button');
    aiFixBtn.type = 'button';
    aiFixBtn.id = '__pw_rec_btn_ai_fix__';
    aiFixBtn.textContent = 'AI Fix';
    aiFixBtn.setAttribute(
      'style',
      [
        'padding:8px 10px',
        'border-radius:10px',
        'border:0',
        'cursor:pointer',
        'font-weight:800',
        'font-size:12px',
        'color:#fff',
        'background:rgba(139,92,246,0.95)',
        'box-shadow:0 8px 24px rgba(139,92,246,0.22)',
      ].join(';'),
    );
    barRow.appendChild(aiFixBtn);
    wrapper.appendChild(root);

    // AI Fix panel (local Ollama)
    const aiPanel = document.createElement('div');
    aiPanel.id = '__pw_ai_fix_panel__';
    aiPanel.setAttribute(
      'style',
      [
        'position:fixed',
        'top:8px',
        'left:8px',
        'width:520px',
        'height:78vh',
        'max-height:calc(100vh - 16px)',
        'z-index:2147483647',
        'background:rgba(2,6,23,0.92)',
        'border:1px solid rgba(148,163,184,0.35)',
        'border-radius:14px',
        'box-sizing:border-box',
        'padding:12px',
        'overflow:auto',
        'display:none',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif',
        'resize:both',
        'min-width:360px',
        'min-height:280px',
      ].join(';'),
    );

    const aiHeader = document.createElement('div');
    aiHeader.setAttribute('style', ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:10px'].join(';'));
    const aiTitle = document.createElement('div');
    aiTitle.textContent = 'AI Fix — feature + locators';
    aiTitle.setAttribute('style', ['font-weight:900', 'font-size:12px', 'color:#e5e7eb'].join(';'));
    const aiClose = document.createElement('button');
    aiClose.type = 'button';
    aiClose.textContent = 'Close';
    aiClose.setAttribute(
      'style',
      ['border:0', 'border-radius:10px', 'padding:6px 10px', 'cursor:pointer', 'font-weight:800', 'font-size:12px', 'color:#cbd5e1', 'background:rgba(148,163,184,0.15)'].join(';'),
    );
    aiClose.addEventListener('click', () => { aiPanel.style.display = 'none'; });
    aiHeader.appendChild(aiTitle);
    aiHeader.appendChild(aiClose);
    aiPanel.appendChild(aiHeader);

    const aiMeta = document.createElement('div');
    aiMeta.id = '__pw_ai_fix_meta__';
    aiMeta.setAttribute('style', ['margin-top:6px', 'font-size:11px', 'color:#94a3b8'].join(';'));
    aiMeta.textContent = 'Uses local Ollama. Ensure it is running (ollama serve).';
    aiPanel.appendChild(aiMeta);

    const aiSelectLabel = document.createElement('div');
    aiSelectLabel.textContent = 'Failed scenario bundle';
    aiSelectLabel.setAttribute('style', ['margin-top:12px', 'font-weight:900', 'font-size:12px', 'color:#e5e7eb'].join(';'));
    aiPanel.appendChild(aiSelectLabel);

    const aiSelect = document.createElement('select');
    aiSelect.id = '__pw_ai_fix_bundle__';
    aiSelect.setAttribute(
      'style',
      [
        'margin-top:6px',
        'width:100%',
        'padding:10px 12px',
        'border-radius:12px',
        'border:1px solid rgba(148,163,184,0.25)',
        'background:rgba(15,23,42,0.35)',
        'color:#e5e7eb',
        'outline:none',
        'font-size:12px',
        'font-weight:800',
      ].join(';'),
    );
    aiPanel.appendChild(aiSelect);

    const aiUploadLabel = document.createElement('div');
    aiUploadLabel.textContent = 'Or upload files (feature + locator YAML)';
    aiUploadLabel.setAttribute('style', ['margin-top:12px', 'font-weight:900', 'font-size:12px', 'color:#e5e7eb'].join(';'));
    aiPanel.appendChild(aiUploadLabel);

    const aiUploadHint = document.createElement('div');
    aiUploadHint.textContent =
      'Tip: to select multiple files in the file picker, hold Ctrl (or Shift). You can also drag & drop multiple files below. Upload is best when you want to fix specific files (no bundle needed).';
    aiUploadHint.setAttribute('style', ['margin-top:6px', 'font-size:11px', 'color:#94a3b8'].join(';'));
    aiPanel.appendChild(aiUploadHint);

    const aiDrop = document.createElement('div');
    aiDrop.id = '__pw_ai_fix_drop__';
    aiDrop.textContent = 'Drop .feature / .yaml files here';
    aiDrop.setAttribute(
      'style',
      [
        'margin-top:10px',
        'padding:12px',
        'border-radius:12px',
        'border:1px dashed rgba(148,163,184,0.35)',
        'background:rgba(15,23,42,0.18)',
        'color:#cbd5e1',
        'font-size:12px',
        'font-weight:800',
        'text-align:center',
        'user-select:none',
      ].join(';'),
    );
    aiPanel.appendChild(aiDrop);

    const aiUpload = document.createElement('input');
    aiUpload.type = 'file';
    aiUpload.multiple = true;
    aiUpload.id = '__pw_ai_fix_upload__';
    aiUpload.accept = '.feature,.yaml,.yml,text/plain';
    aiUpload.setAttribute(
      'style',
      [
        'margin-top:8px',
        'width:100%',
        'padding:10px 12px',
        'border-radius:12px',
        'border:1px solid rgba(148,163,184,0.25)',
        'background:rgba(15,23,42,0.15)',
        'color:#e5e7eb',
        'outline:none',
        'font-size:12px',
        'font-weight:800',
        'box-sizing:border-box',
      ].join(';'),
    );
    aiPanel.appendChild(aiUpload);

    const aiUploadMeta = document.createElement('div');
    aiUploadMeta.id = '__pw_ai_fix_upload_meta__';
    aiUploadMeta.setAttribute('style', ['margin-top:6px', 'font-size:11px', 'color:#94a3b8'].join(';'));
    aiUploadMeta.textContent = 'No files uploaded.';
    aiPanel.appendChild(aiUploadMeta);

    const aiUploadList = document.createElement('div');
    aiUploadList.id = '__pw_ai_fix_upload_list__';
    aiUploadList.setAttribute(
      'style',
      [
        'margin-top:8px',
        'display:flex',
        'flex-direction:column',
        'gap:6px',
        'max-height:140px',
        'overflow:auto',
        'padding:8px',
        'border-radius:12px',
        'border:1px solid rgba(148,163,184,0.12)',
        'background:rgba(15,23,42,0.16)',
      ].join(';'),
    );
    aiPanel.appendChild(aiUploadList);

    const aiUploadActions = document.createElement('div');
    aiUploadActions.setAttribute('style', ['margin-top:8px', 'display:flex', 'gap:10px', 'flex-wrap:wrap'].join(';'));
    const aiClearUploads = document.createElement('button');
    aiClearUploads.type = 'button';
    aiClearUploads.textContent = 'Clear uploaded files';
    aiClearUploads.setAttribute(
      'style',
      ['border:0','border-radius:10px','padding:8px 12px','cursor:pointer','font-weight:900','font-size:12px','color:#e5e7eb','background:rgba(148,163,184,0.12)','border:1px solid rgba(148,163,184,0.18)'].join(';'),
    );
    aiUploadActions.appendChild(aiClearUploads);
    aiPanel.appendChild(aiUploadActions);

    const aiProblemLabel = document.createElement('div');
    aiProblemLabel.textContent = 'What changed in the UI?';
    aiProblemLabel.setAttribute('style', ['margin-top:12px', 'font-weight:900', 'font-size:12px', 'color:#e5e7eb'].join(';'));
    aiPanel.appendChild(aiProblemLabel);

    const aiProblem = document.createElement('textarea');
    aiProblem.id = '__pw_ai_fix_problem__';
    aiProblem.placeholder = 'Example: Submit button moved into dialog footer and label changed to Continue';
    aiProblem.setAttribute(
      'style',
      [
        'margin-top:6px',
        'width:100%',
        'min-height:80px',
        'resize:vertical',
        'padding:10px 12px',
        'border-radius:12px',
        'border:1px solid rgba(148,163,184,0.25)',
        'background:rgba(15,23,42,0.35)',
        'color:#e5e7eb',
        'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
        'font-size:11px',
        'line-height:1.35',
        'box-sizing:border-box',
      ].join(';'),
    );
    aiPanel.appendChild(aiProblem);

    const aiActions = document.createElement('div');
    aiActions.setAttribute('style', ['margin-top:10px', 'display:flex', 'gap:10px', 'flex-wrap:wrap'].join(';'));
    const aiGen = document.createElement('button');
    aiGen.type = 'button';
    aiGen.textContent = 'Generate fix';
    aiGen.setAttribute('style', ['border:0','border-radius:10px','padding:8px 12px','cursor:pointer','font-weight:900','font-size:12px','color:#fff','background:rgba(139,92,246,0.85)'].join(';'));
    const aiDiagnose = document.createElement('button');
    aiDiagnose.type = 'button';
    aiDiagnose.textContent = 'Diagnose with browser';
    aiDiagnose.setAttribute('style', ['border:0','border-radius:10px','padding:8px 12px','cursor:pointer','font-weight:900','font-size:12px','color:#fff','background:rgba(2,132,199,0.85)'].join(';'));
    const aiDownload = document.createElement('button');
    aiDownload.type = 'button';
    aiDownload.textContent = 'Download fixed files';
    aiDownload.setAttribute('style', ['border:0','border-radius:10px','padding:8px 12px','cursor:pointer','font-weight:900','font-size:12px','color:#fff','background:rgba(15,23,42,0.65)','border:1px solid rgba(148,163,184,0.25)'].join(';'));
    const aiApply = document.createElement('button');
    aiApply.type = 'button';
    aiApply.textContent = 'Apply (backup first)';
    aiApply.setAttribute('style', ['border:0','border-radius:10px','padding:8px 12px','cursor:pointer','font-weight:900','font-size:12px','color:#fff','background:rgba(239,68,68,0.80)'].join(';'));
    aiActions.appendChild(aiGen);
    aiActions.appendChild(aiDiagnose);
    aiActions.appendChild(aiDownload);
    aiActions.appendChild(aiApply);
    aiPanel.appendChild(aiActions);

    const aiOutLabel = document.createElement('div');
    aiOutLabel.textContent = 'LLM output';
    aiOutLabel.setAttribute('style', ['margin-top:12px', 'font-weight:900', 'font-size:12px', 'color:#e5e7eb'].join(';'));
    aiPanel.appendChild(aiOutLabel);

    const aiOut = document.createElement('pre');
    aiOut.id = '__pw_ai_fix_output__';
    aiOut.textContent = '(nothing yet)';
    aiOut.setAttribute(
      'style',
      [
        'margin-top:6px',
        'white-space:pre-wrap',
        'padding:10px 12px',
        'border-radius:12px',
        'border:1px solid rgba(148,163,184,0.15)',
        'background:rgba(15,23,42,0.22)',
        'color:#e5e7eb',
        'max-height:260px',
        'overflow:auto',
        'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
        'font-size:11px',
        'line-height:1.35',
      ].join(';'),
    );
    aiPanel.appendChild(aiOut);
    wrapper.appendChild(aiPanel);

    let uploadedFiles = [];
    let lastLlmOutput = '';
    const fileKey = (f) =>
      String(f.name || 'file') + '|' + String(f.size || 0) + '|' + String(f.lastModified || 0);

    const renderUploadList = () => {
      aiUploadList.innerHTML = '';
      if (!uploadedFiles.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No uploaded files yet.';
        empty.setAttribute('style', ['font-size:11px', 'color:#94a3b8'].join(';'));
        aiUploadList.appendChild(empty);
        return;
      }

      for (const f of uploadedFiles) {
        const row = document.createElement('div');
        row.setAttribute('style', ['display:flex','align-items:center','justify-content:space-between','gap:10px'].join(';'));

        const name = document.createElement('div');
        name.textContent = String(f.name);
        name.setAttribute('style', ['font-size:11px', 'color:#e5e7eb', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap'].join(';'));

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.textContent = 'Remove';
        rm.setAttribute(
          'style',
          ['border:0','border-radius:10px','padding:6px 10px','cursor:pointer','font-weight:900','font-size:11px','color:#fff','background:rgba(239,68,68,0.70)'].join(';'),
        );
        rm.addEventListener('click', () => {
          uploadedFiles = uploadedFiles.filter((x) => x.key !== f.key);
          updateUploadMeta();
          renderUploadList();
        });

        row.appendChild(name);
        row.appendChild(rm);
        aiUploadList.appendChild(row);
      }
    };

    const updateUploadMeta = () => {
      aiUploadMeta.textContent = uploadedFiles.length
        ? 'Uploaded (' + String(uploadedFiles.length) + '): ' + uploadedFiles.map((f) => String(f.name)).join(', ')
        : 'No files uploaded.';
      if (uploadedFiles.length <= 1) {
        aiUploadMeta.textContent += ' (add more with Ctrl/Shift, or drag & drop, or pick again from another folder)';
      }
    };

    const readFileAsText = (file) =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error('Failed to read file'));
        r.onload = () => resolve(String(r.result || ''));
        r.readAsText(file);
      });

    const addUploadedFiles = async (files) => {
      try {
        for (const f of files) {
          const key = fileKey(f);
          if (uploadedFiles.some((x) => x.key === key)) continue;
          const content = await readFileAsText(f);
          uploadedFiles.push({ key, name: String(f.name || 'file'), content });
        }
        updateUploadMeta();
        renderUploadList();
      } catch (e) {
        aiUploadMeta.textContent = 'Upload read failed.';
        aiOut.textContent = String(e && e.message ? e.message : e);
      }
    };

    aiUpload.addEventListener('change', async () => {
      const files = aiUpload.files ? Array.from(aiUpload.files) : [];
      await addUploadedFiles(files);
      // Important: allows selecting more files from another folder without clearing previous list.
      aiUpload.value = '';
    });

    const isAllowedUpload = (name) => {
      const n = String(name || '').toLowerCase();
      return n.endsWith('.feature') || n.endsWith('.yaml') || n.endsWith('.yml') || n.endsWith('.txt');
    };

    const setDropActive = (active) => {
      aiDrop.style.borderColor = active ? 'rgba(139,92,246,0.95)' : 'rgba(148,163,184,0.35)';
      aiDrop.style.background = active ? 'rgba(139,92,246,0.10)' : 'rgba(15,23,42,0.18)';
    };

    aiDrop.addEventListener('dragenter', (e) => { e.preventDefault(); setDropActive(true); });
    aiDrop.addEventListener('dragover', (e) => { e.preventDefault(); setDropActive(true); });
    aiDrop.addEventListener('dragleave', (e) => { e.preventDefault(); setDropActive(false); });
    aiDrop.addEventListener('drop', async (e) => {
      e.preventDefault();
      setDropActive(false);
      const dt = e.dataTransfer;
      const files = dt && dt.files ? Array.from(dt.files).filter((f) => isAllowedUpload(f.name)) : [];
      await addUploadedFiles(files);
    });

    aiClearUploads.addEventListener('click', () => {
      uploadedFiles = [];
      lastLlmOutput = '';
      updateUploadMeta();
      renderUploadList();
      aiOut.textContent = '(ready)';
    });

    // Initialize list UI
    updateUploadMeta();
    renderUploadList();

    const loadBundles = async () => {
      try {
        const bundles = window.pwRecorderAiFixListBundles ? await window.pwRecorderAiFixListBundles() : [];
        aiSelect.innerHTML = '';
        for (const b of bundles) {
          const o = document.createElement('option');
          o.value = b.id;
          const k = b.currentPageKey ? ' | screen: ' + String(b.currentPageKey) : '';
          o.textContent = (b.scenarioName || b.id) + k;
          aiSelect.appendChild(o);
        }
        if (!bundles.length) {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = 'No failed bundles yet (run cucumber with AI_FIX_ENABLED=true)';
          aiSelect.appendChild(o);
        }
      } catch (e) {
        aiOut.textContent = String(e && e.message ? e.message : e);
      }
    };

    aiFixBtn.addEventListener('click', async () => {
      aiPanel.style.display = 'block';
      aiOut.textContent = '(loading...)';
      await loadBundles();
      aiOut.textContent = '(ready)';
    });

    aiGen.addEventListener('click', async () => {
      aiOut.textContent = 'Generating...';
      try {
        let r = null;
        if (uploadedFiles && uploadedFiles.length) {
          r = window.pwRecorderAiFixGenerateFromUpload
            ? await window.pwRecorderAiFixGenerateFromUpload({ userProblem: String(aiProblem.value || ''), files: uploadedFiles })
            : null;
        } else {
          const id = String(aiSelect.value || '');
          if (!id) {
            aiOut.textContent = 'Select a failed bundle or upload files first.';
            return;
          }
          r = window.pwRecorderAiFixGenerate ? await window.pwRecorderAiFixGenerate({ id, userProblem: String(aiProblem.value || '') }) : null;
        }
        lastLlmOutput = r && r.output ? String(r.output) : '';
        aiOut.textContent = lastLlmOutput || '(empty)';
      } catch (e) {
        aiOut.textContent = String(e && e.message ? e.message : e);
      }
    });

    aiDiagnose.addEventListener('click', async () => {
      aiOut.textContent = 'Diagnosing in browser...';
      try {
        if (!uploadedFiles || !uploadedFiles.length) {
          aiOut.textContent = 'Upload a .feature (and optionally YAML locators) first.';
          return;
        }
        const r = window.pwRecorderAiFixDiagnoseFromUpload
          ? await window.pwRecorderAiFixDiagnoseFromUpload({ userProblem: String(aiProblem.value || ''), files: uploadedFiles })
          : null;
        lastLlmOutput = r && r.output ? String(r.output) : '';
        aiOut.textContent = lastLlmOutput || '(empty)';
      } catch (e) {
        aiOut.textContent = String(e && e.message ? e.message : e);
      }
    });

    const extract = (txt, a, b) => {
      const s = txt.indexOf(a);
      if (s < 0) return null;
      const e = txt.indexOf(b, s + a.length);
      if (e < 0) return null;
      return txt.slice(s + a.length, e).replace(/^\\s*\\n/, '').replace(/\\n\\s*$/, '') + '\\n';
    };

    const downloadText = (filename, content) => {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    };

    aiDownload.addEventListener('click', () => {
      if (!lastLlmOutput) {
        aiOut.textContent = 'Generate a fix first.';
        return;
      }
      const feature = extract(lastLlmOutput, '<FEATURE_FILE>', '</FEATURE_FILE>');
      const pageYaml = extract(lastLlmOutput, '<PAGE_LOCATORS_YAML>', '</PAGE_LOCATORS_YAML>');
      const commonYaml = extract(lastLlmOutput, '<COMMON_LOCATORS_YAML>', '</COMMON_LOCATORS_YAML>');

      const pickByExt = (ext) => {
        const f = (uploadedFiles || []).find((x) => String(x.name || '').toLowerCase().endsWith(ext));
        return f ? String(f.name) : '';
      };
      const featureName = pickByExt('.feature') || 'fixed.feature';
      const pageYamlName = pickByExt('.yaml') || pickByExt('.yml') || 'fixed.locators.yaml';

      if (feature) downloadText(featureName, feature);
      if (pageYaml) downloadText('fixed-' + pageYamlName, pageYaml);
      if (commonYaml) downloadText('fixed-common.yaml', commonYaml);
    });

    aiApply.addEventListener('click', async () => {
      if (uploadedFiles && uploadedFiles.length) {
        aiOut.textContent = 'Apply is disabled for uploaded files. Use Download fixed files, then replace in your repo.';
        return;
      }
      const id = String(aiSelect.value || '');
      if (!id) return;
      if (!confirm('This will overwrite files after creating .bak backups. Continue?')) return;
      aiOut.textContent = 'Applying...';
      try {
        const r = window.pwRecorderAiFixApply ? await window.pwRecorderAiFixApply({ id, userProblem: String(aiProblem.value || '') }) : null;
        lastLlmOutput = r && r.output ? String(r.output) : '';
        aiOut.textContent = lastLlmOutput || '(empty)';
        alert('Applied. Backups created next to edited files.');
      } catch (e) {
        aiOut.textContent = String(e && e.message ? e.message : e);
      }
    });

    const panel = document.createElement('div');
    panel.id = '__pw_rec_inspector_panel__';
    panel.setAttribute(
      'style',
      [
        'position:fixed',
        'top:8px',
        'right:8px',
        'left:auto',
        'width:400px',
        // Start shorter so resize handle is usable.
        'height:70vh',
        'max-height:calc(100vh - 16px)',
        'z-index:2147483647',
        'background:rgba(2,6,23,0.92)',
        'border-left:1px solid rgba(148,163,184,0.35)',
        'box-sizing:border-box',
        'padding:12px',
        'overflow:auto',
        'display:none',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif',
        // Make inspector resizable (wireDraggableResizable also enables this, but keep it explicit).
        'resize:both',
        'min-width:320px',
        'min-height:240px',
      ].join(';'),
    );

    const panelHeader = document.createElement('div');
    panelHeader.setAttribute('style', ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:10px'].join(';'));

    const panelTitle = document.createElement('div');
    panelTitle.textContent = 'Feature (Editable) — drag to move';
    panelTitle.setAttribute(
      'style',
      ['font-weight:800', 'font-size:12px', 'color:#e5e7eb', 'cursor:move', 'user-select:none', 'line-height:1.3'].join(';'),
    );

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.setAttribute(
      'style',
      [
        'border:0',
        'border-radius:8px',
        'padding:6px 10px',
        'cursor:pointer',
        'font-weight:700',
        'font-size:12px',
        'color:#cbd5e1',
        'background:rgba(148,163,184,0.15)',
      ].join(';'),
    );

    closeBtn.addEventListener('click', () => {
      isInspectorOpen = false;
      const panelEl = document.getElementById('__pw_rec_inspector_panel__');
      if (panelEl) panelEl.style.display = 'none';
    });

    panelHeader.appendChild(panelTitle);
    panelHeader.appendChild(closeBtn);

    const featureEditor = document.createElement('textarea');
    featureEditor.id = '__pw_rec_feature_editor__';
    featureEditor.setAttribute(
      'style',
      [
        'margin-top:10px',
        'width:100%',
        'height:calc(100% - 76px)',
        'min-height:160px',
        'resize:vertical',
        'padding:10px',
        'border-radius:12px',
        'border:1px solid rgba(148,163,184,0.25)',
        'background:rgba(15,23,42,0.35)',
        'color:#e5e7eb',
        'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
        'font-size:11px',
        'line-height:1.35',
        'box-sizing:border-box',
      ].join(';'),
    );
    featureEditor.placeholder = NO_STEPS_TEXT;
    featureEditor.value = NO_STEPS_TEXT;
    featureEditor.addEventListener('input', () => {
      if (suppressInspectorInput) return;
      inspectorDirty = true;
    });

    panel.appendChild(panelHeader);

    // Captured APIs (embedded into the existing inspector panel)
    const apiSection = document.createElement('div');
    apiSection.id = '__pw_rec_api_section__';
    apiSection.setAttribute(
      'style',
      [
        'margin-top:10px',
        'padding-top:10px',
        'border-top:1px solid rgba(148,163,184,0.20)',
      ].join(';'),
    );

    const apiSectionTitle = document.createElement('div');
    apiSectionTitle.textContent = 'Captured APIs';
    apiSectionTitle.setAttribute('style', ['font-weight:900', 'font-size:12px', 'color:#e5e7eb', 'margin-bottom:6px'].join(';'));

    const apiSectionHint = document.createElement('div');
    apiSectionHint.textContent = 'Delete removes the API call from preview + generated feature.';
    apiSectionHint.setAttribute('style', ['font-size:11px', 'color:#94a3b8', 'margin-bottom:8px'].join(';'));

    const apiInlineList = document.createElement('div');
    apiInlineList.id = '__pw_rec_api_inline_list__';
    apiInlineList.setAttribute(
      'style',
      [
        'display:flex',
        'flex-direction:column',
        'gap:8px',
        'max-height:260px',
        'overflow:auto',
        'padding-right:6px',
        'border-radius:10px',
        'border:1px solid rgba(148,163,184,0.12)',
        'background:rgba(15,23,42,0.18)',
      ].join(';'),
    );

    apiSection.appendChild(apiSectionTitle);
    apiSection.appendChild(apiSectionHint);
    apiSection.appendChild(apiInlineList);
    panel.appendChild(apiSection);
    panel.appendChild(featureEditor);
    wrapper.appendChild(panel);

    const renderApiInline = async () => {
      try {
        const listEl = document.getElementById('__pw_rec_api_inline_list__');
        const sectionEl = document.getElementById('__pw_rec_api_section__');
        if (!listEl || !sectionEl) return;

        // Only show this section in API / UI+API selection.
        const cm = String(captureMode || '').toUpperCase();
        if (cm === 'UI') {
          sectionEl.style.display = 'none';
          return;
        }
        sectionEl.style.display = 'block';

        const rows = window.pwRecorderGetCapturedApis ? await window.pwRecorderGetCapturedApis().catch(() => []) : [];
        listEl.innerHTML = '';
        if (!rows || !rows.length) {
          listEl.innerHTML = '<div style="font-size:12px;color:#94a3b8;">No APIs captured yet.</div>';
          return;
        }

        rows.forEach((r) => {
          const card = document.createElement('div');
          card.setAttribute(
            'style',
            [
              'border:1px solid rgba(148,163,184,0.24)',
              'border-radius:10px',
              'padding:10px',
              'background:rgba(15,23,42,0.30)',
              'display:flex',
              'gap:10px',
              'align-items:flex-start',
              'justify-content:space-between',
            ].join(';'),
          );

          const left = document.createElement('div');
          left.setAttribute('style', ['display:flex', 'flex-direction:column', 'gap:4px', 'min-width:0'].join(';'));
          const top = document.createElement('div');
          top.setAttribute('style', ['display:flex', 'gap:8px', 'align-items:center', 'flex-wrap:wrap'].join(';'));
          const badge = document.createElement('span');
          badge.textContent = String(r.method || '').toUpperCase() + ' ' + String(r.status ?? '');
          badge.setAttribute(
            'style',
            [
              'font-size:11px',
              'font-weight:900',
              'padding:3px 8px',
              'border-radius:999px',
              'color:#e5e7eb',
              'background:rgba(37,99,235,0.25)',
              'border:1px solid rgba(148,163,184,0.18)',
            ].join(';'),
          );
          const url = document.createElement('div');
          url.textContent = String(r.fullUrl || r.url || '');
          url.setAttribute('style', ['font-size:12px', 'color:#e2e8f0', 'word-break:break-all'].join(';'));
          top.appendChild(badge);
          top.appendChild(url);

          const sub = document.createElement('div');
          sub.textContent = 'Match key: ' + String((r.method || '').toUpperCase()) + ' ' + String(r.url || '');
          sub.setAttribute('style', ['font-size:11px', 'color:#94a3b8', 'word-break:break-all'].join(';'));

          left.appendChild(top);
          left.appendChild(sub);

          const del = document.createElement('button');
          del.type = 'button';
          del.textContent = 'Delete';
          del.setAttribute(
            'style',
            [
              'border:0',
              'border-radius:10px',
              'padding:8px 10px',
              'cursor:pointer',
              'font-weight:900',
              'font-size:12px',
              'color:#fff',
              'background:rgba(220,38,38,0.95)',
            ].join(';'),
          );
          del.onclick = async () => {
            if (!window.pwRecorderDeleteCapturedApi) return;
            await window.pwRecorderDeleteCapturedApi({ index: Number(r.index) }).catch(() => {});
            void renderApiInline();
          };

          card.appendChild(left);
          card.appendChild(del);
          listEl.appendChild(card);
        });
      } catch {}
    };

    const setInspectorOpen = (open) => {
      isInspectorOpen = !!open;
      const panelEl = document.getElementById('__pw_rec_inspector_panel__');
      if (panelEl) panelEl.style.display = isInspectorOpen ? 'block' : 'none';
      if (isInspectorOpen) {
        inspectorDirty = false;
        const editorEl = document.getElementById('__pw_rec_feature_editor__');
        if (editorEl) {
          suppressInspectorInput = true;
          editorEl.value = generatedFeatureContent || NO_STEPS_TEXT;
          suppressInspectorInput = false;
        }
        void renderApiInline();
      }
    };

    inspectorBtn.addEventListener('click', () => {
      if (isGenerating) return;
      setInspectorOpen(!isInspectorOpen);
    });

    const objectPanel = document.createElement('div');
    objectPanel.id = '__pw_rec_object_inspector_panel__';
    objectPanel.setAttribute(
      'style',
      [
        'position:fixed',
        'top:72px',
        'left:24px',
        'right:auto',
        'transform:none',
        'width:560px',
        'max-width:calc(100vw - 32px)',
        'max-height:calc(100vh - 96px)',
        'z-index:2147483647',
        'background:rgba(2,6,23,0.94)',
        'border:1px solid rgba(148,163,184,0.35)',
        'border-radius:14px',
        'box-shadow:0 18px 54px rgba(0,0,0,0.35)',
        'box-sizing:border-box',
        'padding:14px',
        'overflow:auto',
        'display:none',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif',
      ].join(';'),
    );

    const objectPanelHeader = document.createElement('div');
    objectPanelHeader.setAttribute(
      'style',
      ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:10px', 'margin-bottom:10px'].join(';'),
    );
    const objectPanelTitle = document.createElement('div');
    objectPanelTitle.textContent = 'Captured Objects — drag to move';
    objectPanelTitle.setAttribute(
      'style',
      ['font-weight:800', 'font-size:12px', 'color:#e5e7eb', 'cursor:move', 'user-select:none', 'line-height:1.3'].join(';'),
    );
    const objectPanelClose = document.createElement('button');
    objectPanelClose.type = 'button';
    objectPanelClose.textContent = 'Close';
    objectPanelClose.setAttribute(
      'style',
      [
        'border:0',
        'border-radius:8px',
        'padding:6px 10px',
        'cursor:pointer',
        'font-weight:700',
        'font-size:12px',
        'color:#cbd5e1',
        'background:rgba(148,163,184,0.15)',
      ].join(';'),
    );
    objectPanelHeader.appendChild(objectPanelTitle);
    objectPanelHeader.appendChild(objectPanelClose);

    const objectStatus = document.createElement('div');
    objectStatus.id = '__pw_rec_object_inspector_status__';
    objectStatus.setAttribute('style', ['font-size:12px', 'color:#94a3b8', 'margin-bottom:8px'].join(';'));
    objectStatus.textContent = '';

    const objectList = document.createElement('div');
    objectList.id = '__pw_rec_object_inspector_list__';
    objectList.setAttribute('style', ['display:flex', 'flex-direction:column', 'gap:8px'].join(';'));

    const objectFooter = document.createElement('div');
    objectFooter.setAttribute('style', ['margin-top:12px', 'padding-top:10px', 'border-top:1px solid rgba(148,163,184,0.20)', 'display:flex', 'justify-content:flex-end'].join(';'));
    const genYamlBtn = document.createElement('button');
    genYamlBtn.type = 'button';
    genYamlBtn.id = '__pw_rec_generate_yaml_btn__';
    genYamlBtn.textContent = 'Generate YAML';
    genYamlBtn.setAttribute(
      'style',
      [
        'border:0',
        'border-radius:10px',
        'padding:8px 10px',
        'cursor:pointer',
        'font-weight:700',
        'font-size:12px',
        'color:#fff',
        'background:linear-gradient(135deg,#0ea5e9,#2563eb)',
      ].join(';'),
    );
    objectFooter.appendChild(genYamlBtn);

    objectPanel.appendChild(objectPanelHeader);
    objectPanel.appendChild(objectStatus);
    objectPanel.appendChild(objectList);
    objectPanel.appendChild(objectFooter);
    wrapper.appendChild(objectPanel);

    wireDraggableResizable(panel, panelTitle, { minW: 300, minH: 220 });
    wireDraggableResizable(objectPanel, objectPanelTitle, { minW: 360, minH: 220 });

    const objectInspectorState = { rows: [] };

    const renderObjectRows = () => {
      const listEl = document.getElementById('__pw_rec_object_inspector_list__');
      const statusEl = document.getElementById('__pw_rec_object_inspector_status__');
      if (!listEl || !statusEl) return;
      listEl.innerHTML = '';

      if (!objectInspectorState.rows.length) {
        statusEl.textContent = 'No objects captured yet';
        return;
      }
      statusEl.textContent = '';

      objectInspectorState.rows.forEach((row, idx) => {
        const card = document.createElement('div');
        card.setAttribute(
          'style',
          [
            'border:1px solid rgba(148,163,184,0.24)',
            'border-radius:10px',
            'padding:8px',
            'background:rgba(15,23,42,0.30)',
          ].join(';'),
        );

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = String(row.element || '');
        nameInput.setAttribute(
          'style',
          [
            'width:100%',
            'box-sizing:border-box',
            'padding:7px 9px',
            'border-radius:8px',
            'border:1px solid rgba(148,163,184,0.28)',
            'background:rgba(2,6,23,0.65)',
            'color:#e5e7eb',
            'font-size:12px',
            'font-weight:700',
            'outline:none',
            'margin-bottom:8px',
          ].join(';'),
        );
        nameInput.addEventListener('input', () => {
          objectInspectorState.rows[idx].element = String(nameInput.value || '');
        });

        const strategy = document.createElement('div');
        strategy.textContent = 'Strategy: ' + String((row.locator && row.locator[0]) || '');
        strategy.setAttribute('style', ['font-size:11px', 'color:#cbd5e1', 'margin-bottom:4px'].join(';'));

        const value = document.createElement('div');
        value.textContent = 'Value: ' + String((row.locator && row.locator[1]) || '');
        value.setAttribute('style', ['font-size:11px', 'color:#e2e8f0', 'word-break:break-all'].join(';'));

        card.appendChild(nameInput);
        card.appendChild(strategy);
        card.appendChild(value);
        listEl.appendChild(card);
      });
    };

    const loadCapturedObjects = async () => {
      if (!window.pwRecorderGetCapturedObjects) return;
      try {
        const rows = await window.pwRecorderGetCapturedObjects();
        objectInspectorState.rows = Array.isArray(rows)
          ? rows.map((r) => ({
              element: String(r && r.element ? r.element : ''),
              locator: [
                String(r && r.locator && r.locator[0] ? r.locator[0] : ''),
                String(r && r.locator && r.locator[1] ? r.locator[1] : ''),
              ],
            }))
          : [];
      } catch (e) {
        objectInspectorState.rows = [];
      }
      renderObjectRows();
    };

    const setObjectInspectorOpen = (open) => {
      isObjectInspectorOpen = !!open;
      const panelEl = document.getElementById('__pw_rec_object_inspector_panel__');
      if (panelEl) panelEl.style.display = isObjectInspectorOpen ? 'block' : 'none';
      if (isObjectInspectorOpen) void loadCapturedObjects();
    };

    objectInspectorBtn.addEventListener('click', () => {
      if (isGenerating) return;
      setObjectInspectorOpen(!isObjectInspectorOpen);
    });

    objectPanelClose.addEventListener('click', () => {
      setObjectInspectorOpen(false);
    });

    genYamlBtn.addEventListener('click', async () => {
      if (!window.pwRecorderGenerateInspectorYaml) return;
      const fileInputEl = document.getElementById('__pw_rec_filename__');
      const rawName = fileInputEl && typeof fileInputEl.value === 'string' ? fileInputEl.value : '';
      const safeName = sanitizeFileName(rawName);
      if (fileInputEl && typeof fileInputEl.value === 'string') fileInputEl.value = safeName;
      const result = await window.pwRecorderGenerateInspectorYaml({
        fileName: safeName,
        objects: objectInspectorState.rows,
      }).catch(() => ({ ok: false, message: 'Generate YAML failed' }));
      if (result && result.ok) {
        alert('YAML generated: ' + String(result.path || 'locators/generated/' + safeName + '.yaml'));
      } else {
        alert(String((result && result.message) || 'Generate YAML failed'));
      }
    });

    window.__pwRecorderRender = (payload) => {
      try {
        const featureContent =
          payload && typeof payload.featureContent === 'string' && payload.featureContent.trim().length
            ? payload.featureContent
            : NO_STEPS_TEXT;
        const force = !!(payload && payload.force);

        generatedFeatureContent = featureContent;

        if (!isInspectorOpen) return;
        if (inspectorDirty && !force) return;

        const editorEl = document.getElementById('__pw_rec_feature_editor__');
        if (!editorEl) return;

        suppressInspectorInput = true;
        editorEl.value = featureContent;
        suppressInspectorInput = false;
        if (force) inspectorDirty = false;
        if (isObjectInspectorOpen) {
          void loadCapturedObjects();
        }
      } catch {}
    };

    generatedFeatureContent = NO_STEPS_TEXT;
    window.__pwRecorderRender({ featureContent: NO_STEPS_TEXT, force: true });

    updateToggleUi(toggleBtn);
    ensureHoverUi();
    try { void renderApiInline(); } catch {}
  }

  function ensureHoverUi() {
    try {
      if (!document.getElementById('__pw_rec_hover_overlay__')) {
        const overlay = document.createElement('div');
        overlay.id = '__pw_rec_hover_overlay__';
        overlay.setAttribute(
          'style',
          [
            'position:fixed',
            'z-index:2147483646',
            'pointer-events:none',
            'display:none',
            'border:2px solid rgba(59,130,246,0.95)',
            'background:rgba(59,130,246,0.12)',
            'border-radius:6px',
            'box-sizing:border-box',
          ].join(';'),
        );
        const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
        uiRoot.appendChild(overlay);
      }

      if (!document.getElementById('__pw_rec_hover_tooltip__')) {
        const tooltip = document.createElement('div');
        tooltip.id = '__pw_rec_hover_tooltip__';
        tooltip.setAttribute(
          'style',
          [
            'position:fixed',
            'z-index:2147483647',
            'pointer-events:none',
            'display:none',
            'background:rgba(0,0,0,0.86)',
            'color:#e5e7eb',
            'border:1px solid rgba(148,163,184,0.25)',
            'border-radius:10px',
            'padding:8px 10px',
            'max-width:320px',
            'white-space:pre-wrap',
            'font-family:system-ui,Segoe UI,Roboto,sans-serif',
            'font-size:12px',
            'line-height:1.25',
            'box-sizing:border-box',
          ].join(';'),
        );
        const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
        uiRoot.appendChild(tooltip);
      }
    } catch {}
  }

  function getSelectedText() {
    try {
      const sel = window.getSelection && window.getSelection();
      const t = sel ? String(sel.toString() || '').trim() : '';
      return t;
    } catch (e) {
      return '';
    }
  }

  function findNearestTableName(el) {
    try {
      if (!el || !el.closest) return '';
      const table = el.closest('table');
      if (table && table.id) return String(table.id);
      const root = el.closest('[id]');
      if (root && root.id) return String(root.id);
    } catch (e) {}
    return '';
  }

  /** Drag handle + CSS resize (overflow:auto) for recorder popups. */
  function wireDraggableResizable(panel, dragHandle, opts) {
    const o = opts || {};
    const minW = o.minW != null ? o.minW : 220;
    const minH = o.minH != null ? o.minH : 100;
    const enableResize = o.resize !== false;
    if (!panel || !dragHandle || panel.getAttribute('data-pw-rec-drag-wired') === '1') return;
    panel.setAttribute('data-pw-rec-drag-wired', '1');
    if (enableResize) {
      panel.style.resize = 'both';
      panel.style.overflow = 'auto';
      panel.style.minWidth = minW + 'px';
      panel.style.minHeight = minH + 'px';
      panel.style.maxWidth = o.maxW != null ? o.maxW : 'calc(100vw - 16px)';
      panel.style.maxHeight = o.maxH != null ? o.maxH : 'calc(100vh - 16px)';
    }
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let sl = 0;
    let st = 0;
    const onDocMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const r = panel.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      let nl = sl + dx;
      let nt = st + dy;
      nl = Math.max(8, nl);
      nt = Math.max(8, nt);
      if (nl + w > window.innerWidth - 8) nl = Math.max(8, window.innerWidth - 8 - w);
      if (nt + h > window.innerHeight - 8) nt = Math.max(8, window.innerHeight - 8 - h);
      panel.style.left = nl + 'px';
      panel.style.top = nt + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    };
    const onDocUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('pointermove', onDocMove, true);
      document.removeEventListener('pointerup', onDocUp, true);
      document.removeEventListener('pointercancel', onDocUp, true);
    };
    dragHandle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (t && t.closest && t.closest('button,a,input,textarea,select')) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = panel.getBoundingClientRect();
      sl = r.left;
      st = r.top;
      panel.style.left = sl + 'px';
      panel.style.top = st + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
      if (panel.id === '__pw_rec_inspector_panel__') {
        panel.style.width = r.width + 'px';
        panel.style.height = Math.min(window.innerHeight - 16, r.height) + 'px';
      }
      document.addEventListener('pointermove', onDocMove, true);
      document.addEventListener('pointerup', onDocUp, true);
      document.addEventListener('pointercancel', onDocUp, true);
      e.preventDefault();
    });
  }

  function ensureQuickAssertMenu() {
    if (document.getElementById('__pw_rec_quick_assert__')) return;
    const menu = document.createElement('div');
    menu.id = '__pw_rec_quick_assert__';
    menu.setAttribute('style', [
      'position:fixed',
      'z-index:2147483647',
      'display:none',
      'min-width:220px',
      'padding:8px',
      'border-radius:12px',
      'background:rgba(2,6,23,0.95)',
      'border:1px solid rgba(148,163,184,0.25)',
      'box-shadow:0 10px 30px rgba(0,0,0,0.35)',
      'font-family:system-ui,Segoe UI,Roboto,sans-serif',
    ].join(';'));

    const dragBar = document.createElement('div');
    dragBar.id = '__pw_rec_quick_assert_drag__';
    dragBar.textContent = 'Quick Verify — drag to move · resize corner to adjust';
    dragBar.setAttribute(
      'style',
      [
        'cursor:move',
        'user-select:none',
        'font-weight:800',
        'font-size:11px',
        'color:#e5e7eb',
        'padding:8px 10px',
        'margin:-8px -8px 8px -8px',
        'border-radius:12px 12px 0 0',
        'background:rgba(0,0,0,0.28)',
        'border-bottom:1px solid rgba(148,163,184,0.2)',
        'line-height:1.35',
      ].join(';'),
    );
    menu.appendChild(dragBar);
    const hint = document.createElement('div');
    hint.textContent = 'Inside a table: verify this cell’s text, or open Web table verification.';
    hint.setAttribute('style', ['font-size:10px', 'color:#94a3b8', 'margin:0 6px 8px', 'line-height:1.3'].join(';'));
    menu.appendChild(hint);

    const mkBtn = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('style', [
        'width:100%',
        'text-align:left',
        'border:0',
        'border-radius:10px',
        'padding:8px 10px',
        'cursor:pointer',
        'font-weight:700',
        'font-size:12px',
        'color:#e5e7eb',
        'background:rgba(148,163,184,0.12)',
        'margin:4px 0',
      ].join(';'));
      b.addEventListener('mouseenter', () => { b.style.background = 'rgba(37,99,235,0.25)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'rgba(148,163,184,0.12)'; });
      return b;
    };

    const btnText = mkBtn('Verify text');
    btnText.id = '__pw_rec_quick_assert_text__';
    const btnTable = mkBtn('Web table verification');
    btnTable.id = '__pw_rec_quick_assert_table__';
    const btnClose = mkBtn('Close');
    btnClose.id = '__pw_rec_quick_assert_close__';

    menu.appendChild(btnText);
    menu.appendChild(btnTable);
    menu.appendChild(btnClose);
    const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
    uiRoot.appendChild(menu);

    wireDraggableResizable(menu, dragBar, { minW: 220, minH: 160 });

    const hide = () => { try { menu.style.display = 'none'; } catch (e) {} };
    btnClose.addEventListener('click', hide);
    document.addEventListener('click', (e) => {
      if (!menu || menu.style.display === 'none') return;
      const t = e && e.target;
      if (t && (t === menu || (t.closest && t.closest('#__pw_rec_quick_assert__')))) return;
      hide();
    }, true);
  }

  function showQuickAssertMenu(x, y, selectedText, opts) {
    ensureQuickAssertMenu();
    const menu = document.getElementById('__pw_rec_quick_assert__');
    if (!menu) return;
    const btnText = document.getElementById('__pw_rec_quick_assert_text__');
    const btnTable = document.getElementById('__pw_rec_quick_assert_table__');
    const btnClose = document.getElementById('__pw_rec_quick_assert_close__');

    const o = opts && typeof opts === 'object' ? opts : {};
    const tableForMenu = o.tableEl || null;
    const cellTextForAssert = String(o.cellText || '').trim();
    const st = String(selectedText || '').trim();
    const suggestedName = String(o.suggestedName || '').trim();

    const textToRecord = cellTextForAssert || st;
    const canVerifyText = !!(textToRecord && textToRecord.length);
    const canWebTable = !!(tableForMenu && tableForMenu.tagName && String(tableForMenu.tagName).toLowerCase() === 'table');

    if (btnText) {
      btnText.textContent = cellTextForAssert ? 'Verify cell text' : 'Verify selected text';
      btnText.disabled = !canVerifyText;
      btnText.onclick = () => {
        if (!canVerifyText) return;
        menu.style.display = 'none';
        const mx = parseFloat(menu.style.left);
        const my = parseFloat(menu.style.top);
        const px = Number.isFinite(mx) ? mx + 8 : x;
        const py = Number.isFinite(my) ? my + 36 : y;
        showTextConfirmTooltip(px, py, textToRecord);
      };
    }

    if (btnTable) {
      btnTable.disabled = !canWebTable;
      btnTable.onclick = () => {
        try {
          if (canWebTable) {
            const sug = suggestedName || (tableForMenu.id ? String(tableForMenu.id) : '');
            openTableConfigModal(tableForMenu, sug);
          }
        } catch (e) {}
        menu.style.display = 'none';
      };
    }

    if (btnClose) btnClose.onclick = () => { menu.style.display = 'none'; };

    menu.style.left = Math.min(x, window.innerWidth - 240) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 180) + 'px';
    menu.style.display = 'block';
  }

  function cleanInlineText(s) {
    return String(s || '')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }

  function looksLikeTextElement(el) {
    try {
      if (!el || !el.tagName) return false;
      const tag = String(el.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select', 'button', 'a'].includes(tag)) return false;
      const role = String(el.getAttribute && el.getAttribute('role') ? el.getAttribute('role') : '').toLowerCase();
      if (role === 'button' || role === 'link') return false;
      return ['p', 'span', 'label', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
    } catch (e) {
      return false;
    }
  }

  function getVisibleTextFromElement(el) {
    try {
      if (!el) return '';
      const t = cleanInlineText(el.innerText || el.textContent || '');
      return t;
    } catch (e) {
      return '';
    }
  }

  function ensureTextConfirmTooltip() {
    if (document.getElementById('__pw_rec_text_confirm__')) return;
    const tip = document.createElement('div');
    tip.id = '__pw_rec_text_confirm__';
    tip.setAttribute(
      'style',
      [
        'position:fixed',
        'z-index:2147483647',
        'display:none',
        'min-width:260px',
        'max-width:min(560px,92vw)',
        'padding:10px',
        'border-radius:12px',
        'background:rgba(2,6,23,0.95)',
        'border:1px solid rgba(148,163,184,0.25)',
        'box-shadow:0 10px 30px rgba(0,0,0,0.35)',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif',
        'color:#e5e7eb',
        'box-sizing:border-box',
      ].join(';'),
    );

    const dragBar = document.createElement('div');
    dragBar.id = '__pw_rec_text_confirm_drag__';
    dragBar.textContent = 'Add verification for this text? — drag to move · resize to adjust';
    dragBar.setAttribute(
      'style',
      [
        'cursor:move',
        'user-select:none',
        'font-weight:800',
        'font-size:12px',
        'margin:-10px -10px 10px -10px',
        'padding:10px 12px',
        'border-radius:12px 12px 0 0',
        'background:rgba(0,0,0,0.35)',
        'border-bottom:1px solid rgba(148,163,184,0.22)',
        'line-height:1.35',
      ].join(';'),
    );

    const preview = document.createElement('div');
    preview.id = '__pw_rec_text_confirm_preview__';
    preview.setAttribute(
      'style',
      ['font-size:12px', 'opacity:0.92', 'margin-bottom:10px', 'white-space:pre-wrap', 'word-break:break-word'].join(';'),
    );

    const row = document.createElement('div');
    row.setAttribute('style', ['display:flex', 'gap:8px', 'justify-content:flex-end'].join(';'));

    const mkBtn = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute(
        'style',
        [
          'border:0',
          'border-radius:10px',
          'padding:8px 10px',
          'cursor:pointer',
          'font-weight:800',
          'font-size:12px',
          'color:#e5e7eb',
          'background:rgba(148,163,184,0.14)',
        ].join(';'),
      );
      return b;
    };

    const yes = mkBtn('Yes');
    yes.id = '__pw_rec_text_confirm_yes__';
    yes.style.background = 'rgba(37,99,235,0.55)';
    const cancel = mkBtn('Cancel');
    cancel.id = '__pw_rec_text_confirm_cancel__';

    row.appendChild(cancel);
    row.appendChild(yes);

    tip.appendChild(dragBar);
    tip.appendChild(preview);
    tip.appendChild(row);

    const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
    uiRoot.appendChild(tip);

    wireDraggableResizable(tip, dragBar, { minW: 260, minH: 170 });
  }

  function showTextConfirmTooltip(x, y, capturedText) {
    ensureTextConfirmTooltip();
    const tip = document.getElementById('__pw_rec_text_confirm__');
    const preview = document.getElementById('__pw_rec_text_confirm_preview__');
    const yes = document.getElementById('__pw_rec_text_confirm_yes__');
    const cancel = document.getElementById('__pw_rec_text_confirm_cancel__');
    if (!tip || !preview || !yes || !cancel) return;

    const t = cleanInlineText(capturedText);
    if (!t) return;
    preview.textContent = '"' + t + '"';

    const hide = () => {
      try {
        tip.style.display = 'none';
      } catch (e) {}
    };

    cancel.onclick = hide;
    yes.onclick = async () => {
      try {
        if (window.pwRecorderAddAssertion) await window.pwRecorderAddAssertion({ kind: 'text', text: t, href: location.href });
      } catch (e) {}
      hide();
    };

    tip.style.left = Math.min(x, window.innerWidth - 360) + 'px';
    tip.style.top = Math.min(y, window.innerHeight - 190) + 'px';
    tip.style.display = 'block';
  }

  function showTableClickChooser(_x, _y, _cellText, tableEl, suggestedName) {
    openTableConfigModal(tableEl, suggestedName);
  }

  function normalizeTableCellText(s) {
    let t = String(s || '');
    try {
      t = t.normalize('NFKC');
    } catch (e) {}
    t = t.replace(/\\s+/g, ' ').trim();
    t = t.replace(/[\\u200B-\\u200D\\uFEFF]/g, '');

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const iso = String(yyyy) + '-' + String(mm) + '-' + String(dd);
    const slash = String(mm) + '/' + String(dd) + '/' + String(yyyy);
    const slash2 = String(dd) + '/' + String(mm) + '/' + String(yyyy);
    if (t === iso || t === slash || t === slash2) return '<CURRENT_DATE>';
    return t;
  }

  function listBodyTrs(te) {
    if (!te) return [];
    try {
      const tb = te.querySelectorAll('tbody tr');
      if (tb && tb.length) return Array.prototype.slice.call(tb);
      const all = Array.prototype.slice.call(te.querySelectorAll('tr'));
      return all.length > 1 ? all.slice(1) : [];
    } catch (e) {
      return [];
    }
  }

  function isHeaderTr(te, tr) {
    if (!te || !tr) return false;
    try {
      if (tr.closest && tr.closest('thead')) return true;
      const first = te.querySelector('tr');
      return first === tr;
    } catch (e) {
      return false;
    }
  }

  function bodyRowIndexFromTr(te, tr) {
    if (!tr || isHeaderTr(te, tr)) return -1;
    const list = listBodyTrs(te);
    const idx = list.indexOf(tr);
    return idx;
  }

  function buildTableLocatorTuple(te) {
    if (!te) return ['xpath', ''];
    try {
      const tag = String(te.tagName || '').toLowerCase();
      if (tag !== 'table') return ['xpath', ''];
      const id = String(te.id || '').trim();
      if (id) return ['xpath', '//*[@id=' + JSON.stringify(id) + ']'];
      const tables = document.querySelectorAll('table');
      for (let i = 0; i < tables.length; i++) {
        if (tables[i] === te) return ['xpath', '(//table)[' + String(i + 1) + ']'];
      }
    } catch (e) {}
    return ['xpath', '//table'];
  }

  function findTableCellAtPoint(te, clientX, clientY) {
    if (!te || !te.querySelectorAll) return null;
    try {
      const cells = te.querySelectorAll('td,th');
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const r = cell.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return cell;
      }
    } catch (e) {}
    return null;
  }

  function tableSelectionKeyFromCell(te, cell) {
    const tr = cell && cell.closest ? cell.closest('tr') : null;
    if (!tr || !te || !te.contains(tr)) return null;
    const ci = cell.cellIndex;
    if (ci === undefined || ci === null || ci < 0) return null;
    const br = bodyRowIndexFromTr(te, tr);
    return String(br) + ',' + String(ci);
  }

  function getTableCellBySelectionKey(te, key) {
    const parts = String(key || '').split(',');
    const r = Number(parts[0]);
    const c = Number(parts[1]);
    if (!Number.isFinite(r) || !Number.isFinite(c) || c < 0) return null;
    try {
      if (r === -1) {
        const hr = te.querySelector('thead tr') || te.querySelector('tr');
        if (!hr || !hr.cells || !hr.cells[c]) return null;
        return hr.cells[c];
      }
      const body = listBodyTrs(te);
      const tr = body[r];
      if (!tr || !tr.cells || !tr.cells[c]) return null;
      return tr.cells[c];
    } catch (e) {
      return null;
    }
  }

  function clearTableSelectionHighlights(te) {
    if (!te || !te.querySelectorAll) return;
    try {
      const els = te.querySelectorAll('td[data-pw-rec-tsel],th[data-pw-rec-tsel]');
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        el.removeAttribute('data-pw-rec-tsel');
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.style.backgroundColor = '';
      }
    } catch (e) {}
  }

  function applyTableSelectionHighlights(te, selectedCells) {
    clearTableSelectionHighlights(te);
    if (!te || !selectedCells || !selectedCells.forEach) return;
    const outline = '2px solid rgba(37,99,235,0.95)';
    const bg = 'rgba(59,130,246,0.24)';
    selectedCells.forEach((k) => {
      const cell = getTableCellBySelectionKey(te, k);
      if (!cell) return;
      cell.setAttribute('data-pw-rec-tsel', '1');
      cell.style.outline = outline;
      cell.style.outlineOffset = '-2px';
      cell.style.backgroundColor = bg;
    });
  }

  function escapeHtmlTablePreview(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function extractTableData(tableEl) {
    const out = { headers: [], rows: [] };
    if (!tableEl) return out;

    let headerCells = [];
    let bodyRows = [];

    try {
      const theadHeaders = tableEl.querySelectorAll('thead th');
      if (theadHeaders && theadHeaders.length) {
        headerCells = Array.prototype.slice.call(theadHeaders);
      }
    } catch (e) {}

    let usedFallbackHeaderRow = false;
    if (!headerCells.length) {
      try {
        const firstTr = tableEl.querySelector('tr');
        if (firstTr) {
          usedFallbackHeaderRow = true;
          headerCells = Array.prototype.slice.call(firstTr.querySelectorAll('th,td'));
        }
      } catch (e) {}
    }

    out.headers = headerCells.map((h, idx) => {
      const txt = normalizeTableCellText((h && (h.innerText || h.textContent)) || '');
      return txt || ('Column ' + String(idx + 1));
    });

    try {
      const tbodyRows = tableEl.querySelectorAll('tbody tr');
      if (tbodyRows && tbodyRows.length) {
        bodyRows = Array.prototype.slice.call(tbodyRows);
      }
    } catch (e) {}

    if (!bodyRows.length) {
      try {
        const allRows = Array.prototype.slice.call(tableEl.querySelectorAll('tr'));
        bodyRows = usedFallbackHeaderRow ? allRows.slice(1) : allRows;
      } catch (e) {}
    }

    const colCount = Math.max(1, out.headers.length);
    const normalizedHeaderRow = out.headers.map((v) => normalizeTableCellText(v));
    const rowsMapped = bodyRows.map((tr) => {
      const cells = Array.prototype.slice.call(tr.querySelectorAll('td,th'));
      const row = [];
      for (let i = 0; i < colCount; i++) {
        const cell = cells[i];
        const raw = cell ? (cell.innerText || cell.textContent || '') : '';
        row.push(normalizeTableCellText(raw));
      }
      return row;
    });

    const rowsFiltered = [];
    for (let i = 0; i < rowsMapped.length; i++) {
      const row = rowsMapped[i];
      let isHeaderDuplicate = row.length === normalizedHeaderRow.length;
      if (isHeaderDuplicate) {
        for (let c = 0; c < normalizedHeaderRow.length; c++) {
          const a = normalizeTableCellText(row[c] ?? '');
          const b = normalizeTableCellText(normalizedHeaderRow[c] ?? '');
          if (a !== b) {
            isHeaderDuplicate = false;
            break;
          }
        }
      }
      if (!isHeaderDuplicate) rowsFiltered.push(row);
    }
    out.rows = rowsFiltered;

    return out;
  }

  function ensureTableConfigPanel() {
    if (document.getElementById('__pw_rec_table_panel__')) return;
    const panel = document.createElement('div');
    panel.id = '__pw_rec_table_panel__';
    panel.setAttribute(
      'style',
      [
        'position:fixed',
        'top:56px',
        'left:24px',
        'right:auto',
        'transform:none',
        'z-index:2147483647',
        'display:none',
        'width:760px',
        'max-width:calc(100vw - 32px)',
        'max-height:calc(100vh - 96px)',
        'overflow:auto',
        'background:#fff',
        'border:1px solid rgba(0,0,0,0.12)',
        'border-radius:14px',
        'box-shadow:0 16px 48px rgba(0,0,0,0.22)',
        'padding:14px',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif',
        'color:#0f172a',
        'box-sizing:border-box',
      ].join(';'),
    );

    const title = document.createElement('div');
    title.textContent = 'Web Table Verification — drag title to move';
    title.setAttribute(
      'style',
      [
        'font-weight:900',
        'font-size:17px',
        'margin:-14px -14px 8px -14px',
        'padding:12px 14px',
        'cursor:move',
        'user-select:none',
        'background:rgba(15,23,42,0.06)',
        'border-bottom:1px solid rgba(0,0,0,0.08)',
        'border-radius:14px 14px 0 0',
      ].join(';'),
    );
    const blurb = document.createElement('div');
    blurb.textContent =
      'Click cells on the page table to toggle selection, or left-drag across a rectangle (adds to selection). Selected cells are highlighted on the table. The generated step uses your table’s column titles for the first line (so the test knows which columns to check); only the cell values you selected appear as data rows below. Reset clears selection. Drag this panel’s title to move; resize from the corner.';
    blurb.setAttribute(
      'style',
      ['font-size:12px', 'color:#475569', 'line-height:1.35', 'margin-bottom:10px', 'max-width:720px'].join(';'),
    );

    const error = document.createElement('div');
    error.id = '__pw_rec_table_error__';
    error.setAttribute('style', ['display:none', 'margin-bottom:10px', 'font-size:12px', 'color:#b91c1c', 'font-weight:700'].join(';'));

    const nameRow = document.createElement('div');
    nameRow.setAttribute('style', ['display:flex', 'gap:10px', 'align-items:center', 'margin-bottom:10px'].join(';'));
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Table Name';
    nameLabel.setAttribute('style', ['min-width:94px', 'font-weight:800', 'font-size:13px'].join(';'));
    const nameInput = document.createElement('input');
    nameInput.id = '__pw_rec_table_name__';
    nameInput.type = 'text';
    nameInput.placeholder = 'Enter table name';
    nameInput.setAttribute(
      'style',
      [
        'flex:1',
        'padding:10px 12px',
        'border-radius:10px',
        'border:1px solid rgba(0,0,0,0.16)',
        'font-size:14px',
        'outline:none',
      ].join(';'),
    );
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);

    const selectionSection = document.createElement('div');
    selectionSection.setAttribute(
      'style',
      ['border:1px solid rgba(0,0,0,0.12)', 'border-radius:12px', 'padding:10px', 'margin-top:8px', 'background:#fafafa'].join(';'),
    );
    const selectionHeading = document.createElement('div');
    selectionHeading.textContent = 'Your selection';
    selectionHeading.setAttribute('style', ['font-weight:900', 'font-size:13px', 'margin-bottom:8px', 'color:#0f172a'].join(';'));
    const selectionVisual = document.createElement('div');
    selectionVisual.id = '__pw_rec_table_selection_visual__';
    selectionVisual.setAttribute('style', ['max-height:220px', 'overflow:auto'].join(';'));
    selectionSection.appendChild(selectionHeading);
    selectionSection.appendChild(selectionVisual);

    const previewTitle = document.createElement('div');
    previewTitle.textContent = 'Generated step (Gherkin)';
    previewTitle.setAttribute('style', ['font-weight:900', 'font-size:13px', 'margin-top:12px', 'margin-bottom:8px'].join(';'));
    const preview = document.createElement('pre');
    preview.id = '__pw_rec_table_preview__';
    preview.setAttribute(
      'style',
      [
        'margin:0',
        'white-space:pre',
        'overflow:auto',
        'padding:10px',
        'border-radius:10px',
        'background:rgba(15,23,42,0.04)',
        'border:1px solid rgba(0,0,0,0.10)',
        'font-size:12px',
        'line-height:1.4',
      ].join(';'),
    );

    const actions = document.createElement('div');
    actions.setAttribute('style', ['display:flex', 'justify-content:flex-end', 'gap:8px', 'margin-top:12px'].join(';'));
    const makeBtn = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute(
        'style',
        [
          'border-radius:10px',
          'padding:9px 12px',
          'cursor:pointer',
          'font-weight:900',
          'font-size:12px',
          'background:#fff',
          'color:#0f172a',
          'border:1px solid rgba(0,0,0,0.18)',
        ].join(';'),
      );
      return b;
    };
    const saveBtn = makeBtn('Confirm');
    saveBtn.id = '__pw_rec_table_confirm__';
    const resetBtn = makeBtn('Reset');
    resetBtn.id = '__pw_rec_table_reset__';
    const cancelBtn = makeBtn('Cancel');
    cancelBtn.id = '__pw_rec_table_cancel__';
    actions.appendChild(cancelBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(saveBtn);

    panel.appendChild(title);
    panel.appendChild(blurb);
    panel.appendChild(error);
    panel.appendChild(nameRow);
    panel.appendChild(selectionSection);
    panel.appendChild(previewTitle);
    panel.appendChild(preview);
    panel.appendChild(actions);

    const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
    uiRoot.appendChild(panel);

    wireDraggableResizable(panel, title, { minW: 400, minH: 320 });
  }

  function openTableConfigModal(tableEl, suggestedName) {
    ensureTableConfigPanel();
    const modal = document.getElementById('__pw_rec_table_panel__');
    const nameInput = document.getElementById('__pw_rec_table_name__');
    const error = document.getElementById('__pw_rec_table_error__');
    const selectionVisual = document.getElementById('__pw_rec_table_selection_visual__');
    const preview = document.getElementById('__pw_rec_table_preview__');
    const confirm = document.getElementById('__pw_rec_table_confirm__');
    const reset = document.getElementById('__pw_rec_table_reset__');
    const cancel = document.getElementById('__pw_rec_table_cancel__');
    if (!modal || !nameInput || !error || !selectionVisual || !preview || !confirm || !reset || !cancel) return;

    cleanupWebTableModalInteraction();

    const tableData = extractTableData(tableEl);
    const headers = Array.isArray(tableData.headers) ? tableData.headers : [];
    const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
    const selectedCells = new Set();

    nameInput.value = String(suggestedName || '').trim() || String((tableEl && tableEl.id) || '').trim() || '';
    error.style.display = 'none';
    error.textContent = '';

    const hide = () => {
      cleanupWebTableModalInteraction();
      modal.style.display = 'none';
    };
    cancel.onclick = hide;

    const readDomCellNormalized = (rowKey, ci) => {
      const cell = getTableCellBySelectionKey(tableEl, String(rowKey) + ',' + String(ci));
      if (!cell) return '';
      return normalizeTableCellText(cell.innerText || cell.textContent || '');
    };

    const getSelectedProjection = () => {
      const parsed = [];
      selectedCells.forEach((k) => {
        const p = String(k).split(',');
        const r = Number(p[0]);
        const c = Number(p[1]);
        if (Number.isFinite(r) && Number.isFinite(c) && c >= 0) parsed.push({ r, c });
      });
      if (!parsed.length) {
        return { colIdx: [], rowIdx: [], selHeaders: [], selRows: [] };
      }
      const bodyPoints = parsed.filter((x) => x.r >= 0);
      if (!bodyPoints.length) {
        return { colIdx: [], rowIdx: [], selHeaders: [], selRows: [] };
      }
      const colIdx = [...new Set(bodyPoints.map((x) => x.c))].sort((a, b) => a - b);
      const selHeaders = colIdx.map((ci) => readDomCellNormalized(-1, ci) || (headers[ci] !== undefined ? headers[ci] : ''));
      const bodyRowIndexes = [...new Set(bodyPoints.map((x) => x.r))].sort((a, b) => a - b);
      const selRows = bodyRowIndexes.map((br) =>
        colIdx.map((ci) => {
          const k = String(br) + ',' + String(ci);
          if (!selectedCells.has(k)) return '';
          return readDomCellNormalized(br, ci);
        }),
      );
      return { colIdx, rowIdx: bodyRowIndexes, selHeaders, selRows };
    };

    const renderSelectionVisual = () => {
      if (!selectedCells.size) {
        selectionVisual.innerHTML =
          '<div style="font-size:12px;color:#64748b;padding:8px 4px;">Click or drag on the table on the page to select cells. Highlights show on the table.</div>';
        return;
      }
      const parsed = [];
      selectedCells.forEach((k) => {
        const p = String(k).split(',');
        const r = Number(p[0]);
        const c = Number(p[1]);
        if (Number.isFinite(r) && Number.isFinite(c) && c >= 0) parsed.push({ r, c });
      });
      const colIdx = [...new Set(parsed.map((x) => x.c))].sort((a, b) => a - b);
      const rowOrder = [...new Set(parsed.map((x) => x.r))].sort((a, b) => a - b);
      let html = '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
      for (let ri = 0; ri < rowOrder.length; ri++) {
        const r = rowOrder[ri];
        html += '<tr>';
        const rowLabel = r === -1 ? 'Header' : 'Row ' + String(r + 1);
        html +=
          '<td style="border:1px solid #cbd5e1;padding:4px 8px;background:#e2e8f0;font-weight:700;white-space:nowrap;">' +
          escapeHtmlTablePreview(rowLabel) +
          '</td>';
        for (let ci = 0; ci < colIdx.length; ci++) {
          const c = colIdx[ci];
          const k = String(r) + ',' + String(c);
          const on = selectedCells.has(k);
          let txt = '';
          if (on) {
            const raw = readDomCellNormalized(r, c);
            txt = raw || (r === -1 && headers[c] != null ? String(headers[c]) : '');
          }
          html +=
            '<td style="border:1px solid #cbd5e1;padding:6px 8px;' +
            (on ? 'background:#dbeafe;' : 'background:#f8fafc;') +
            '">' +
            escapeHtmlTablePreview(txt) +
            '</td>';
        }
        html += '</tr>';
      }
      html += '</table>';
      selectionVisual.innerHTML = html;
    };

    const renderPreview = () => {
      const tableName = String(nameInput.value || '').trim();
      const { selHeaders, selRows } = getSelectedProjection();
      const pipe = (cells) => '| ' + cells.map((c) => String(c ?? '')).join(' | ') + ' |';
      const lines = [];
      lines.push('When verify data from "' + (tableName || 'TableName') + '" web table');
      if (selHeaders.length && selRows.length) {
        lines.push('  ' + pipe(selHeaders));
        for (const row of selRows) lines.push('  ' + pipe(row));
      }
      preview.textContent = lines.join('\\n');
      renderSelectionVisual();
    };

    selectionVisual.innerHTML = '';

    if (!headers.length || !rows.length) {
      selectionVisual.innerHTML =
        '<div style="font-size:12px;font-weight:800;color:#64748b;">No data found</div>';
      preview.textContent = 'No data found';
      modal.style.display = 'block';
      confirm.onclick = () => {
        error.textContent = 'No data found';
        error.style.display = 'block';
      };
      reset.onclick = () => {
        error.style.display = 'none';
      };
      return;
    }

    window.__pw_rec_activeTableEl = tableEl;
    const prevTableUserSelect = tableEl.style.userSelect;
    try {
      tableEl.style.userSelect = 'none';
    } catch (e) {}

    const refreshSelectionUi = () => {
      applyTableSelectionHighlights(tableEl, selectedCells);
      error.style.display = 'none';
      renderPreview();
    };

    window.__pwRecTableCellToggle = function (cell) {
      try {
        if (!cell || !tableEl.contains(cell)) return;
        const k = tableSelectionKeyFromCell(tableEl, cell);
        if (!k) return;
        if (selectedCells.has(k)) selectedCells.delete(k);
        else selectedCells.add(k);
        refreshSelectionUi();
      } catch (e) {}
    };

    let dragActive = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartCell = null;
    let tableDragPointerId = null;
    let tableDragDocMove = null;
    let tableDragDocUp = null;
    const DRAG_THRESH = 5;

    const getCellGridPos = (te, cell) => {
      const tr = cell.closest('tr');
      if (!tr || !te.contains(tr)) return null;
      const ci = cell.cellIndex;
      if (ci === undefined || ci === null || ci < 0) return null;
      return { col: ci, bodyRow: bodyRowIndexFromTr(te, tr) };
    };

    const mergeRectCells = (cellA, cellB) => {
      if (!cellA || !cellB) return;
      const posA = getCellGridPos(tableEl, cellA);
      const posB = getCellGridPos(tableEl, cellB);
      if (!posA || !posB) return;
      const trA = cellA.closest('tr');
      const trB = cellB.closest('tr');
      if (!trA || !trB) return;
      let allTr;
      try {
        allTr = Array.prototype.slice.call(tableEl.querySelectorAll('tr'));
      } catch (e) {
        return;
      }
      const riA = allTr.indexOf(trA);
      const riB = allTr.indexOf(trB);
      if (riA < 0 || riB < 0) return;
      const rLo = Math.min(riA, riB);
      const rHi = Math.max(riA, riB);
      const cMin = Math.min(posA.col, posB.col);
      const cMax = Math.max(posA.col, posB.col);
      for (let ri = rLo; ri <= rHi; ri++) {
        const tr = allTr[ri];
        if (!tr || !tr.cells) continue;
        for (let ci = cMin; ci <= cMax; ci++) {
          const cell = tr.cells[ci];
          if (!cell) continue;
          const k = tableSelectionKeyFromCell(tableEl, cell);
          if (k) selectedCells.add(k);
        }
      }
    };

    const detachTableDragDocListeners = () => {
      if (tableDragDocMove) {
        try {
          document.removeEventListener('pointermove', tableDragDocMove, true);
        } catch (e) {}
        tableDragDocMove = null;
      }
      if (tableDragDocUp) {
        try {
          document.removeEventListener('pointerup', tableDragDocUp, true);
          document.removeEventListener('pointercancel', tableDragDocUp, true);
        } catch (e) {}
        tableDragDocUp = null;
      }
    };

    const onTablePointerDown = (e) => {
      if (modal.style.display !== 'block') return;
      if (e.button !== 0) return;
      const cell = e.target && e.target.closest && e.target.closest('td,th');
      if (!cell || !tableEl.contains(cell)) return;
      if (getCellGridPos(tableEl, cell) === null) return;
      detachTableDragDocListeners();
      try {
        e.preventDefault();
      } catch (err) {}
      dragActive = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartCell = cell;
      tableDragPointerId = e.pointerId;

      tableDragDocMove = (ev) => {
        if (dragStartCell === null || ev.pointerId !== tableDragPointerId) return;
        const dx = ev.clientX - dragStartX;
        const dy = ev.clientY - dragStartY;
        if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESH) dragActive = true;
      };

      tableDragDocUp = (ev) => {
        if (tableDragPointerId !== null && ev.pointerId !== tableDragPointerId) return;
        tableDragPointerId = null;
        detachTableDragDocListeners();
        const start = dragStartCell;
        dragStartCell = null;
        if (!start) {
          dragActive = false;
          return;
        }
        if (dragActive) {
          let endCell = null;
          const raw = document.elementFromPoint(ev.clientX, ev.clientY);
          if (raw) {
            const c = raw.closest && raw.closest('td,th');
            if (c && tableEl.contains(c) && getCellGridPos(tableEl, c)) endCell = c;
          }
          if (!endCell) endCell = findTableCellAtPoint(tableEl, ev.clientX, ev.clientY);
          if (endCell && getCellGridPos(tableEl, endCell)) {
            mergeRectCells(start, endCell);
            refreshSelectionUi();
            pwRecSuppressTableClickOnce = true;
          }
        }
        dragActive = false;
      };

      document.addEventListener('pointermove', tableDragDocMove, true);
      document.addEventListener('pointerup', tableDragDocUp, true);
      document.addEventListener('pointercancel', tableDragDocUp, true);
    };

    tableEl.addEventListener('pointerdown', onTablePointerDown, true);

    pwRecTableModalCleanup = function () {
      detachTableDragDocListeners();
      dragStartCell = null;
      tableDragPointerId = null;
      dragActive = false;
      clearTableSelectionHighlights(tableEl);
      try {
        tableEl.style.userSelect = prevTableUserSelect || '';
      } catch (e) {}
      tableEl.removeEventListener('pointerdown', onTablePointerDown, true);
    };

    reset.onclick = () => {
      selectedCells.clear();
      error.style.display = 'none';
      refreshSelectionUi();
    };

    nameInput.oninput = () => {
      error.style.display = 'none';
      renderPreview();
    };

    confirm.onclick = async () => {
      const tableName = String(nameInput.value || '').trim();
      const { colIdx, rowIdx, selHeaders, selRows } = getSelectedProjection();

      if (!tableName) {
        error.textContent = 'Table name is required.';
        error.style.display = 'block';
        return;
      }
      if (!selectedCells.size) {
        error.textContent = 'Select at least one cell on the table (click or drag).';
        error.style.display = 'block';
        return;
      }
      const hasBodyCell = Array.from(selectedCells).some((k) => {
        const r = Number(String(k).split(',')[0]);
        return Number.isFinite(r) && r >= 0;
      });
      if (!hasBodyCell) {
        error.textContent = 'Select at least one data cell (body row), not only the header.';
        error.style.display = 'block';
        return;
      }
      if (!colIdx.length || !selRows.length) {
        error.textContent = 'Could not build rows from selection.';
        error.style.display = 'block';
        return;
      }

      try {
        const selectedColumnIndexes = colIdx.slice();
        const selectedBodyRowIndexes = rowIdx.slice();
        const dataMatrix = [selHeaders.slice(), ...selRows.map((r) => r.slice())];
        window.__WEBIO__ = window.__WEBIO__ || {};
        window.__WEBIO__.selectedTable = {
          name: tableName,
          selectedColumns: selectedColumnIndexes,
          selectedRows: selectedBodyRowIndexes,
          data: dataMatrix,
        };
        const locatorTuple = buildTableLocatorTuple(tableEl);
        if (window.pwRecorderAddAssertion) {
          await window.pwRecorderAddAssertion({
            kind: 'web_table',
            objName: tableName,
            locator: locatorTuple,
            tableConfig: {
              tableName,
              headers: selHeaders,
              rows: selRows,
              selectedColumns: selectedColumnIndexes,
              selectedRows: selectedBodyRowIndexes,
              data: dataMatrix,
            },
            href: location.href,
          });
        }
      } catch (e) {}
      hide();
    };

    refreshSelectionUi();
    modal.style.display = 'block';
  }

  function hideHoverPreview() {
    try {
      const overlay = document.getElementById('__pw_rec_hover_overlay__');
      const tooltip = document.getElementById('__pw_rec_hover_tooltip__');
      if (overlay) overlay.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    } catch {}
    currentHoverEl = null;
    hoverTooltipText = '';
  }

  function updateHoverHighlight(el) {
    const overlay = document.getElementById('__pw_rec_hover_overlay__');
    if (!overlay || !el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) {
      overlay.style.display = 'none';
      return;
    }
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  function renderHoverTooltip(text, mouseX, mouseY) {
    const tooltip = document.getElementById('__pw_rec_hover_tooltip__');
    if (!tooltip) return;
    tooltip.textContent = text;
    tooltip.style.display = 'block';

    const pad = 12;
    const rect = tooltip.getBoundingClientRect();
    const left = Math.min(mouseX + pad, window.innerWidth - 10 - rect.width);
    const top = Math.min(mouseY + pad, window.innerHeight - 10 - rect.height);
    tooltip.style.left = Math.max(10, left) + 'px';
    tooltip.style.top = Math.max(10, top) + 'px';
  }

  function isHoverIgnored(el) {
    try {
      if (!el || !el.closest) return true;
      if (el.id === '__pw_rec_hover_tooltip__' || el.id === '__pw_rec_hover_overlay__') return true;
      if (el.closest('#pw-recorder-ui-root')) return true;
      if (el.closest('#__pw_recorder_ui__')) return true;
      if (el.closest('#__pw_rec_inspector_panel__')) return true;
      if (el.closest('#__pw_rec_object_inspector_panel__')) return true;
    } catch {}
    return false;
  }

  async function previewHoveredElement(el, mouseX, mouseY) {
    if (!el) return;
    const myReq = ++hoverReqSeq;
    if (!window.pwRecorderHoverPreview) return;

    const markId = uid();
    try {
      el.setAttribute(MARK, markId);
      updateHoverHighlight(el);
      hoverTooltipText = '---------------------------\\nResolving locator...\\n---------------------------';
      renderHoverTooltip(hoverTooltipText, mouseX, mouseY);

      const snapshot = snap(el);
      const resp = await window.pwRecorderHoverPreview({ markId, snapshot });
      if (myReq !== hoverReqSeq) return;
      if (!resp) return;

      const text = [
        '---------------------------',
        'Role: ' + (resp.role || ''),
        'Name: ' + (resp.name || ''),
        'Locator: ' + (resp.locator || ''),
        'Fallback: ' + (resp.fallback || ''),
        '---------------------------',
      ].join('\\n');
      hoverTooltipText = text;
      renderHoverTooltip(hoverTooltipText, mouseX, mouseY);
    } catch {
      // ignore
    } finally {
      try {
        el.removeAttribute(MARK);
      } catch {}
    }
  }

  async function report(kind, el, extra) {
    if (!isRecording || !window.pwRecorderReport) return;
    if (!el || !el.setAttribute) return;

    const mark = uid();
    el.setAttribute(MARK, mark);
    const payload = {
      type: kind,
      markId: mark,
      snapshot: snap(el),
      href: location.href,
      extra: extra || {},
    };
    try {
      await window.pwRecorderReport(payload);
    } finally {
      try { el.removeAttribute(MARK); } catch (e) {}
    }
  }

  document.addEventListener('click', (e) => {
    if (!isRecording || isGenerating) return;
    const raw = e.target;
    if (!raw || !raw.closest) return;
    if (raw.closest('#pw-recorder-ui-root')) return;

    // Interactive validation creation (non-blocking, does not change existing recording behavior)
    try {
      const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement ? raw.parentElement : null;
      if (el && !isHoverIgnored(el)) {
        if (pwRecSuppressTableClickOnce) {
          pwRecSuppressTableClickOnce = false;
          return;
        }
        const panelTbl = document.getElementById('__pw_rec_table_panel__');
        const activeTbl = window.__pw_rec_activeTableEl;
        const maybeTable = el.closest && el.closest('table');
        if (panelTbl && panelTbl.style.display === 'block' && activeTbl && maybeTable === activeTbl) {
          const cell = el.closest && el.closest('td,th');
          if (cell && activeTbl.contains(cell) && window.__pwRecTableCellToggle) {
            window.__pwRecTableCellToggle(cell);
            return;
          }
        }
        const tableEl = el.closest && el.closest('table');
        if (tableEl) {
        const suggested = findNearestTableName(el) || (tableEl.id ? String(tableEl.id) : '');
        const cellText = getVisibleTextFromElement(el);
        showTableClickChooser(e.clientX || 10, e.clientY || 10, cellText, tableEl, suggested);
        } else if (looksLikeTextElement(el)) {
          const t = getVisibleTextFromElement(el);
          if (t && t.length) {
            showTextConfirmTooltip(e.clientX || 10, e.clientY || 10, t);
          }
        }
      }
    } catch (err) {}

    if (raw.tagName === 'INPUT') {
      const t = (raw.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') { void report('checkbox', raw, {}); return; }
      if (t === 'radio') { void report('radio', raw, {}); return; }
      if (t === 'submit' || t === 'button') { void report('click', raw, {}); return; }
    }

    const link = raw.closest && raw.closest('a');
    if (link) { void report('click', link, {}); return; }

    const button = raw.closest && raw.closest('button');
    if (button) { void report('click', button, {}); return; }

    const roleBtn = raw.closest && raw.closest('[role=\"button\"]');
    if (roleBtn) { void report('click', roleBtn, {}); return; }
  }, true);

  document.addEventListener('contextmenu', (e) => {
    if (!isRecording || isGenerating) return;
    const raw = e && e.target;
    const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement ? raw.parentElement : null;
    if (!el) return;
    if (isHoverIgnored(el)) return;
    e.preventDefault();
    const st = getSelectedText();
    const tableElCtx = el.closest && el.closest('table');
    const cellElCtx = el.closest && el.closest('td,th');
    const cellInTable = !!(tableElCtx && cellElCtx && tableElCtx.contains(cellElCtx));
    const cellTextCtx = cellInTable ? cleanInlineText(cellElCtx.innerText || cellElCtx.textContent || '') : '';
    const suggested = findNearestTableName(el) || (tableElCtx && tableElCtx.id ? String(tableElCtx.id) : '');
    showQuickAssertMenu(e.clientX || 10, e.clientY || 10, st, {
      tableEl: tableElCtx || null,
      cellText: cellTextCtx,
      suggestedName: suggested,
    });
  }, true);

  document.addEventListener(
    'mousemove',
    (e) => {
      if (isGenerating) return;
      const raw = e && e.target;
      const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement ? raw.parentElement : null;
      if (!el) return;

      if (isHoverIgnored(el)) {
        if (currentHoverEl) hideHoverPreview();
        return;
      }

      if (el !== currentHoverEl) {
        currentHoverEl = el;
        updateHoverHighlight(el);
        if (window.pwRecorderHoverPreview) {
          previewHoveredElement(el, e.clientX, e.clientY).catch(() => undefined);
        } else {
          hoverTooltipText = '---------------------------\\nResolving locator...\\n---------------------------';
          renderHoverTooltip(hoverTooltipText, e.clientX, e.clientY);
        }
        return;
      }

      updateHoverHighlight(el);
      const text = hoverTooltipText || '---------------------------\\nHover an element...\\n---------------------------';
      renderHoverTooltip(text, e.clientX, e.clientY);
    },
    true,
  );

  document.addEventListener('mouseleave', () => {
    if (currentHoverEl) hideHoverPreview();
  });

  document.addEventListener('input', (e) => {
    if (!isRecording || isGenerating) return;
    const el = e.target;
    if (!el || !el.matches) return;
    if (el.closest && el.closest('#pw-recorder-ui-root')) return;
    if (!el.matches('input, textarea')) return;

    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (['button', 'submit', 'checkbox', 'radio', 'hidden', 'file', 'reset'].includes(t)) return;

    const rect = el.getBoundingClientRect && el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const cs = window.getComputedStyle && window.getComputedStyle(el);
    if (cs && cs.visibility === 'hidden') return;
    void report('input_update', el, { value: el.value });
  }, true);

  document.addEventListener('focusout', (e) => {
    if (!isRecording || isGenerating) return;
    const el = e.target;
    if (!el || !el.matches) return;
    if (el.closest && el.closest('#pw-recorder-ui-root')) return;
    if (!el.matches('input, textarea')) return;

    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (['button', 'submit', 'checkbox', 'radio', 'hidden', 'file', 'reset'].includes(t)) return;

    const rect = el.getBoundingClientRect && el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const cs = window.getComputedStyle && window.getComputedStyle(el);
    if (cs && cs.visibility === 'hidden') return;
    void report('input_blur', el, { value: el.value });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!isRecording || isGenerating) return;
    const el = e.target;
    if (!el || !el.matches) return;
    if (el.closest && el.closest('#pw-recorder-ui-root')) return;
    if (!el.matches('input, textarea')) return;

    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (['button', 'submit', 'checkbox', 'radio', 'hidden', 'file', 'reset'].includes(t)) return;

    if (e.key === 'Enter') {
      const rect = el.getBoundingClientRect && el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const cs = window.getComputedStyle && window.getComputedStyle(el);
      if (cs && cs.visibility === 'hidden') return;
      void report('input_enter', el, { value: el.value });
    }
  }, true);

  document.addEventListener('change', (e) => {
    if (!isRecording || isGenerating) return;
    const el = e.target;
    if (!el || !el.matches || !el.matches('select')) return;
    if (el.closest && el.closest('#pw-recorder-ui-root')) return;
    const rect = el.getBoundingClientRect && el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const cs = window.getComputedStyle && window.getComputedStyle(el);
    if (cs && cs.visibility === 'hidden') return;
    void report('select', el, {});
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUi);
  } else {
    mountUi();
  }
})();
`;
}

function mapPayloadToAction(payload: ReportPayload, resolvedName: string, locator: [string, string]): RecordedAction | null {
  const href = payload.href || '';
  const snap = payload.snapshot || ({} as ElementSnapshot);
  const tag = (snap.tagName || '').toLowerCase();
  const inputType = (snap.type || '').toLowerCase();

  switch (payload.type) {
    case 'click': {
      if (tag === 'a') {
        return {
          type: 'click',
          href,
          element: resolvedName,
          locator,
          controlKind: 'link',
        };
      }
      return {
        type: 'click',
        href,
        element: resolvedName,
        locator,
        controlKind: 'button',
      };
    }
    case 'select': {
      const val = snap.selectedLabel || snap.value || '';
      return {
        type: 'select',
        href,
        element: resolvedName,
        value: val,
        locator,
        controlKind: 'select',
      };
    }
    case 'checkbox':
      return {
        type: 'checkbox',
        href,
        element: resolvedName,
        locator,
        controlKind: 'checkbox',
      };
    case 'radio':
      return {
        type: 'radio',
        href,
        element: resolvedName,
        locator,
        controlKind: 'radio',
      };
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const startUrl = process.argv[2]?.trim() || 'about:blank';
  const scenarioTitle = process.env.RECORDER_SCENARIO || 'User flow';
  const featureName = process.env.RECORDER_FEATURE || 'recorded-flow';
  const resetOnStart = (process.env.RECORDER_RESET_ON_START || 'false').toLowerCase() === 'true';
  const locatorRoot = path.join(ROOT, 'locators');
  let previewPageKey = generatePageKey({ name: featureName }, 0);

  const { browser, context, page } = await launchRecorderBrowser();
  // Keep recorder UI stable: diagnostics should run in a separate tab/page.
  let diagnosePage: any | null = null;
  const getDiagnosePage = async (): Promise<any> => {
    try {
      if (diagnosePage && typeof diagnosePage.isClosed === 'function' && !diagnosePage.isClosed()) return diagnosePage;
    } catch {
      // ignore
    }
    diagnosePage = await context.newPage();
    return diagnosePage;
  };
  const actions: RecordedAction[] = [];
  const capturedApis: CapturedApi[] = [];
  let apiCaptureStop: (() => void) | undefined;
  let captureSelection: 'UI' | 'API' | 'UI+API' = 'UI+API';
  let recorderIsRecording = false;
  let lastUrl = startUrl;
  const debounceMs = Number(process.env.RECORDER_INPUT_DEBOUNCE_MS || '650');

  const shouldRecordUiActions = () => captureSelection === 'UI' || captureSelection === 'UI+API';
  const shouldCaptureApi = () => captureSelection === 'API' || captureSelection === 'UI+API';

  type PendingInputState = {
    element: string;
    latestValue: string;
    locator: [string, string];
    href: string;
    inputKey: string;
  };

  let pendingInput: PendingInputState | null = null;
  let pendingInputTimer: NodeJS.Timeout | null = null;
  let lastFlushedInputKey: string | null = null;

  const elementKey = (name: string): string => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const makeInputKey = (el: string, v: string): string => `${elementKey(el)}|${String(v ?? '')}`;

  let uiSyncTimer: NodeJS.Timeout | null = null;
  let uiSyncForceNext = false;

  const rewriteWebTableStep = (featureText: string): string =>
    String(featureText || '').replace(/When verify "([^"]+)" web table contains/g, 'When verify data from "$1" web table');

  const syncUi = async (forceFeature: boolean): Promise<void> => {
    try {
      const NO_STEPS_TEXT = 'No steps recorded yet...';
      const uiEnabled = shouldRecordUiActions();
      const apiEnabled = shouldCaptureApi();
      const apiSteps = apiEnabled ? generateApiStepsFromCapturedApis(capturedApis) : '';
      const uiFeature =
        uiEnabled && actions.length
          ? rewriteWebTableStep(
              convertToArtifacts(actions, {
                scenarioTitle,
                scenarioUrl: lastUrl,
                featureFile: '__pw_tmp.feature',
                pageKey: previewPageKey,
              }).featureContent,
            )
          : '';

      const featureContent =
        uiFeature && apiSteps
          ? `${uiFeature}\n${apiSteps}\n`
          : uiFeature
            ? uiFeature
            : apiSteps
              ? generateFeatureFromCapturedApis({
                  capturedApis,
                  featureName: 'Auto Generated Test',
                  scenarioName: scenarioTitle,
                })
              : NO_STEPS_TEXT;

      await page.evaluate(
        (payload) => {
          (window as any).__pwRecorderRender?.(payload);
        },
        { featureContent, force: forceFeature },
      );
    } catch {
      // ignore UI sync errors
    }
  };

  const scheduleUiSync = (force: boolean = false): void => {
    if (force) uiSyncForceNext = true;
    if (uiSyncTimer) return;
    const delay = force ? 0 : 120;
    uiSyncTimer = setTimeout(() => {
      uiSyncTimer = null;
      void syncUi(uiSyncForceNext);
      uiSyncForceNext = false;
    }, delay);
  };

  const flushPendingInput = (): void => {
    if (pendingInputTimer) {
      clearTimeout(pendingInputTimer);
      pendingInputTimer = null;
    }
    if (!pendingInput) return;

    const { element, latestValue, locator, href, inputKey } = pendingInput;
    if (lastFlushedInputKey && inputKey === lastFlushedInputKey) {
      pendingInput = null;
      return;
    }

    const action: RecordedAction = {
      type: 'input',
      href,
      element,
      value: latestValue,
      locator,
      controlKind: 'textbox',
    };

    const prev = actions[actions.length - 1];
    if (prev && JSON.stringify(prev) === JSON.stringify(action)) {
      pendingInput = null;
      return;
    }

    actions.push(action);
    lastFlushedInputKey = inputKey;
    pendingInput = null;
    scheduleUiSync();
  };

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const u = frame.url();
      if (u && !u.startsWith('about:blank')) lastUrl = u;
    }
  });

  await page.exposeFunction('pwRecorderReport', async (payload: ReportPayload) => {
    const href = payload.href || lastUrl;

    // If the user selected API-only capture, ignore UI step recording altogether.
    if (!shouldRecordUiActions()) return;

    // Typing: update pending state only; emit ONE final step on debounce/blur/enter/click flush.
    if (payload.type === 'input_update') {
      const resolved = await resolveLocator(page, payload.markId, payload.snapshot);
      const element = capitalizeWords(resolved.name);
      const latestValue = String(payload.extra?.value ?? payload.snapshot.value ?? '');
      const inputKey = makeInputKey(element, latestValue);

      pendingInput = {
        element,
        latestValue,
        locator: resolved.fallback,
        href,
        inputKey,
      };

      if (pendingInputTimer) clearTimeout(pendingInputTimer);
      pendingInputTimer = setTimeout(() => {
        flushPendingInput();
      }, debounceMs);

      return;
    }

    if (payload.type === 'input_blur' || payload.type === 'input_enter') {
      const resolved = await resolveLocator(page, payload.markId, payload.snapshot);
      const element = capitalizeWords(resolved.name);
      const latestValue = String(payload.extra?.value ?? payload.snapshot.value ?? '');
      const inputKey = makeInputKey(element, latestValue);
      if (lastFlushedInputKey && lastFlushedInputKey === inputKey) return;

      pendingInput = {
        element,
        latestValue,
        locator: resolved.fallback,
        href,
        inputKey,
      };

      flushPendingInput();
      return;
    }

    // Non-input actions: flush pending input FIRST (click-before-save rule).
    if (pendingInput) flushPendingInput();

    const resolved = await resolveLocator(page, payload.markId, payload.snapshot);
    const action = mapPayloadToAction(payload, capitalizeWords(resolved.name), resolved.fallback);
    if (!action) return;

    const prev = actions[actions.length - 1];
    if (prev && JSON.stringify(prev) === JSON.stringify(action)) return;
    actions.push(action);
    scheduleUiSync();
  });

  const toSingleQuoted = (s: string): string => {
    const t = String(s ?? '');
    return `'${t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  };

  await page.exposeFunction('pwRecorderHoverPreview', async (payload: HoverPreviewPayload): Promise<HoverPreviewResponse> => {
    const resolved = await resolveLocator(page, payload.markId, payload.snapshot);

    const role =
      resolved.strategy === 'getByRole'
        ? String(resolved.locator)
        : String(payload.snapshot.tagName || payload.snapshot.type || 'element');
    const name = resolved.name || '';
    const fallback = resolved.fallback?.[1] ? String(resolved.fallback[1]) : '';

    let locatorText = '';
    switch (resolved.strategy) {
      case 'getByRole': {
        const roleToTry = String(resolved.locator || 'element');
        const optName = (resolved.options && typeof resolved.options.name === 'string' ? resolved.options.name : '') as string;
        locatorText = `getByRole(${toSingleQuoted(roleToTry)}, { name: ${toSingleQuoted(optName)} })`;
        break;
      }
      case 'getByLabel': {
        const label = (resolved.options && typeof resolved.options.label === 'string' ? resolved.options.label : '') as string;
        const exact = Boolean(resolved.options && (resolved.options as any).exact);
        locatorText = exact ? `getByLabel(${toSingleQuoted(label)}, { exact: true })` : `getByLabel(${toSingleQuoted(label)})`;
        break;
      }
      case 'getByPlaceholder': {
        const ph = (resolved.options && typeof resolved.options.placeholder === 'string' ? resolved.options.placeholder : '') as string;
        const exact = Boolean(resolved.options && (resolved.options as any).exact);
        locatorText = exact ? `getByPlaceholder(${toSingleQuoted(ph)}, { exact: true })` : `getByPlaceholder(${toSingleQuoted(ph)})`;
        break;
      }
      case 'getByText': {
        const text = (resolved.options && typeof (resolved.options as any).text === 'string' ? (resolved.options as any).text : '') as string;
        const exact = Boolean(resolved.options && (resolved.options as any).exact);
        locatorText = exact ? `getByText(${toSingleQuoted(text)}, { exact: true })` : `getByText(${toSingleQuoted(text)})`;
        break;
      }
      case 'xpath':
      default:
        locatorText = `xpath=${toSingleQuoted(fallback)}`;
        break;
    }

    return { role, name, locator: locatorText, fallback };
  });

  await page.exposeFunction('pwRecorderAddAssertion', async (payload: QuickAssertPayload) => {
    try {
      flushPendingInput();
      const href = String(payload?.href || lastUrl || '');
      if (payload.kind === 'text') {
        const t = String(payload.text || '').trim();
        if (!t) return { ok: false };
        actions.push({
          type: 'assert_text',
          href,
          element: 'Text',
          value: t,
          locator: ['xpath', ''],
          controlKind: 'textbox',
        } as any);
        scheduleUiSync(true);
        return { ok: true };
      }
      if (payload.kind === 'web_table') {
        const objName = String(payload.objName || payload.tableConfig?.tableName || '').trim();
        if (!objName) return { ok: false };
        const loc =
          Array.isArray(payload.locator) && payload.locator.length >= 2
            ? ([String(payload.locator[0] || 'xpath'), String(payload.locator[1] || '')] as [string, string])
            : (['xpath', ''] as [string, string]);
        actions.push({
          type: 'assert_web_table',
          href,
          element: objName,
          value: payload.tableConfig ? JSON.stringify(payload.tableConfig) : '',
          locator: loc,
          controlKind: 'textbox',
        } as any);
        scheduleUiSync(true);
        return { ok: true };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  });

  await page.exposeFunction('pwRecorderGetCapturedObjects', async (): Promise<InspectorObjectRow[]> => {
    const out: InspectorObjectRow[] = [];
    const byName = new Map<string, InspectorObjectRow>();

    for (const a of actions) {
      const rawName = capitalizeWords(String((a as any)?.element || '').trim());
      const locator = Array.isArray((a as any)?.locator) ? ((a as any).locator as [string, string]) : ['xpath', ''];
      const strategy = String(locator[0] || '').trim();
      const value = String(locator[1] || '').trim();
      if (!rawName || !strategy || !value) continue;
      const key = rawName.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { element: rawName, locator: [strategy, value] });
      } else if ((!existing.locator[1] || !existing.locator[0]) && strategy && value) {
        existing.locator = [strategy, value];
      }
    }

    for (const v of byName.values()) out.push(v);
    return out;
  });

  await page.exposeFunction(
    'pwRecorderGetCapturedApis',
    async (): Promise<Array<{ index: number; method: string; url: string; fullUrl: string; status: number }>> => {
      return capturedApis.map((c, index) => ({
        index,
        method: String(c.method || ''),
        url: String(c.url || ''),
        fullUrl: String(c.fullUrl || ''),
        status: Number(c.status ?? 0),
      }));
    },
  );

  await page.exposeFunction('pwRecorderDeleteCapturedApi', async (args?: { index?: number }) => {
    const idx = Number(args?.index);
    if (!Number.isFinite(idx) || idx < 0 || idx >= capturedApis.length) return { ok: false };
    capturedApis.splice(idx, 1);
    scheduleUiSync(true);
    return { ok: true };
  });

  await page.exposeFunction(
    'pwRecorderGenerateInspectorYaml',
    async (payload?: { fileName?: string; objects?: Array<{ element?: string; locator?: [string, string] }> }) => {
      try {
        const rawFile = String(payload?.fileName || featureName || 'recordedflow').trim() || 'recordedflow';
        const fileNameSafe = rawFile.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '') || 'recordedflow';
        const rows = Array.isArray(payload?.objects) ? payload!.objects! : [];

        const map = new Map<string, { name: string; strategy: string; value: string }>();
        for (const row of rows) {
          const name = capitalizeWords(String(row?.element || '').trim());
          const strategy = String((row?.locator && row.locator[0]) || '').trim();
          const value = String((row?.locator && row.locator[1]) || '').trim();
          if (!name || !strategy || !value) continue;
          const key = name.toLowerCase();
          if (!map.has(key)) map.set(key, { name, strategy, value });
        }

        const lines: string[] = [];
        for (const v of map.values()) {
          const name = String(v.name || '').trim();
          const strategy = String(v.strategy || '').trim();
          const value = String(v.value || '').trim();
          if (!name || !strategy || !value) continue;
          lines.push(`${name}:`);
          lines.push(`  - ${strategy}`);
          lines.push(`  - ${value}`);
          lines.push('');
        }

        const generatedDir = path.join(ROOT, 'locators', 'generated');
        ensureDir(generatedDir);
        const outPath = path.join(generatedDir, `${fileNameSafe}.yaml`);
        const yamlBody = lines.length ? `${lines.join('\n')}\n` : '';
        fs.writeFileSync(outPath, yamlBody, 'utf8');
        return { ok: true, path: path.relative(ROOT, outPath).replace(/\\/g, '/') };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  await page.exposeFunction(
    'pwRecorderGenerate',
    async (args?: { featureText?: string; useEdited?: boolean; fileName?: string }) => {
    const uiEnabled = shouldRecordUiActions();
    const apiEnabled = shouldCaptureApi();
    const apiSteps = apiEnabled ? generateApiStepsFromCapturedApis(capturedApis) : '';

    // Stop network capture during feature generation to keep output stable.
    apiCaptureStop?.();
    apiCaptureStop = undefined;
    recorderIsRecording = false;

    if (uiEnabled) flushPendingInput();

    const hasAnyUi = uiEnabled && actions.length > 0;
    const hasAnyApi = apiEnabled && apiSteps.trim().length > 0;
    if (!hasAnyUi && !hasAnyApi) {
      await page.evaluate(() => alert('No steps recorded'));
      return { ok: false, message: 'No steps recorded' };
    }

    const featureDir = path.join(ROOT, 'generated');
    ensureDir(featureDir);

    const rawFile = String(args?.fileName || featureName || 'recorded-flow').trim() || 'recorded-flow';
    const pageKey = generatePageKey({ stepName: rawFile }, 0);
    previewPageKey = pageKey;

    const featurePath = path.join(featureDir, `${pageKey}.feature`);
    const pagesYamlPath = resolvePagesYamlPath(locatorRoot);
    const pageLocatorPath = resolvePageLocatorPath(pageKey, locatorRoot);

    const websiteTitle = await page.title().catch(() => '');
    const artifact = uiEnabled
      ? convertToArtifacts(actions, {
          scenarioTitle,
          scenarioUrl: lastUrl,
          featureFile: featurePath,
          pageKey,
          pageStepInput: { title: websiteTitle },
        })
      : undefined;

    try {
      const shouldUseEdited = !!(args && args.useEdited);
      const overrideText = shouldUseEdited && typeof args?.featureText === 'string' ? args.featureText : '';
      let featureToWrite = overrideText.trim().length ? overrideText : '';

      if (!featureToWrite) {
        if (uiEnabled && artifact) {
          featureToWrite = rewriteWebTableStep(artifact.featureContent);
          if (apiSteps.trim().length) featureToWrite = `${featureToWrite}\n${apiSteps}\n`;
        } else if (apiSteps.trim().length) {
          featureToWrite = generateFeatureFromCapturedApis({
            capturedApis,
            featureName: 'Auto Generated Test',
            scenarioName: scenarioTitle,
          });
        } else {
          featureToWrite = rewriteWebTableStep(artifact?.featureContent || '');
        }
      }
      fs.writeFileSync(featurePath, featureToWrite, 'utf8');

      if (uiEnabled && artifact?.pageKey && artifact.pageMeta) {
        ensureDir(path.dirname(pagesYamlPath));
        registerPage(pagesYamlPath, artifact.pageKey, artifact.pageMeta.title, artifact.pageMeta.label);
        writePageLocatorsYaml(pageLocatorPath, artifact.locatorMap);
      }

      const sessionPath = path.join(ROOT, 'recorded-session.json');
      fs.writeFileSync(
        sessionPath,
        JSON.stringify(
          {
            actions,
            lastUrl,
            lastTitle: websiteTitle,
            scenarioTitle,
            featureName: pageKey,
            pageKey,
            savedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );

      const featureRel = path.relative(ROOT, featurePath).replace(/\\/g, '/');
      const pagesRel = path.relative(ROOT, pagesYamlPath).replace(/\\/g, '/');
      const pageLocRel = path.relative(ROOT, pageLocatorPath).replace(/\\/g, '/');
      const message =
        `✅ Files generated successfully!\\nFeature: ${featureRel}\\nPages: ${pagesRel}\\nPage locators: ${pageLocRel}`;

      // eslint-disable-next-line no-console
      console.log(message);

      await page.evaluate((msg) => alert(msg), message);

      // Clear actions ONLY after successful write.
      actions.splice(0, actions.length);
      if (apiEnabled) capturedApis.splice(0, capturedApis.length);
      lastFlushedInputKey = null;
      pendingInput = null;
      if (pendingInputTimer) {
        clearTimeout(pendingInputTimer);
        pendingInputTimer = null;
      }

      scheduleUiSync(true);
      return { ok: true, featurePath, featureRel, pagesRel, pageLocRel };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      await page.evaluate(() => alert('Generation failed — see terminal for details'));
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    },
  );

  await context.addInitScript(getInjectScript(resetOnStart));

  await page.exposeFunction('pwRecorderSetCaptureSelection', (value: string) => {
    const normalized = String(value || '').trim().toUpperCase();
    const allowed = ['UI', 'API', 'UI+API'];
    if (!allowed.includes(normalized)) return { ok: false, message: 'Invalid capture selection' };

    const prevSelection = captureSelection;
    captureSelection = normalized as typeof captureSelection;

    const prevShouldCaptureApi = prevSelection === 'API' || prevSelection === 'UI+API';
    const nowShouldCaptureApi = shouldCaptureApi();

    if (recorderIsRecording) {
      // Keep API-only feature deterministic when the user flips into API capture.
      if (nowShouldCaptureApi && !prevShouldCaptureApi) capturedApis.splice(0, capturedApis.length);

      if (nowShouldCaptureApi) {
        apiCaptureStop?.();
        apiCaptureStop = attachApiCapture(page, capturedApis, { onCaptured: () => scheduleUiSync(true) }).stop;
      } else {
        apiCaptureStop?.();
        apiCaptureStop = undefined;
      }

      if (!shouldRecordUiActions()) {
        pendingInput = null;
        lastFlushedInputKey = null;
        if (pendingInputTimer) {
          clearTimeout(pendingInputTimer);
          pendingInputTimer = null;
        }
      }
    }

    scheduleUiSync(true);
    return { ok: true, captureSelection };
  });

  await page.exposeFunction('pwRecorderSetRecording', (value: boolean, reset?: boolean) => {
    recorderIsRecording = !!value;

    // Start: optionally reset previous session actions.
    if (value === true && reset) {
      actions.splice(0, actions.length);
      pendingInput = null;
      lastFlushedInputKey = null;
      if (pendingInputTimer) {
        clearTimeout(pendingInputTimer);
        pendingInputTimer = null;
      }
      if (shouldCaptureApi()) capturedApis.splice(0, capturedApis.length);

      scheduleUiSync(false);
    }

    if (value === true) {
      // Start capture based on user selection.
      if (shouldCaptureApi()) {
        apiCaptureStop?.();
        apiCaptureStop = attachApiCapture(page, capturedApis, { onCaptured: () => scheduleUiSync(true) }).stop;
      } else {
        apiCaptureStop?.();
        apiCaptureStop = undefined;
      }
    }

    // Stop: flush any pending input so the final value isn't lost.
    if (value === false) {
      if (shouldRecordUiActions()) flushPendingInput();
      apiCaptureStop?.();
      apiCaptureStop = undefined;
    }

    return { recording: !!value };
  });

  await page.exposeFunction('pwRecorderAiFixListBundles', (): AiFixBundleRow[] => {
    return listAiFixBundles();
  });

  await page.exposeFunction(
    'pwRecorderAiFixGenerate',
    async (args?: { id?: string; userProblem?: string }): Promise<{ output: string; model: string }> => {
      const id = String(args?.id || '').trim();
      if (!id) throw new Error('Missing bundle id');
      const bundlePath = path.join(AI_FIX_DIR, id);
      if (!bundlePath.startsWith(AI_FIX_DIR) || !fs.existsSync(bundlePath)) throw new Error('Bundle not found');

      const bundle = safeReadJsonFile<any>(bundlePath);
      const markdownPath = String(bundle.markdownPath || '');
      if (!markdownPath || !fs.existsSync(markdownPath)) throw new Error('Missing markdown bundle file');
      const markdown = fs.readFileSync(markdownPath, 'utf8');
      const prompt = buildAiFixUiPrompt(markdown, String(args?.userProblem || ''));
      const output = await ollamaGenerate({ model: ollamaModel(), prompt });

      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        ensureDir(AI_FIX_DIR);
        fs.writeFileSync(path.join(AI_FIX_DIR, `recorder-${stamp}-${id}.llm.txt`), output, 'utf8');
      } catch {
        // ignore
      }

      return { output, model: ollamaModel() };
    },
  );

  await page.exposeFunction(
    'pwRecorderAiFixGenerateFromUpload',
    async (args?: {
      userProblem?: string;
      files?: Array<{ name?: string; content?: string }>;
    }): Promise<{ output: string; model: string }> => {
      const userProblem = String(args?.userProblem || '');
      const files = Array.isArray(args?.files) ? args!.files : [];
      if (!files.length) throw new Error('No uploaded files provided');

      const normalized = files
        .map((f, idx) => ({
          name: String(f?.name || `file_${idx}`),
          content: String(f?.content || ''),
        }))
        .filter((f) => f.content.trim().length > 0);
      if (!normalized.length) throw new Error('Uploaded files are empty');

      const bundle = [
        'Uploaded files:',
        ...normalized.map((f) => `- ${f.name}`),
        '',
        ...normalized.flatMap((f) => [
          `### ${f.name}`,
          '```',
          f.content,
          '```',
          '',
        ]),
      ].join('\n');

      const prompt = buildAiFixUiPrompt(bundle, userProblem);
      const output = await ollamaGenerate({ model: ollamaModel(), prompt });
      return { output, model: ollamaModel() };
    },
  );

  await page.exposeFunction(
    'pwRecorderAiFixDiagnoseFromUpload',
    async (args?: {
      userProblem?: string;
      files?: Array<{ name?: string; content?: string }>;
    }): Promise<{ output: string; model: string }> => {
      const userProblem = String(args?.userProblem || '');
      const files = Array.isArray(args?.files) ? args!.files : [];
      if (!files.length) throw new Error('No uploaded files provided');

      const normalized: Array<{ name: string; content: string }> = files
        .map((f, idx) => ({
          name: String(f?.name || `file_${idx}`),
          content: String(f?.content || ''),
        }))
        .filter((f) => f.content.trim().length > 0);
      if (!normalized.length) throw new Error('Uploaded files are empty');

      const featureFile = normalized.find((f) => f.name.toLowerCase().endsWith('.feature'));
      if (!featureFile) throw new Error('Upload must include a .feature file');

      const yamlFiles = normalized.filter((f) => f.name.toLowerCase().endsWith('.yaml') || f.name.toLowerCase().endsWith('.yml'));
      const { url: targetUrl, screen } = parseFeatureForUrlAndScreen(featureFile.content);
      if (!targetUrl) throw new Error('Feature must include: Given User navigates to "<url>" URL');

      // Try to pick a page YAML and common YAML from uploads (best-effort by name).
      let pageYamlText = '';
      let commonYamlText = '';
      for (const yf of yamlFiles) {
        const n = yf.name.toLowerCase();
        if (!commonYamlText && n.includes('common')) commonYamlText = yf.content;
        else if (!pageYamlText) pageYamlText = yf.content;
      }

      // IMPORTANT: do NOT navigate the recorder UI page (it would wipe uploads/panel).
      // Use a separate tab/page for diagnosis so the UI stays intact.
      const diag = await getDiagnosePage();
      await diag.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => undefined);

      let aria = '';
      try {
        aria = await diag.locator('body').ariaSnapshot({ timeout: 15000 });
      } catch (e) {
        aria = `(aria snapshot failed: ${e instanceof Error ? e.message : String(e)})`;
      }

      // Try to detect failing locators (best-effort).
      const elementNames = collectQuotedElementNames(featureFile.content);
      let pageLocs: Record<string, [string, string]> = {};
      let commonLocs: Record<string, [string, string]> = {};
      try { if (pageYamlText) pageLocs = parseLocatorYaml(pageYamlText); } catch {}
      try { if (commonYamlText) commonLocs = parseLocatorYaml(commonYamlText); } catch {}

      const failures: Array<{ name: string; selector?: string; reason: string }> = [];
      for (const name of elementNames.slice(0, 40)) {
        const tuple = pageLocs[name] || commonLocs[name];
        if (!tuple) {
          failures.push({ name, reason: 'No locator entry found for this name in uploaded YAML.' });
          continue;
        }
        const { selectorText } = locatorFromTuple(tuple);
        try {
          const loc = diag.locator(selectorText);
          await loc.first().waitFor({ state: 'visible', timeout: 2000 });
        } catch (e) {
          failures.push({ name, selector: selectorText, reason: e instanceof Error ? e.message : String(e) });
        }
      }

      // Optional screenshot path written into test-results/ai-fix/
      let screenshotPath = '';
      try {
        ensureDir(AI_FIX_DIR);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        screenshotPath = path.join(AI_FIX_DIR, `diagnose-${stamp}.png`);
        await diag.screenshot({ path: screenshotPath, fullPage: false });
      } catch {
        screenshotPath = '';
      }

      const bundle = [
        'Diagnose mode (browser-assisted)',
        '',
        'Target URL:',
        targetUrl,
        '',
        'Screen (from feature):',
        screen || '(not provided)',
        '',
        'User described change:',
        userProblem || '(none provided)',
        '',
        'Uploaded feature:',
        '```',
        featureFile.content,
        '```',
        '',
        'Uploaded page locators YAML (best-effort):',
        '```',
        pageYamlText || '(none)',
        '```',
        '',
        'Uploaded common locators YAML (best-effort):',
        '```',
        commonYamlText || '(none)',
        '```',
        '',
        'Detected locator problems (best-effort):',
        '```json',
        JSON.stringify(failures, null, 2),
        '```',
        '',
        'Screenshot path (if saved):',
        screenshotPath || '(not saved)',
        '',
        'ARIA snapshot:',
        '```yaml',
        aria || '(empty)',
        '```',
      ].join('\n');

      const prompt = buildAiFixUiPrompt(bundle, userProblem);
      const output = await ollamaGenerate({ model: ollamaModel(), prompt });
      return { output, model: ollamaModel() };
    },
  );

  await page.exposeFunction(
    'pwRecorderAiFixApply',
    async (args?: { id?: string; userProblem?: string }): Promise<{ output: string; model: string }> => {
      const id = String(args?.id || '').trim();
      if (!id) throw new Error('Missing bundle id');
      const bundlePath = path.join(AI_FIX_DIR, id);
      if (!bundlePath.startsWith(AI_FIX_DIR) || !fs.existsSync(bundlePath)) throw new Error('Bundle not found');
      const bundle = safeReadJsonFile<any>(bundlePath);

      const markdownPath = String(bundle.markdownPath || '');
      if (!markdownPath || !fs.existsSync(markdownPath)) throw new Error('Missing markdown bundle file');
      const markdown = fs.readFileSync(markdownPath, 'utf8');
      const prompt = buildAiFixUiPrompt(markdown, String(args?.userProblem || ''));
      const output = await ollamaGenerate({ model: ollamaModel(), prompt });

      const feature = betweenTags(output, '<FEATURE_FILE>', '</FEATURE_FILE>');
      const pageYaml = betweenTags(output, '<PAGE_LOCATORS_YAML>', '</PAGE_LOCATORS_YAML>');
      const commonYaml = betweenTags(output, '<COMMON_LOCATORS_YAML>', '</COMMON_LOCATORS_YAML>');
      if (!feature) throw new Error('LLM output missing <FEATURE_FILE> section');

      const featurePath = String(bundle.featurePath || '');
      if (!featurePath) throw new Error('Bundle missing featurePath');
      backupAndWriteFile(featurePath, feature);

      if (pageYaml && bundle.pageYamlPath) backupAndWriteFile(String(bundle.pageYamlPath), pageYaml);
      if (commonYaml && bundle.commonYamlPath) backupAndWriteFile(String(bundle.commonYamlPath), commonYaml);

      return { output, model: ollamaModel() };
    },
  );
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await page.evaluate(getInjectScript(resetOnStart)).catch(() => undefined);

  await new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
  });

  await shutdownBrowser({ browser, context, page });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
