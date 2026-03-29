/**
 * Custom recorder: Chromium + injected capture script + Playwright-backed selector resolution.
 * Does not launch Playwright codegen or inspector UI.
 */
import * as fs from 'fs';
import * as path from 'path';
import { launchRecorderBrowser, shutdownBrowser } from './browser';
import { MARK_ATTR, resolveLocator, type ElementSnapshot } from './selectorEngine';
import { capitalizeWords, convertToArtifacts, type RecordedAction } from './converter';
import {
  generatePageKey,
  registerPage,
  resolvePageLocatorPath,
  resolvePagesYamlPath,
  writePageLocatorsYaml,
} from './pageRegistry';

const ROOT = path.resolve(__dirname, '..');

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
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
  /** Structured table verification config (headers + rows) */
  tableConfig?: { tableName?: string; headers?: string[]; rows?: string[][] };
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
    wrapper.appendChild(root);

    const panel = document.createElement('div');
    panel.id = '__pw_rec_inspector_panel__';
    panel.setAttribute(
      'style',
      [
        'position:fixed',
        'top:0',
        'right:0',
        'width:400px',
        'height:100vh',
        'z-index:2147483647',
        'background:rgba(2,6,23,0.92)',
        'border-left:1px solid rgba(148,163,184,0.35)',
        'box-sizing:border-box',
        'padding:12px',
        'overflow:auto',
        'display:none',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif',
      ].join(';'),
    );

    const panelHeader = document.createElement('div');
    panelHeader.setAttribute('style', ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:10px'].join(';'));

    const panelTitle = document.createElement('div');
    panelTitle.textContent = 'Feature (Editable)';
    panelTitle.setAttribute('style', ['font-weight:800', 'font-size:13px', 'color:#e5e7eb'].join(';'));

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
        'height:calc(100vh - 70px)',
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
    panel.appendChild(featureEditor);
    wrapper.appendChild(panel);

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
        'top:64px',
        'left:50%',
        'transform:translateX(-50%)',
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
    objectPanelHeader.setAttribute('style', ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:10px', 'margin-bottom:10px'].join(';'));
    const objectPanelTitle = document.createElement('div');
    objectPanelTitle.textContent = 'Captured Objects';
    objectPanelTitle.setAttribute('style', ['font-weight:800', 'font-size:13px', 'color:#e5e7eb'].join(';'));
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

    const title = document.createElement('div');
    title.textContent = 'Quick Verify';
    title.setAttribute('style', ['font-weight:800', 'font-size:12px', 'color:#e5e7eb', 'margin:2px 6px 8px'].join(';'));
    menu.appendChild(title);

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

    const btnText = mkBtn('Verify selected text');
    btnText.id = '__pw_rec_quick_assert_text__';
    const btnTable = mkBtn('Verify web table (requires id)');
    btnTable.id = '__pw_rec_quick_assert_table__';
    const btnClose = mkBtn('Close');
    btnClose.id = '__pw_rec_quick_assert_close__';

    menu.appendChild(btnText);
    menu.appendChild(btnTable);
    menu.appendChild(btnClose);
    const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
    uiRoot.appendChild(menu);

    const hide = () => { try { menu.style.display = 'none'; } catch (e) {} };
    btnClose.addEventListener('click', hide);
    document.addEventListener('click', (e) => {
      if (!menu || menu.style.display === 'none') return;
      const t = e && e.target;
      if (t && (t === menu || (t.closest && t.closest('#__pw_rec_quick_assert__')))) return;
      hide();
    }, true);
  }

  function showQuickAssertMenu(x, y, selectedText, tableName) {
    ensureQuickAssertMenu();
    const menu = document.getElementById('__pw_rec_quick_assert__');
    if (!menu) return;
    const btnText = document.getElementById('__pw_rec_quick_assert_text__');
    const btnTable = document.getElementById('__pw_rec_quick_assert_table__');
    const btnClose = document.getElementById('__pw_rec_quick_assert_close__');

    const st = String(selectedText || '').trim();
    const tn = String(tableName || '').trim();

    if (btnText) btnText.disabled = !(st && st.length);
    if (btnTable) btnTable.disabled = !(tn && tn.length);

    if (btnText) {
      btnText.onclick = async () => {
        try {
          if (window.pwRecorderAddAssertion) await window.pwRecorderAddAssertion({ kind: 'text', text: st, href: location.href });
        } catch (e) {}
        menu.style.display = 'none';
      };
    }

    if (btnTable) {
      btnTable.onclick = async () => {
        try {
          if (window.pwRecorderAddAssertion) await window.pwRecorderAddAssertion({ kind: 'web_table', objName: tn, href: location.href });
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
        'max-width:340px',
        'padding:10px',
        'border-radius:12px',
        'background:rgba(2,6,23,0.95)',
        'border:1px solid rgba(148,163,184,0.25)',
        'box-shadow:0 10px 30px rgba(0,0,0,0.35)',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif',
        'color:#e5e7eb',
      ].join(';'),
    );

    const msg = document.createElement('div');
    msg.id = '__pw_rec_text_confirm_msg__';
    msg.setAttribute('style', ['font-weight:800', 'font-size:12px', 'margin-bottom:8px'].join(';'));
    msg.textContent = 'Add verification for this text?';

    const preview = document.createElement('div');
    preview.id = '__pw_rec_text_confirm_preview__';
    preview.setAttribute('style', ['font-size:12px', 'opacity:0.92', 'margin-bottom:10px', 'white-space:pre-wrap'].join(';'));

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

    tip.appendChild(msg);
    tip.appendChild(preview);
    tip.appendChild(row);

    const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
    uiRoot.appendChild(tip);
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
        'left:50%',
        'transform:translateX(-50%)',
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
      ].join(';'),
    );

    const title = document.createElement('div');
    title.textContent = 'Web Table Verification';
    title.setAttribute('style', ['font-weight:900', 'font-size:18px', 'margin-bottom:10px'].join(';'));

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

    const selectorsWrap = document.createElement('div');
    selectorsWrap.setAttribute('style', ['display:grid', 'grid-template-columns:1fr 1fr', 'gap:12px', 'margin-top:8px'].join(';'));

    const makeBox = (headingText, listId) => {
      const box = document.createElement('div');
      box.setAttribute('style', ['border:1px solid rgba(0,0,0,0.12)', 'border-radius:12px', 'padding:10px', 'min-height:180px'].join(';'));
      const heading = document.createElement('div');
      heading.textContent = headingText;
      heading.setAttribute('style', ['font-weight:900', 'font-size:13px', 'margin-bottom:8px'].join(';'));
      const list = document.createElement('div');
      list.id = listId;
      list.setAttribute('style', ['display:flex', 'flex-direction:column', 'gap:6px', 'max-height:260px', 'overflow:auto'].join(';'));
      box.appendChild(heading);
      box.appendChild(list);
      return box;
    };

    const colBox = makeBox('Column Selection (required)', '__pw_rec_table_cols__');
    const rowBox = makeBox('Row Selection (required)', '__pw_rec_table_rows__');
    selectorsWrap.appendChild(colBox);
    selectorsWrap.appendChild(rowBox);

    const previewTitle = document.createElement('div');
    previewTitle.textContent = 'Gherkin Preview';
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
    const saveBtn = makeBtn('Save');
    saveBtn.id = '__pw_rec_table_confirm__';
    const resetBtn = makeBtn('Reset');
    resetBtn.id = '__pw_rec_table_reset__';
    const cancelBtn = makeBtn('Cancel');
    cancelBtn.id = '__pw_rec_table_cancel__';
    actions.appendChild(cancelBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(saveBtn);

    panel.appendChild(title);
    panel.appendChild(error);
    panel.appendChild(nameRow);
    panel.appendChild(selectorsWrap);
    panel.appendChild(previewTitle);
    panel.appendChild(preview);
    panel.appendChild(actions);

    const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
    uiRoot.appendChild(panel);
  }

  function openTableConfigModal(tableEl, suggestedName) {
    ensureTableConfigPanel();
    const modal = document.getElementById('__pw_rec_table_panel__');
    const nameInput = document.getElementById('__pw_rec_table_name__');
    const error = document.getElementById('__pw_rec_table_error__');
    const colList = document.getElementById('__pw_rec_table_cols__');
    const rowList = document.getElementById('__pw_rec_table_rows__');
    const preview = document.getElementById('__pw_rec_table_preview__');
    const confirm = document.getElementById('__pw_rec_table_confirm__');
    const reset = document.getElementById('__pw_rec_table_reset__');
    const cancel = document.getElementById('__pw_rec_table_cancel__');
    if (!modal || !nameInput || !error || !colList || !rowList || !preview || !confirm || !reset || !cancel) return;

    const tableData = extractTableData(tableEl);
    const headers = Array.isArray(tableData.headers) ? tableData.headers : [];
    const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
    const selectedCols = new Set();
    const selectedRows = new Set();

    nameInput.value = String(suggestedName || '').trim() || String((tableEl && tableEl.id) || '').trim() || '';
    error.style.display = 'none';
    error.textContent = '';

    const hide = () => {
      modal.style.display = 'none';
    };
    cancel.onclick = hide;

    const selectedIndicesSorted = (setObj) =>
      Array.from(setObj)
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);

    const getSelectedProjection = () => {
      const colIdx = selectedIndicesSorted(selectedCols);
      const rowIdx = selectedIndicesSorted(selectedRows);
      const selHeaders = colIdx.map((i) => headers[i]).filter((h) => h !== undefined);
      const selRowsRaw = rowIdx.map((ri) => {
        const row = rows[ri] || [];
        return colIdx.map((ci) => normalizeTableCellText(row[ci] !== undefined ? row[ci] : ''));
      });
      const normalizedHeaders = selHeaders.map((h) => normalizeTableCellText(h));
      const selRows = selRowsRaw.filter((row) => {
        if (row.length !== normalizedHeaders.length) return true;
        for (let i = 0; i < normalizedHeaders.length; i++) {
          if (normalizeTableCellText(row[i] ?? '') !== normalizeTableCellText(normalizedHeaders[i] ?? '')) return true;
        }
        return false;
      });
      return { colIdx, rowIdx, selHeaders, selRows };
    };

    const renderPreview = () => {
      const tableName = String(nameInput.value || '').trim();
      const { selHeaders, selRows } = getSelectedProjection();
      const pipe = (cells) => '| ' + cells.map((c) => String(c ?? '')).join(' | ') + ' |';
      const lines = [];
      lines.push('When verify data from "' + (tableName || 'TableName') + '" web table');
      if (selHeaders.length) {
        lines.push('  ' + pipe(selHeaders));
        for (const row of selRows) lines.push('  ' + pipe(row));
      }
      preview.textContent = lines.join('\\n');
    };

    const mkCheckRow = (id, label, onToggle) => {
      const row = document.createElement('label');
      row.setAttribute('style', ['display:flex', 'align-items:center', 'gap:8px', 'font-size:12px', 'cursor:pointer'].join(';'));
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = String(id);
      cb.addEventListener('change', () => onToggle(cb.checked));
      const txt = document.createElement('span');
      txt.textContent = label;
      row.appendChild(cb);
      row.appendChild(txt);
      return row;
    };

    colList.innerHTML = '';
    rowList.innerHTML = '';

    if (!headers.length || !rows.length) {
      const msg = document.createElement('div');
      msg.textContent = 'No data found';
      msg.setAttribute('style', ['font-size:12px', 'font-weight:800', 'color:#64748b'].join(';'));
      colList.appendChild(msg.cloneNode(true));
      rowList.appendChild(msg);
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

    for (let i = 0; i < headers.length; i++) {
      const item = mkCheckRow(i, String(headers[i] || ('Column ' + String(i + 1))), (checked) => {
        if (checked) selectedCols.add(String(i));
        else selectedCols.delete(String(i));
        error.style.display = 'none';
        renderPreview();
      });
      colList.appendChild(item);
    }

    for (let i = 0; i < rows.length; i++) {
      const item = mkCheckRow(i, 'Row ' + String(i + 1), (checked) => {
        if (checked) selectedRows.add(String(i));
        else selectedRows.delete(String(i));
        error.style.display = 'none';
        renderPreview();
      });
      rowList.appendChild(item);
    }

    reset.onclick = () => {
      selectedCols.clear();
      selectedRows.clear();
      const cbs = modal.querySelectorAll('input[type="checkbox"]');
      for (let i = 0; i < cbs.length; i++) {
        const cb = cbs[i];
        cb.checked = false;
      }
      error.style.display = 'none';
      renderPreview();
    };

    nameInput.oninput = () => {
      error.style.display = 'none';
      renderPreview();
    };

    confirm.onclick = async () => {
      const tableName = String(nameInput.value || '').trim();
      const { selHeaders, selRows } = getSelectedProjection();

      if (!tableName) {
        error.textContent = 'Table name is required.';
        error.style.display = 'block';
        return;
      }
      if (!selHeaders.length) {
        error.textContent = 'Select at least 1 column.';
        error.style.display = 'block';
        return;
      }
      if (!selRows.length) {
        error.textContent = 'Select at least 1 row.';
        error.style.display = 'block';
        return;
      }

      try {
        if (window.pwRecorderAddAssertion) {
          await window.pwRecorderAddAssertion({
            kind: 'web_table',
            objName: tableName,
            tableConfig: { tableName, headers: selHeaders, rows: selRows },
            href: location.href,
          });
        }
      } catch (e) {}
      hide();
    };

    renderPreview();
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
    const tn = findNearestTableName(el);
    showQuickAssertMenu(e.clientX || 10, e.clientY || 10, st, tn);
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
  const actions: RecordedAction[] = [];
  let lastUrl = startUrl;
  const debounceMs = Number(process.env.RECORDER_INPUT_DEBOUNCE_MS || '650');

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
      const featureContent =
        actions.length === 0
          ? NO_STEPS_TEXT
          : rewriteWebTableStep(convertToArtifacts(actions, {
              scenarioTitle,
              scenarioUrl: lastUrl,
              featureFile: '__pw_tmp.feature',
              pageKey: previewPageKey,
            }).featureContent);

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
        actions.push({
          type: 'assert_web_table',
          href,
          element: objName,
          value: payload.tableConfig ? JSON.stringify(payload.tableConfig) : '',
          locator: ['xpath', ''],
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
    flushPendingInput();

    if (actions.length === 0) {
      await page.evaluate(() => alert('No actions recorded'));
      return { ok: false, message: 'No actions recorded' };
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
    const artifact = convertToArtifacts(actions, {
      scenarioTitle,
      scenarioUrl: lastUrl,
      featureFile: featurePath,
      pageKey,
      pageStepInput: { title: websiteTitle },
    });

    try {
      const shouldUseEdited = !!(args && args.useEdited);
      const overrideText = shouldUseEdited && typeof args?.featureText === 'string' ? args.featureText : '';
      const featureToWrite = overrideText.trim().length ? overrideText : rewriteWebTableStep(artifact.featureContent);
      fs.writeFileSync(featurePath, featureToWrite, 'utf8');

      if (artifact.pageKey && artifact.pageMeta) {
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
  await page.exposeFunction('pwRecorderSetRecording', (value: boolean, reset?: boolean) => {
    // Start: optionally reset previous session actions.
    if (value === true && reset) {
      actions.splice(0, actions.length);
      pendingInput = null;
      lastFlushedInputKey = null;
      if (pendingInputTimer) {
        clearTimeout(pendingInputTimer);
        pendingInputTimer = null;
      }
      scheduleUiSync(false);
    }

    // Stop: flush any pending input so the final value isn't lost.
    if (value === false) {
      flushPendingInput();
    }

    return { recording: !!value };
  });
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
