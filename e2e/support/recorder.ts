/**
 * Custom recorder: Chromium + injected capture script + Playwright-backed selector resolution.
 * Does not launch Playwright codegen or inspector UI.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { launchRecorderBrowser, shutdownBrowser } from './browser';
import { MARK_ATTR, resolveLocator, type ElementSnapshot } from './selectorEngine';
import { capitalizeWords, convertToArtifacts, convertToInterleavedArtifacts, type RecordedAction } from './converter';
import { attachApiCapture, type CapturedApi } from './capture';
import { apiEventsFromCaptured, generateApiStepsFromCapturedApis, generateFeatureFromCapturedApis } from './formatter';
import {
  generatePageKey,
  loadYamlRecord,
  registerPage,
  resolvePageLocatorPath,
  resolvePagesYamlPath,
  writePageLocatorsYaml,
} from './pageRegistry';
import {
  classifyFeature,
  commonFilePath,
  ensureCategoryDirs,
  featureFilePath,
  findLocatorFile,
  locatorFilePath,
  type FeatureCategory,
} from './featurePaths';

// Resolve against the caller's project root (cwd), not this package's own
// location — the recorder may run in-place or installed under node_modules.
const ROOT = process.cwd();



function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function safeReadJsonFile<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
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

type DiffOp =
  | { type: 'equal'; lines: string[] }
  | { type: 'delete'; lines: string[] }
  | { type: 'insert'; lines: string[] };

function splitLinesKeepLastEmpty(text: string): string[] {
  // Keep trailing newline semantics stable for diffs.
  const t = String(text ?? '');
  const lines = t.split(/\r?\n/);
  // If text ends with newline, split() creates a last empty line; keep it.
  // If not, keep as-is.
  return lines;
}

function myersDiffLines(aText: string, bText: string): DiffOp[] {
  const a = splitLinesKeepLastEmpty(aText);
  const b = splitLinesKeepLastEmpty(bText);
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const kIndex = offset + k;
      const down = k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1]);
      let x = down ? v[kIndex + 1] : v[kIndex - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[kIndex] = x;
      if (x >= n && y >= m) {
        return backtrackMyers(a, b, trace, d, offset);
      }
    }
  }
  return [{ type: 'delete', lines: a }, { type: 'insert', lines: b }];
}

function backtrackMyers(a: string[], b: string[], trace: number[][], dFinal: number, offset: number): DiffOp[] {
  let x = a.length;
  let y = b.length;
  const ops: Array<{ type: 'equal' | 'delete' | 'insert'; line: string }> = [];

  for (let d = dFinal; d > 0; d--) {
    const v = trace[d - 1];
    const k = x - y;
    const kIndex = offset + k;
    const down = k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = down ? v[offset + prevK] : v[offset + prevK] + 1;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', line: a[x - 1] });
      x--;
      y--;
    }
    if (down) {
      // Insert from b
      ops.push({ type: 'insert', line: b[y - 1] });
      y--;
    } else {
      // Delete from a
      ops.push({ type: 'delete', line: a[x - 1] });
      x--;
    }
  }

  while (x > 0 && y > 0) {
    ops.push({ type: 'equal', line: a[x - 1] });
    x--;
    y--;
  }
  while (x > 0) {
    ops.push({ type: 'delete', line: a[x - 1] });
    x--;
  }
  while (y > 0) {
    ops.push({ type: 'insert', line: b[y - 1] });
    y--;
  }

  ops.reverse();

  // Coalesce into grouped ops.
  const grouped: DiffOp[] = [];
  for (const o of ops) {
    const last = grouped[grouped.length - 1];
    if (last && last.type === o.type) {
      last.lines.push(o.line);
    } else {
      grouped.push({ type: o.type, lines: [o.line] } as DiffOp);
    }
  }
  return grouped;
}

function buildUnifiedPatch(fileLabel: string, oldText: string, newText: string, contextLines = 2): string {
  if (oldText === newText) return '';
  const ops = myersDiffLines(oldText, newText);
  const aLines = splitLinesKeepLastEmpty(oldText);
  const bLines = splitLinesKeepLastEmpty(newText);

  // Build a single unified diff with multiple hunks when separated by equals > contextLines.
  let aIndex = 0;
  let bIndex = 0;
  type HunkLine = { kind: ' ' | '+' | '-'; text: string };
  type Hunk = { aStart: number; bStart: number; aCount: number; bCount: number; lines: HunkLine[] };
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let pendingContext: string[] = [];

  const flushContextIntoHunk = () => {
    if (!cur) return;
    for (const l of pendingContext) cur.lines.push({ kind: ' ', text: l });
    pendingContext = [];
  };

  const closeHunk = () => {
    if (!cur) return;
    // Trim trailing context to at most contextLines
    let trailing = 0;
    for (let i = cur.lines.length - 1; i >= 0; i--) {
      if (cur.lines[i].kind !== ' ') break;
      trailing++;
    }
    if (trailing > contextLines) cur.lines.splice(cur.lines.length - (trailing - contextLines), trailing - contextLines);

    // Recompute counts based on lines.
    cur.aCount = cur.lines.filter((l) => l.kind !== '+').length;
    cur.bCount = cur.lines.filter((l) => l.kind !== '-').length;
    hunks.push(cur);
    cur = null;
    pendingContext = [];
  };

  const startHunkIfNeeded = () => {
    if (cur) return;
    // Include leading context (up to contextLines) that we buffered.
    const lead = pendingContext.slice(Math.max(0, pendingContext.length - contextLines));
    const aStart = aIndex - lead.length;
    const bStart = bIndex - lead.length;
    cur = { aStart: aStart + 1, bStart: bStart + 1, aCount: 0, bCount: 0, lines: [] };
    pendingContext = [];
    for (const l of lead) cur.lines.push({ kind: ' ', text: l });
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      for (const line of op.lines) {
        pendingContext.push(line);
        aIndex++;
        bIndex++;

        if (cur) {
          // If we already have changes in the hunk, we keep context up to contextLines;
          // if context grows beyond that without new changes, we close the hunk.
          if (pendingContext.length <= contextLines) {
            flushContextIntoHunk();
          } else {
            closeHunk();
          }
        } else if (pendingContext.length > contextLines) {
          // Keep only recent context while not in a hunk.
          pendingContext = pendingContext.slice(-contextLines);
        }
      }
      continue;
    }

    // Change op: ensure hunk started and include buffered context.
    startHunkIfNeeded();
    flushContextIntoHunk();

    if (op.type === 'delete') {
      for (const line of op.lines) {
        cur!.lines.push({ kind: '-', text: line });
        aIndex++;
      }
    } else if (op.type === 'insert') {
      for (const line of op.lines) {
        cur!.lines.push({ kind: '+', text: line });
        bIndex++;
      }
    }
  }
  closeHunk();

  const header = [`--- a/${fileLabel}`, `+++ b/${fileLabel}`];
  const body: string[] = [];
  for (const h of hunks) {
    body.push(`@@ -${h.aStart},${h.aCount} +${h.bStart},${h.bCount} @@`);
    for (const l of h.lines) body.push(`${l.kind}${l.text}`);
  }

  if (!body.length) return '';
  return header.concat(body).join('\n') + '\n';
}

function safeReadTextFile(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function summarizeTextChanges(oldText: string, newText: string, issue: string, location: string): string[] {
  if (oldText === newText) return [];
  const ops = myersDiffLines(oldText, newText);
  const out: string[] = [];

  const pushChange = (oldLine: string, newLine: string) => {
    const o = String(oldLine ?? '').trim();
    const n = String(newLine ?? '').trim();
    if (!o && !n) return;
    if (o === n) return;
    out.push(
      `❌ ${issue}\n` +
        `📍 ${location}\n\n` +
        `💡 Change this:\n` +
        `${o || '(empty)'} → ${n || '(empty)'}\n`,
    );
  };

  const pushRemoveAdd = (removed: string[], added: string[]) => {
    const rm = removed.map((x) => String(x ?? '').trim()).filter(Boolean);
    const ad = added.map((x) => String(x ?? '').trim()).filter(Boolean);
    if (!rm.length && !ad.length) return;
    const lines: string[] = [];
    lines.push(`❌ ${issue}`);
    lines.push(`📍 ${location}`);
    lines.push('');
    lines.push('💡 Fix:');
    if (rm.length) {
      lines.push('Remove this');
      lines.push(...rm);
    }
    if (ad.length) {
      lines.push('Add this');
      lines.push(...ad);
    }
    out.push(lines.join('\n') + '\n');
  };

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === 'equal') continue;

    // Prefer "old → new" if we have delete followed by insert.
    if (op.type === 'delete' && ops[i + 1] && ops[i + 1].type === 'insert') {
      const del = op.lines;
      const ins = (ops[i + 1] as any).lines as string[];
      const min = Math.min(del.length, ins.length);
      for (let j = 0; j < min; j++) pushChange(del[j], ins[j]);
      if (del.length > min || ins.length > min) pushRemoveAdd(del.slice(min), ins.slice(min));
      i++; // consume insert
      continue;
    }

    if (op.type === 'delete') {
      pushRemoveAdd(op.lines, []);
      continue;
    }
    if (op.type === 'insert') {
      pushRemoveAdd([], op.lines);
      continue;
    }
  }

  return out;
}

function summarizeLocatorYamlChanges(oldYamlText: string, newYamlText: string): string[] {
  const out: string[] = [];
  let oldMap: Record<string, [string, string]> = {};
  let newMap: Record<string, [string, string]> = {};
  try {
    if (oldYamlText && oldYamlText.trim()) oldMap = parseLocatorYaml(oldYamlText);
  } catch {
    // If YAML can't be parsed, fall back to text diff summary.
    return summarizeTextChanges(oldYamlText, newYamlText, 'Locator file changed', 'locators');
  }
  try {
    if (newYamlText && newYamlText.trim()) newMap = parseLocatorYaml(newYamlText);
  } catch {
    return summarizeTextChanges(oldYamlText, newYamlText, 'Locator file changed', 'locators');
  }

  const names = Array.from(new Set([...Object.keys(oldMap), ...Object.keys(newMap)])).sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const o = oldMap[name];
    const n = newMap[name];
    if (!o && n) {
      const { selectorText } = locatorFromTuple(n);
      out.push(`❌ Locator missing\n📍 ${name}\n\n💡 Fix:\nAdd this\n${selectorText}\n`);
      continue;
    }
    if (o && !n) {
      const { selectorText } = locatorFromTuple(o);
      out.push(`❌ Locator not used / removed\n📍 ${name}\n\n💡 Fix:\nRemove this\n${selectorText}\n`);
      continue;
    }
    if (o && n) {
      const oSel = locatorFromTuple(o).selectorText;
      const nSel = locatorFromTuple(n).selectorText;
      if (oSel !== nSel) {
        out.push(`❌ Locator changed\n📍 ${name}\n\n💡 Change this:\n${oSel} → ${nSel}\n`);
      }
    }
  }
  return out;
}

function backupAndWriteFile(targetPath: string, contents: string): void {
  ensureDir(path.dirname(targetPath));
  if (fs.existsSync(targetPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(targetPath, `${targetPath}.bak.${stamp}`);
  }
  fs.writeFileSync(targetPath, contents, 'utf8');
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

async function injectAiGeneratePanel(page: import('playwright').Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as any;
    // Avoid registering the poller twice on the same document.
    if (win.__pwAiGenPollerActive) return;
    win.__pwAiGenPollerActive = true;

    const build = (): boolean => {
      if (document.getElementById('__pw_ai_gen_panel__')) return true;

    // ── Toolbar button ────────────────────────────────────────────────────────
    // Anchor to the Inspector button (always present) so the panel works even when
    // the AI Fix button is hidden on the no-llm branch.
    const anchorBtn = document.getElementById('__pw_rec_btn_inspector__')
      || document.querySelector('[id^="__pw_rec_btn_ai_fix__"]');
    const barRow = anchorBtn?.parentElement;
    if (!barRow) return false;

    const aiGenBtn = document.createElement('button');
    aiGenBtn.type = 'button';
    aiGenBtn.id = '__pw_rec_btn_ai_gen__';
    aiGenBtn.textContent = '🔍 DOM Mode';
    aiGenBtn.setAttribute('style', [
      'padding:8px 10px', 'border-radius:10px', 'border:0', 'cursor:pointer',
      'font-weight:800', 'font-size:12px', 'color:#fff',
      'background:rgba(16,185,129,0.95)',
      'box-shadow:0 8px 24px rgba(16,185,129,0.22)',
    ].join(';'));
    barRow.appendChild(aiGenBtn);

    // ── Panel ─────────────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = '__pw_ai_gen_panel__';
    panel.setAttribute('style', [
      'position:fixed', 'top:8px', 'left:8px', 'width:560px', 'height:82vh',
      'max-height:calc(100vh - 16px)', 'z-index:2147483647',
      'background:rgba(2,6,23,0.95)', 'border:1px solid rgba(148,163,184,0.35)',
      'border-radius:14px', 'box-sizing:border-box', 'padding:14px',
      'overflow:auto', 'display:none',
      'font-family:system-ui,Segoe UI,Roboto,sans-serif',
      'resize:both', 'min-width:380px', 'min-height:340px',
    ].join(';'));

    // Header
    const hdr = document.createElement('div');
    hdr.setAttribute('style', 'display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;user-select:none');
    const title = document.createElement('div');
    title.textContent = '✨ AI Generate — feature + locators from description';
    title.setAttribute('style', 'font-weight:900;font-size:12px;color:#e5e7eb');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.setAttribute('style', 'border:0;border-radius:10px;padding:6px 10px;cursor:pointer;font-weight:800;font-size:12px;color:#cbd5e1;background:rgba(148,163,184,0.15)');
    closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
    hdr.appendChild(title);
    hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    const meta = document.createElement('div');
    meta.setAttribute('style', 'margin-top:6px;font-size:11px;color:#94a3b8;line-height:1.5');
    meta.innerHTML = 'Describe your scenario in plain English. Use <b style="color:#6ee7b7">[pageKey]</b> markers for each page.<br>Example: <i style="color:#a5f3fc">[loginPage] Enter email and password, click Login. [dashboardPage] Verify Welcome text. Click Edit button.</i>';
    panel.appendChild(meta);

    // Helpers
    const lbl = (t: string) => {
      const d = document.createElement('div');
      d.textContent = t;
      d.setAttribute('style', 'margin-top:12px;font-weight:900;font-size:12px;color:#e5e7eb');
      return d;
    };
    const inp = (ph: string, val: string) => {
      const e = document.createElement('input');
      e.type = 'text';
      e.placeholder = ph;
      e.value = val || '';
      e.setAttribute('style', 'margin-top:6px;width:100%;padding:9px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.4);color:#e5e7eb;outline:none;font-size:12px;box-sizing:border-box');
      return e;
    };
    const btn = (t: string, bg: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.setAttribute('style', 'padding:9px 14px;border-radius:10px;border:0;cursor:pointer;font-weight:800;font-size:12px;color:#fff;background:' + bg);
      return b;
    };

    // Custom confirm modal (native confirm() is auto-dismissed by Playwright).
    const pwConfirm = (message: string): Promise<boolean> => new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center');
      const box = document.createElement('div');
      box.setAttribute('style', 'background:#0f172a;border:1px solid rgba(148,163,184,0.4);border-radius:12px;padding:18px;max-width:460px;color:#e5e7eb;font-size:13px;font-family:system-ui,Segoe UI,Roboto,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.5)');
      const msg = document.createElement('div');
      msg.textContent = message;
      msg.setAttribute('style', 'white-space:pre-wrap;margin-bottom:14px;line-height:1.5');
      const row = document.createElement('div');
      row.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end');
      const no = btn('Cancel', 'rgba(71,85,105,0.9)');
      const yes = btn('Overwrite', 'rgba(234,88,12,0.95)');
      no.addEventListener('click', () => { ov.remove(); resolve(false); });
      yes.addEventListener('click', () => { ov.remove(); resolve(true); });
      row.appendChild(no); row.appendChild(yes);
      box.appendChild(msg); box.appendChild(row); ov.appendChild(box);
      (document.getElementById('pw-recorder-ui-root') || document.body).appendChild(ov);
    });

    panel.appendChild(lbl('URL to test'));
    const urlIn = inp('https://example.com/login', '');
    panel.appendChild(urlIn);

    panel.appendChild(lbl('Scenario description'));
    const descIn = document.createElement('textarea');
    descIn.placeholder = '[loginPage] Enter email surya@evanke.com and password Test@123, click the Login button.\n[dashboardPage] Verify Welcome text is visible. Click the Edit button.\n[editPage] Update the name field and click Save.';
    descIn.setAttribute('style', 'margin-top:6px;width:100%;height:110px;padding:9px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.4);color:#e5e7eb;outline:none;font-size:12px;resize:vertical;box-sizing:border-box;font-family:inherit');
    panel.appendChild(descIn);

    panel.appendChild(lbl('Feature file name (no extension)'));
    const nameIn = inp('my-login-flow', 'generated-flow');
    panel.appendChild(nameIn);

    const btnRow = document.createElement('div');
    btnRow.setAttribute('style', 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center');
    const genBtn2 = btn('▶ Generate', 'rgba(16,185,129,0.9)');
    const saveBtn = btn('💾 Save files', 'rgba(59,130,246,0.9)');
    const runBtn2 = btn('🔄 Run & Auto-Fix', 'rgba(234,88,12,0.9)');

    // Max iterations selector
    const iterLabel = document.createElement('span');
    iterLabel.textContent = 'Max attempts:';
    iterLabel.setAttribute('style', 'font-size:11px;color:#94a3b8;white-space:nowrap');
    const iterSel = document.createElement('select');
    iterSel.setAttribute('style', 'padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.5);color:#e5e7eb;font-size:11px;outline:none');
    [3, 5, 7, 10, 0].forEach((n) => {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = n === 0 ? 'Unlimited' : String(n);
      if (n === 5) o.selected = true;
      iterSel.appendChild(o);
    });

    saveBtn.style.display = 'none';
    runBtn2.style.display = 'none';
    iterLabel.style.display = 'none';
    iterSel.style.display = 'none';

    btnRow.appendChild(genBtn2);
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(runBtn2);
    btnRow.appendChild(iterLabel);
    btnRow.appendChild(iterSel);
    panel.appendChild(btnRow);

    const status = document.createElement('div');
    status.setAttribute('style', 'margin-top:10px;font-size:11px;color:#6ee7b7;min-height:18px');
    panel.appendChild(status);

    panel.appendChild(lbl('Generated feature file'));
    const featOut = document.createElement('textarea');
    featOut.setAttribute('style', 'margin-top:6px;width:100%;height:130px;padding:9px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.2);background:rgba(15,23,42,0.5);color:#a5f3fc;outline:none;font-size:11px;resize:vertical;box-sizing:border-box;font-family:monospace');
    panel.appendChild(featOut);

    panel.appendChild(lbl('Generated locators YAML (per page)'));
    const yamlOut = document.createElement('textarea');
    yamlOut.setAttribute('style', 'margin-top:6px;width:100%;height:130px;padding:9px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.2);background:rgba(15,23,42,0.5);color:#fde68a;outline:none;font-size:11px;resize:vertical;box-sizing:border-box;font-family:monospace');
    panel.appendChild(yamlOut);
    const yamlNote = document.createElement('div');
    yamlNote.setAttribute('style', 'margin-top:4px;font-size:10px;color:#94a3b8');
    yamlNote.textContent = 'Multi-page: each page YAML is saved separately to locators/pages/<pageKey>.yaml';
    panel.appendChild(yamlNote);

    // ── DOM Mode — Zero LLM ───────────────────────────────────────────────────
    const domDiv = document.createElement('div');
    domDiv.setAttribute('style', 'margin-top:16px;border-top:2px solid rgba(99,102,241,0.4);padding-top:14px');
    panel.appendChild(domDiv);

    const domTitle = document.createElement('div');
    domTitle.textContent = '🔍 DOM Mode';
    domTitle.setAttribute('style', 'font-weight:900;font-size:12px;color:#c4b5fd');
    domDiv.appendChild(domTitle);

    const domMeta = document.createElement('div');
    domMeta.setAttribute('style', 'margin-top:4px;font-size:11px;color:#94a3b8;line-height:1.5');
    domMeta.innerHTML = 'Describe what to do in plain English. The browser navigates, reads the real DOM, and generates <b style="color:#c4b5fd">only the steps you described</b>. Zero LLM.';
    // (description text per spec)
    domDiv.appendChild(domMeta);

    domDiv.appendChild(lbl('Scenario description (plain English)'));
    const domDescIn = document.createElement('textarea');
    domDescIn.placeholder = 'go to https://the-internet.herokuapp.com/ click on "Dropdown". then verify "Dropdown List" text is present.';
    domDescIn.setAttribute('style', 'margin-top:6px;width:100%;height:80px;padding:9px 12px;border-radius:10px;border:1px solid rgba(99,102,241,0.4);background:rgba(15,23,42,0.4);color:#e5e7eb;outline:none;font-size:12px;resize:vertical;box-sizing:border-box;font-family:inherit;line-height:1.5');
    domDiv.appendChild(domDescIn);

    const domHint = document.createElement('div');
    domHint.setAttribute('style', 'margin-top:5px;font-size:10px;color:#6366f1;line-height:1.6');
    domHint.innerHTML = [
      '<b>Supported actions:</b>',
      '• <b>go to / navigate to</b> https://url',
      '• <b>click</b> "Element text" or click "Element" button/link',
      '• <b>enter/type</b> "value" in "Field name"',
      '• <b>select</b> "Option" from "Field" dropdown',
      '• <b>check / tick</b> "Label" checkbox',
      '• <b>select / choose</b> "Label" radio button',
      '• <b>verify data from</b> "Name" table',
      '• <b>verify / check</b> "some text" is present',
    ].join('<br>');
    domDiv.appendChild(domHint);

    domDiv.appendChild(lbl('Feature file name'));
    const domFileIn = inp('my-flow', 'dom-generated-flow');
    domDiv.appendChild(domFileIn);

    const domBtnRow = document.createElement('div');
    domBtnRow.setAttribute('style', 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap');
    const domScanBtn = btn('🔍 Generate', 'rgba(99,102,241,0.9)');
    const domSaveBtn = btn('💾 Save', 'rgba(59,130,246,0.9)');
    const domRunBtn = btn('🔄 Run & DOM Auto-Fix', 'rgba(234,88,12,0.9)');
    domSaveBtn.style.display = 'none';
    domRunBtn.style.display = 'none';
    domBtnRow.appendChild(domScanBtn);
    domBtnRow.appendChild(domSaveBtn);
    domBtnRow.appendChild(domRunBtn);
    domDiv.appendChild(domBtnRow);

    const domStatus = document.createElement('div');
    domStatus.setAttribute('style', 'margin-top:8px;font-size:11px;color:#c4b5fd;min-height:16px');
    domDiv.appendChild(domStatus);

    domDiv.appendChild(lbl('Generated feature file'));
    const domFeatOut = document.createElement('textarea');
    domFeatOut.setAttribute('style', 'margin-top:6px;width:100%;height:120px;padding:9px 12px;border-radius:10px;border:1px solid rgba(99,102,241,0.2);background:rgba(15,23,42,0.5);color:#a5f3fc;outline:none;font-size:11px;resize:vertical;box-sizing:border-box;font-family:monospace');
    domDiv.appendChild(domFeatOut);

    domDiv.appendChild(lbl('Generated locators YAML'));
    const domYamlOut = document.createElement('textarea');
    domYamlOut.setAttribute('style', 'margin-top:6px;width:100%;height:120px;padding:9px 12px;border-radius:10px;border:1px solid rgba(99,102,241,0.2);background:rgba(15,23,42,0.5);color:#fde68a;outline:none;font-size:11px;resize:vertical;box-sizing:border-box;font-family:monospace');
    domDiv.appendChild(domYamlOut);

    let domSavedPath = '';
    let domPageYamls: Record<string, string> = {};

    domScanBtn.addEventListener('click', async () => {
      const description = domDescIn.value.trim();
      const fileName = (domFileIn.value.trim() || 'dom-generated-flow').replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!description) { domStatus.textContent = 'Please describe what to test.'; return; }

      domScanBtn.disabled = true;
      domSaveBtn.style.display = 'none';
      domFeatOut.value = '';
      domYamlOut.value = '';
      domStatus.textContent = 'Parsing description → navigating browser → finding elements in DOM...';

      try {
        const r = await win.pwRecorderDomScan({ description, fileName });
        domFeatOut.value = r.featureContent || '';
        domYamlOut.value = Object.entries(r.pageYamls || {})
          .map(([pk, yaml]) => '# === ' + pk + '.yaml ===\n' + yaml)
          .join('\n\n');
        domPageYamls = r.pageYamls || {};
        domStatus.textContent = r.status || 'Done! Review and click Save.';
        domSaveBtn.style.display = '';
      } catch (e) {
        domStatus.textContent = 'Error: ' + ((e as any).message || String(e));
      }
      domScanBtn.disabled = false;
    });

    domSaveBtn.addEventListener('click', async () => {
      const fileName = (domFileIn.value.trim() || 'dom-generated-flow').replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!domFeatOut.value.trim()) { domStatus.textContent = 'Feature file is empty.'; return; }
      domSaveBtn.disabled = true;
      domStatus.textContent = 'Saving...';
      try {
        let r = await win.pwRecorderAiGenerateSave({ fileName, featureContent: domFeatOut.value, pageYamls: domPageYamls });
        if (r && r.needsConfirm) {
          const ok = await pwConfirm('These file(s) already exist:\n\n' + (r.existingPaths || []).join('\n') + '\n\nOverwrite them?');
          if (!ok) { domStatus.textContent = 'Cancelled — existing files kept.'; domSaveBtn.disabled = false; return; }
          r = await win.pwRecorderAiGenerateSave({ fileName, featureContent: domFeatOut.value, pageYamls: domPageYamls, overwrite: true });
        }
        domSavedPath = r.featurePath || '';
        domStatus.textContent = 'Saved: ' + (r.savedPaths || []).join(', ');
        domRunBtn.style.display = '';
      } catch (e) {
        domStatus.textContent = 'Save error: ' + ((e as any).message || String(e));
      }
      domSaveBtn.disabled = false;
    });

    domRunBtn.addEventListener('click', () => {
      if (!domSavedPath) { domStatus.textContent = 'Save first.'; return; }
      void startLoop(domSavedPath, 0, domStatus, true /* domMode */);
    });

    // ── Run Existing Feature section ─────────────────────────────────────────
    const divider = document.createElement('div');
    divider.setAttribute('style', 'margin-top:16px;border-top:1px solid rgba(148,163,184,0.2);padding-top:14px');
    panel.appendChild(divider);

    const runSecTitle = document.createElement('div');
    runSecTitle.textContent = '▶ Run & Auto-Fix any feature file';
    runSecTitle.setAttribute('style', 'font-weight:900;font-size:12px;color:#e5e7eb');
    divider.appendChild(runSecTitle);

    const runSecMeta = document.createElement('div');
    runSecMeta.textContent = 'Pick any feature file → run → if it fails, LLM fixes it automatically and retries.';
    runSecMeta.setAttribute('style', 'margin-top:4px;font-size:11px;color:#94a3b8');
    divider.appendChild(runSecMeta);

    // Dropdown of all feature files
    const featureSel = document.createElement('select');
    featureSel.setAttribute('style', 'margin-top:8px;width:100%;padding:9px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.4);color:#e5e7eb;outline:none;font-size:12px;box-sizing:border-box');
    const featureSelPlaceholder = document.createElement('option');
    featureSelPlaceholder.value = '';
    featureSelPlaceholder.textContent = '— loading feature files... —';
    featureSel.appendChild(featureSelPlaceholder);
    divider.appendChild(featureSel);

    // Refresh button + iterations row
    const runExRow = document.createElement('div');
    runExRow.setAttribute('style', 'display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap');
    const refreshBtn = btn('⟳ Refresh', 'rgba(71,85,105,0.8)');
    const runExBtn = btn('🔄 Run & Auto-Fix', 'rgba(234,88,12,0.9)');
    const runExIterLabel = document.createElement('span');
    runExIterLabel.textContent = 'Max attempts:';
    runExIterLabel.setAttribute('style', 'font-size:11px;color:#94a3b8;white-space:nowrap');
    const runExIterSel = document.createElement('select');
    runExIterSel.setAttribute('style', 'padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.5);color:#e5e7eb;font-size:11px;outline:none');
    [3, 5, 7, 10, 0].forEach((n) => {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = n === 0 ? 'Unlimited' : String(n);
      if (n === 5) o.selected = true;
      runExIterSel.appendChild(o);
    });
    runExRow.appendChild(refreshBtn);
    runExRow.appendChild(runExBtn);
    runExRow.appendChild(runExIterLabel);
    runExRow.appendChild(runExIterSel);
    divider.appendChild(runExRow);

    // Status line for the existing-file runner
    const runExStatus = document.createElement('div');
    runExStatus.setAttribute('style', 'margin-top:8px;font-size:11px;color:#6ee7b7;min-height:16px');
    divider.appendChild(runExStatus);

    // Shared terminal output
    panel.appendChild(lbl('Test output'));
    const termOut = document.createElement('pre');
    termOut.setAttribute('style', 'margin-top:6px;width:100%;min-height:100px;max-height:320px;padding:10px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.15);background:#0a0f1e;color:#86efac;font-size:11px;font-family:monospace;overflow-y:auto;white-space:pre-wrap;word-break:break-all;box-sizing:border-box;display:none');
    panel.appendChild(termOut);

    // Load feature file list
    const loadFeatureFiles = async () => {
      try {
        const list = await win.pwRecorderListFeatureFiles();
        while (featureSel.firstChild) featureSel.removeChild(featureSel.firstChild);
        if (!list || !list.length) {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = '— no feature files found —';
          featureSel.appendChild(o);
          return;
        }
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '— select a feature file —';
        featureSel.appendChild(ph);
        list.forEach((f: { label: string; absPath: string }) => {
          const o = document.createElement('option');
          o.value = f.absPath;
          o.textContent = f.label;
          featureSel.appendChild(o);
        });
      } catch (e) {
        runExStatus.textContent = 'Could not load file list: ' + ((e as any).message || String(e));
      }
    };

    // Load on open, refresh on button click
    void loadFeatureFiles();
    refreshBtn.addEventListener('click', () => { void loadFeatureFiles(); runExStatus.textContent = 'Refreshed.'; });

    // Run & auto-fix loop for an existing file
    const startLoop = async (featurePath: string, maxIter: number, statusEl: HTMLElement, domMode = false) => {
      if (!featurePath) { statusEl.textContent = 'Select a feature file first.'; return; }
      runExBtn.disabled = true;
      runBtn2.disabled = true;
      termOut.style.display = '';
      termOut.style.color = domMode ? '#c4b5fd' : '#86efac';
      termOut.textContent = (domMode ? 'DOM Auto-Fix mode (Zero LLM)' : 'Auto-Fix loop') + ' starting...\n';
      statusEl.textContent = 'Starting...';
      try {
        const start = await win.pwRecorderStartFixLoop({ featurePath, maxIterations: maxIter, domMode });
        const loopId: string = start.loopId;
        const poll = async () => {
          const s = await win.pwRecorderGetLoopStatus({ loopId });
          termOut.textContent = s.log || '';
          termOut.scrollTop = termOut.scrollHeight;
          statusEl.textContent = s.statusLine || 'Running...';
          if (!s.done) { setTimeout(poll, 2000); return; }
          runExBtn.disabled = false;
          runBtn2.disabled = false;
          if (s.passed) {
            statusEl.textContent = '✅ Passed after ' + s.iterations + ' iteration(s)!';
            termOut.style.color = '#86efac';
          } else {
            statusEl.textContent = '❌ Could not fix after ' + s.iterations + ' attempt(s).';
            termOut.style.color = '#fca5a5';
          }
          if (s.finalFeature) featOut.value = s.finalFeature;
          if (s.finalYaml) yamlOut.value = s.finalYaml;
        };
        void poll();
      } catch (e) {
        termOut.textContent += 'Error: ' + ((e as any).message || String(e)) + '\n';
        statusEl.textContent = 'Failed to start';
        runExBtn.disabled = false;
        runBtn2.disabled = false;
      }
    };

    runExBtn.addEventListener('click', () => {
      const fp = featureSel.value;
      const maxIter = parseInt(runExIterSel.value || '5', 10);
      void startLoop(fp, maxIter, runExStatus);
    });

    // ── Upload your own files ─────────────────────────────────────────────────
    const uploadTitle = document.createElement('div');
    uploadTitle.textContent = '📂 Upload your own files to fix';
    uploadTitle.setAttribute('style', 'margin-top:14px;font-weight:900;font-size:12px;color:#e5e7eb');
    divider.appendChild(uploadTitle);

    const uploadHint = document.createElement('div');
    uploadHint.textContent = 'Drop or pick .feature and/or .yaml locator files. They will be saved to the project, then the auto-fix loop runs.';
    uploadHint.setAttribute('style', 'margin-top:4px;font-size:11px;color:#94a3b8');
    divider.appendChild(uploadHint);

    // Drop zone
    const dropZone = document.createElement('div');
    dropZone.id = '__pw_gen_upload_zone__';
    dropZone.textContent = '⬆ Drop .feature / .yaml files here, or click to browse';
    dropZone.setAttribute('style', [
      'margin-top:8px', 'padding:14px 12px', 'border-radius:10px',
      'border:2px dashed rgba(148,163,184,0.35)', 'background:rgba(15,23,42,0.35)',
      'color:#94a3b8', 'font-size:11px', 'text-align:center',
      'cursor:pointer', 'transition:border-color 0.15s',
    ].join(';'));
    divider.appendChild(dropZone);

    // Hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = '.feature,.yaml,.yml';
    fileInput.setAttribute('style', 'display:none');
    divider.appendChild(fileInput);

    // Uploaded files list
    const uploadList = document.createElement('div');
    uploadList.setAttribute('style', 'margin-top:6px;font-size:11px;color:#a5f3fc;min-height:16px');
    divider.appendChild(uploadList);

    // Upload row: iterations + run button
    const uploadRow = document.createElement('div');
    uploadRow.setAttribute('style', 'display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap');
    const uploadRunBtn = btn('🔄 Save & Run Auto-Fix', 'rgba(234,88,12,0.9)');
    const uploadIterLabel = document.createElement('span');
    uploadIterLabel.textContent = 'Max attempts:';
    uploadIterLabel.setAttribute('style', 'font-size:11px;color:#94a3b8;white-space:nowrap');
    const uploadIterSel = document.createElement('select');
    uploadIterSel.setAttribute('style', 'padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.5);color:#e5e7eb;font-size:11px;outline:none');
    [3, 5, 7, 10, 0].forEach((n) => {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = n === 0 ? 'Unlimited' : String(n);
      if (n === 5) o.selected = true;
      uploadIterSel.appendChild(o);
    });
    const clearBtn = btn('✕ Clear', 'rgba(71,85,105,0.7)');
    uploadRow.appendChild(uploadRunBtn);
    uploadRow.appendChild(uploadIterLabel);
    uploadRow.appendChild(uploadIterSel);
    uploadRow.appendChild(clearBtn);
    divider.appendChild(uploadRow);

    const uploadStatus = document.createElement('div');
    uploadStatus.setAttribute('style', 'margin-top:6px;font-size:11px;color:#6ee7b7;min-height:16px');
    divider.appendChild(uploadStatus);

    // Collected uploaded files: { name, content }
    let uploadedFiles: Array<{ name: string; content: string }> = [];

    const renderUploadList = () => {
      uploadList.textContent = '';
      if (!uploadedFiles.length) { uploadList.textContent = 'No files selected.'; return; }
      uploadedFiles.forEach((f) => {
        const chip = document.createElement('span');
        chip.textContent = '📄 ' + f.name + '  ';
        chip.setAttribute('style', 'margin-right:6px;background:rgba(99,102,241,0.2);padding:2px 6px;border-radius:6px');
        uploadList.appendChild(chip);
      });
    };

    const readFiles = (files: FileList | null) => {
      if (!files || !files.length) return;
      const readers: Promise<void>[] = [];
      Array.from(files).forEach((file) => {
        readers.push(new Promise((res) => {
          const reader = new FileReader();
          reader.onload = () => {
            const existing = uploadedFiles.findIndex((u) => u.name === file.name);
            const entry = { name: file.name, content: String(reader.result || '') };
            if (existing >= 0) uploadedFiles[existing] = entry;
            else uploadedFiles.push(entry);
            res();
          };
          reader.readAsText(file);
        }));
      });
      Promise.all(readers).then(() => renderUploadList());
    };

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { readFiles(fileInput.files); fileInput.value = ''; });

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'rgba(99,102,241,0.8)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'rgba(148,163,184,0.35)'; });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'rgba(148,163,184,0.35)';
      readFiles(e.dataTransfer && e.dataTransfer.files);
    });

    clearBtn.addEventListener('click', () => {
      uploadedFiles = [];
      renderUploadList();
      uploadStatus.textContent = 'Cleared.';
    });

    uploadRunBtn.addEventListener('click', async () => {
      const featureFile = uploadedFiles.find((f) => f.name.endsWith('.feature'));
      const yamlFiles = uploadedFiles.filter((f) => f.name.endsWith('.yaml') || f.name.endsWith('.yml'));
      if (!featureFile) { uploadStatus.textContent = 'Please upload at least one .feature file.'; return; }

      uploadRunBtn.disabled = true;
      uploadStatus.textContent = 'Saving uploaded files...';
      try {
        const saved = await win.pwRecorderSaveUploadedFiles({
          files: uploadedFiles.map((f) => ({ name: f.name, content: f.content })),
        });
        uploadStatus.textContent = 'Saved: ' + (saved.savedPaths || []).join(', ');
        // Refresh dropdown and select the saved feature
        await loadFeatureFiles();
        if (saved.featureAbsPath) {
          Array.from(featureSel.options).forEach((o) => {
            if ((o as HTMLOptionElement).value === saved.featureAbsPath) (o as HTMLOptionElement).selected = true;
          });
        }
        // Start the fix loop
        const maxIter = parseInt(uploadIterSel.value || '5', 10);
        void startLoop(saved.featureAbsPath || '', maxIter, uploadStatus);
      } catch (e) {
        uploadStatus.textContent = 'Error: ' + ((e as any).message || String(e));
        uploadRunBtn.disabled = false;
      }
    });

    let savedPath = '';
    let currentPageYamls: Record<string, string> = {};

    genBtn2.addEventListener('click', async () => {
      const url = urlIn.value.trim();
      const desc = descIn.value.trim();
      const name = (nameIn.value.trim() || 'generated-flow').replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!url) { status.textContent = 'Please enter a URL.'; return; }
      if (!desc) { status.textContent = 'Please describe the scenario.'; return; }
      genBtn2.disabled = true;
      saveBtn.style.display = 'none';
      featOut.value = '';
      yamlOut.value = '';
      // Detect page markers for status message
      const pageMarkers = (desc.match(/\[[a-zA-Z][a-zA-Z0-9]*\]/g) || []);
      status.textContent = pageMarkers.length > 1
        ? 'Step 1: LLM drafts flow → Step 2: Browser navigates ' + pageMarkers.length + ' pages → Step 3: LLM generates feature + YAMLs...'
        : 'Generating...';
      let currentPageYamls: Record<string, string> = {};
      try {
        const r = await win.pwRecorderAiGenerate({ url, description: desc, fileName: name });
        featOut.value = r.featureContent || '';
        // Display all page YAMLs concatenated with headers
        if (r.pageYamls && Object.keys(r.pageYamls).length > 0) {
          currentPageYamls = r.pageYamls;
          yamlOut.value = Object.entries(r.pageYamls)
            .map(([pk, yaml]) => '# === ' + pk + '.yaml ===\n' + yaml)
            .join('\n\n');
        } else {
          yamlOut.value = r.locatorsYaml || '';
        }
        status.textContent = r.status || 'Done! Review and click Save files.';
        saveBtn.style.display = '';
      } catch (e) {
        status.textContent = 'Error: ' + (e && (e as any).message ? (e as any).message : String(e));
      }
      genBtn2.disabled = false;
    });

    saveBtn.addEventListener('click', async () => {
      const name = (nameIn.value.trim() || 'generated-flow').replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!featOut.value.trim()) { status.textContent = 'Feature file is empty.'; return; }
      saveBtn.disabled = true;
      status.textContent = 'Saving...';
      try {
        let r = await win.pwRecorderAiGenerateSave({ fileName: name, featureContent: featOut.value, pageYamls: currentPageYamls, locatorsYaml: yamlOut.value });
        if (r && r.needsConfirm) {
          const ok = await pwConfirm('These file(s) already exist:\n\n' + (r.existingPaths || []).join('\n') + '\n\nOverwrite them?');
          if (!ok) { status.textContent = 'Cancelled — existing files kept.'; saveBtn.disabled = false; return; }
          r = await win.pwRecorderAiGenerateSave({ fileName: name, featureContent: featOut.value, pageYamls: currentPageYamls, locatorsYaml: yamlOut.value, overwrite: true });
        }
        savedPath = r.featurePath || '';
        status.textContent = 'Saved: ' + (r.savedPaths || []).join(', ');
        runBtn2.style.display = '';
        iterLabel.style.display = '';
        iterSel.style.display = '';
      } catch (e) {
        status.textContent = 'Save error: ' + (e && (e as any).message ? (e as any).message : String(e));
      }
      saveBtn.disabled = false;
    });

    runBtn2.addEventListener('click', () => {
      if (!savedPath) { status.textContent = 'Save the feature file first.'; return; }
      const maxIter = parseInt(iterSel.value || '5', 10);
      void startLoop(savedPath, maxIter, status);
    });

    aiGenBtn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    // Simple drag
    let drag = false, ox = 0, oy = 0;
    hdr.addEventListener('mousedown', (e) => { drag = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; });
    document.addEventListener('mousemove', (e) => { if (drag) { panel.style.left = (e.clientX - ox) + 'px'; panel.style.top = (e.clientY - oy) + 'px'; } });
    document.addEventListener('mouseup', () => { drag = false; });

    const root = document.getElementById('pw-recorder-ui-root') || document.body;
    root.appendChild(panel);

    // Show ONLY the DOM Mode section; hide any non-DOM children.
    // hdr (header), domDiv (DOM Mode) and termOut (test output, used by DOM run)
    // are all direct children of panel, so we hide the rest.
    title.textContent = '🔍 DOM Mode';
    Array.from(panel.children).forEach((c) => {
      if (c !== hdr && c !== domDiv && c !== termOut) (c as HTMLElement).style.display = 'none';
    });
      return true;
    };

    // The toolbar mounts on DOMContentLoaded; poll until it exists, then build once.
    if (!build()) {
      let tries = 0;
      const timer = setInterval(() => {
        if (build() || ++tries > 60) clearInterval(timer);
      }, 200);
    }
  });
}

function getInjectScript(resetOnStart: boolean): string {
  return `
(() => {
  if (window.__PW_CUSTOM_RECORDER_INSTALLED__) return;
  window.__PW_CUSTOM_RECORDER_INSTALLED__ = true;

  const MARK = ${JSON.stringify(MARK_ATTR)};
  const RESET_ON_START = ${JSON.stringify(resetOnStart)};

  let isRecording = false;
  let isGenerating = false;
  let captureMode = 'UI';
  const apiUrlFilterList = [];
  let isInspectorOpen = false;
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

    // Detect custom-dropdown options/triggers (PrimeReact, MUI, Ant, React-Select…)
    var roleAttr = (el.getAttribute('role') || '').toLowerCase();
    var isOption = !!(
      roleAttr === 'option' ||
      (el.closest && (el.closest('[role="option"]') ||
        el.closest('.p-dropdown-item,.p-multiselect-item,.ant-select-item-option,.MuiMenuItem-root,[class*="-option"],[class*="option-"],[class*="select__option"]')))
    );
    var hasPopup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
    var isDropdownTrigger = !!(
      roleAttr === 'combobox' || roleAttr === 'listbox' ||
      hasPopup === 'listbox' || hasPopup === 'true' ||
      (el.closest && el.closest('.p-dropdown,.p-multiselect,.ant-select,.MuiSelect-root,[class*="dropdown"],[class*="select__control"],[class*="combobox"]'))
    );

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
      isOption: isOption,
      isDropdownTrigger: isDropdownTrigger,
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
      'padding:6px 8px 8px',
      'border-radius:14px',
      'box-shadow:0 10px 30px rgba(0,0,0,0.25)',
      'display:flex',
      'flex-direction:column',
      'gap:4px',
      'backdrop-filter:blur(8px)',
    ].join(';'));

    // Drag handle + minimize button
    const toolbarDragHandle = document.createElement('div');
    toolbarDragHandle.setAttribute(
      'style',
      [
        'display:flex',
        'align-items:center',
        'justify-content:space-between',
        'cursor:grab',
        'padding:2px 2px 4px',
        'border-bottom:1px solid rgba(148,163,184,0.18)',
        'margin-bottom:2px',
        'user-select:none',
      ].join(';'),
    );
    const toolbarGrip = document.createElement('div');
    toolbarGrip.setAttribute('style', 'display:flex;gap:3px;align-items:center;');
    for (let gi = 0; gi < 3; gi++) {
      const col = document.createElement('div');
      col.setAttribute('style', 'display:flex;flex-direction:column;gap:3px;');
      for (let ri = 0; ri < 2; ri++) {
        const dot = document.createElement('div');
        dot.setAttribute('style', 'width:3px;height:3px;border-radius:50%;background:rgba(148,163,184,0.55);');
        col.appendChild(dot);
      }
      toolbarGrip.appendChild(col);
    }
    const toolbarMinBtn = document.createElement('button');
    toolbarMinBtn.type = 'button';
    toolbarMinBtn.textContent = '−';
    toolbarMinBtn.title = 'Minimize toolbar';
    toolbarMinBtn.setAttribute(
      'style',
      [
        'border:0',
        'background:transparent',
        'color:#94a3b8',
        'font-size:15px',
        'font-weight:700',
        'cursor:pointer',
        'padding:0 2px',
        'line-height:1',
      ].join(';'),
    );
    toolbarDragHandle.appendChild(toolbarGrip);
    toolbarDragHandle.appendChild(toolbarMinBtn);
    root.appendChild(toolbarDragHandle);

    // Collapsible body wrapping all toolbar content
    const toolbarBody = document.createElement('div');
    toolbarBody.id = '__pw_rec_toolbar_body__';
    toolbarBody.setAttribute('style', ['display:flex', 'flex-direction:column', 'gap:6px'].join(';'));

    let toolbarMinimized = false;
    toolbarMinBtn.addEventListener('click', () => {
      toolbarMinimized = !toolbarMinimized;
      toolbarBody.style.display = toolbarMinimized ? 'none' : 'flex';
      toolbarMinBtn.textContent = toolbarMinimized ? '+' : '−';
      toolbarMinBtn.title = toolbarMinimized ? 'Expand toolbar' : 'Minimize toolbar';
    });

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
        hideElementInfoPopup();
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

    // Top row: filename input + buttons
    const topRow = document.createElement('div');
    topRow.setAttribute('style', ['display:flex', 'gap:8px', 'align-items:center'].join(';'));
    topRow.appendChild(fileInput);
    toolbarBody.appendChild(topRow);

    const barRow = document.createElement('div');
    barRow.setAttribute('style', ['display:flex', 'gap:8px', 'align-items:center', 'flex-wrap:wrap'].join(';'));
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
      const needsApi = captureMode === 'API' || captureMode === 'UI+API';
      const urlFilterRow = document.getElementById('__pw_rec_url_filter_row__');
      if (urlFilterRow) urlFilterRow.style.display = needsApi ? 'flex' : 'none';
      if (isInspectorOpen) (async () => { try { await renderApiTab(); } catch {} })();
    });
    barRow.appendChild(captureSelect);
    barRow.appendChild(toggleBtn);
    barRow.appendChild(genBtn);
    topRow.appendChild(barRow);

    // URL filter row — only visible in API / UI+API mode
    const urlFilterRow = document.createElement('div');
    urlFilterRow.id = '__pw_rec_url_filter_row__';
    urlFilterRow.setAttribute(
      'style',
      [
        'display:none',
        'flex-direction:column',
        'gap:6px',
        'margin-top:2px',
        'padding:6px 8px',
        'border-radius:10px',
        'border:1px solid rgba(148,163,184,0.25)',
        'background:rgba(15,23,42,0.35)',
      ].join(';'),
    );

    const urlFilterLabel = document.createElement('span');
    urlFilterLabel.textContent = 'Capture URLs:';
    urlFilterLabel.setAttribute('style', 'font-size:11px;color:#94a3b8;font-weight:700;');

    const urlFieldStyle = [
      'padding:6px 8px',
      'border-radius:8px',
      'border:1px solid rgba(148,163,184,0.28)',
      'background:rgba(2,6,23,0.65)',
      'color:#e5e7eb',
      'font-size:11px',
      'outline:none',
    ].join(';');

    const urlAddRow = document.createElement('div');
    urlAddRow.setAttribute('style', 'display:flex;gap:6px;align-items:center;');

    const urlNameInput = document.createElement('input');
    urlNameInput.type = 'text';
    urlNameInput.id = '__pw_rec_url_name_input__';
    urlNameInput.placeholder = 'Name (e.g. api1)';
    urlNameInput.setAttribute('style', 'width:90px;flex-shrink:0;' + urlFieldStyle);

    const urlFilterInput = document.createElement('input');
    urlFilterInput.type = 'text';
    urlFilterInput.id = '__pw_rec_url_filter_input__';
    urlFilterInput.placeholder = 'https://api.example.com';
    urlFilterInput.setAttribute('style', 'flex:1;' + urlFieldStyle);

    const urlAddBtn = document.createElement('button');
    urlAddBtn.type = 'button';
    urlAddBtn.textContent = '+ Add';
    urlAddBtn.setAttribute(
      'style',
      [
        'border:0',
        'border-radius:8px',
        'padding:6px 10px',
        'cursor:pointer',
        'font-weight:700',
        'font-size:11px',
        'color:#fff',
        'white-space:nowrap',
        'background:rgba(37,99,235,0.85)',
        'flex-shrink:0',
      ].join(';'),
    );

    const urlChipsContainer = document.createElement('div');
    urlChipsContainer.id = '__pw_rec_url_chips__';
    urlChipsContainer.setAttribute('style', 'display:flex;flex-direction:column;gap:4px;');

    const renderUrlChips = () => {
      urlChipsContainer.innerHTML = '';
      apiUrlFilterList.forEach((entry, idx) => {
        const chip = document.createElement('div');
        chip.setAttribute(
          'style',
          [
            'display:flex',
            'align-items:center',
            'gap:6px',
            'background:rgba(37,99,235,0.12)',
            'border:1px solid rgba(37,99,235,0.30)',
            'border-radius:6px',
            'padding:4px 8px',
          ].join(';'),
        );
        const nameBadge = document.createElement('span');
        nameBadge.textContent = entry.name;
        nameBadge.setAttribute('style', 'font-size:10px;font-weight:800;color:#93c5fd;white-space:nowrap;flex-shrink:0;');
        const urlText = document.createElement('span');
        urlText.textContent = entry.url;
        urlText.setAttribute('style', 'font-size:11px;color:#e2e8f0;flex:1;word-break:break-all;');
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.textContent = '×';
        rmBtn.setAttribute('style', 'border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:14px;padding:0;line-height:1;flex-shrink:0;');
        rmBtn.onclick = () => {
          apiUrlFilterList.splice(idx, 1);
          renderUrlChips();
          if (window.pwRecorderSetApiUrlFilters) window.pwRecorderSetApiUrlFilters(apiUrlFilterList.slice()).catch(() => {});
        };
        chip.appendChild(nameBadge);
        chip.appendChild(urlText);
        chip.appendChild(rmBtn);
        urlChipsContainer.appendChild(chip);
      });
    };

    const addUrlFilter = () => {
      const url = urlFilterInput.value.trim();
      if (!url) return;
      const existingIdx = apiUrlFilterList.findIndex((e) => e.url === url);
      if (existingIdx >= 0) { urlFilterInput.value = ''; return; }
      const rawName = urlNameInput.value.trim();
      const name = rawName || ('api' + (apiUrlFilterList.length + 1));
      apiUrlFilterList.push({ name: name, url: url });
      urlNameInput.value = '';
      urlFilterInput.value = '';
      renderUrlChips();
      if (window.pwRecorderSetApiUrlFilters) window.pwRecorderSetApiUrlFilters(apiUrlFilterList.slice()).catch(() => {});
    };

    urlAddBtn.addEventListener('click', addUrlFilter);
    urlFilterInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addUrlFilter(); });
    urlNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') urlFilterInput.focus(); });

    urlAddRow.appendChild(urlNameInput);
    urlAddRow.appendChild(urlFilterInput);
    urlAddRow.appendChild(urlAddBtn);
    urlFilterRow.appendChild(urlFilterLabel);
    urlFilterRow.appendChild(urlAddRow);
    urlFilterRow.appendChild(urlChipsContainer);
    toolbarBody.appendChild(urlFilterRow);

    const inspectorBtn = document.createElement('button');
    inspectorBtn.type = 'button';
    inspectorBtn.id = '__pw_rec_btn_inspector__';
    inspectorBtn.textContent = 'Inspector';
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

    // AI Fix button removed (LLM features deleted). DOM Mode is the only generator.
    root.appendChild(toolbarBody);
    wrapper.appendChild(root);
    wireDraggableResizable(root, toolbarDragHandle, { resize: false });

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
        'height:70vh',
        'max-height:calc(100vh - 16px)',
        'z-index:2147483647',
        'background:rgba(2,6,23,0.92)',
        'border:1px solid rgba(148,163,184,0.35)',
        'border-radius:14px',
        'box-shadow:0 18px 54px rgba(0,0,0,0.35)',
        'box-sizing:border-box',
        'padding:12px',
        'overflow:hidden',
        'display:none',
        'flex-direction:column',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif',
        'resize:both',
        'min-width:320px',
        'min-height:240px',
      ].join(';'),
    );

    // ---- Single Inspector Panel with 3 tabs ----
    let activeTab = 'feature';
    const tabStyleActive = ['padding:6px 12px','border-radius:8px 8px 0 0','border:1px solid rgba(148,163,184,0.35)','border-bottom:2px solid rgba(37,99,235,0.95)','background:transparent','color:#e5e7eb','font-size:11px','font-weight:700','cursor:pointer','outline:none'].join(';');
    const tabStyleInactive = ['padding:6px 12px','border-radius:8px 8px 0 0','border:1px solid transparent','border-bottom:1px solid rgba(148,163,184,0.20)','background:transparent','color:#94a3b8','font-size:11px','font-weight:700','cursor:pointer','outline:none'].join(';');

    const panelHeader = document.createElement('div');
    panelHeader.setAttribute('style', ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:10px', 'flex-shrink:0'].join(';'));

    const panelTitle = document.createElement('div');
    panelTitle.textContent = 'Inspector — drag to move';
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

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.setAttribute('style', ['display:flex', 'gap:2px', 'margin-top:10px', 'flex-shrink:0', 'border-bottom:1px solid rgba(148,163,184,0.25)'].join(';'));

    const mkTabBtn = (label, id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.id = '__pw_rec_tab_' + id + '__';
      btn.setAttribute('style', tabStyleInactive);
      return btn;
    };
    const tabFeatureBtn = mkTabBtn('Feature file', 'feature');
    const tabApisBtn = mkTabBtn('Captured APIs', 'apis');
    const tabObjectsBtn = mkTabBtn('Captured Objects', 'objects');
    tabBar.appendChild(tabFeatureBtn);
    tabBar.appendChild(tabApisBtn);
    tabBar.appendChild(tabObjectsBtn);
    tabFeatureBtn.setAttribute('style', tabStyleActive);

    // Tab content wrapper
    const tabContent = document.createElement('div');
    tabContent.setAttribute('style', ['flex:1', 'overflow:hidden', 'display:flex', 'flex-direction:column', 'min-height:0', 'padding-top:8px'].join(';'));

    // --- Tab 1: Feature file ---
    const featureTabPane = document.createElement('div');
    featureTabPane.id = '__pw_rec_tab_pane_feature__';
    featureTabPane.setAttribute('style', 'display:flex;flex-direction:column;flex:1;min-height:0;');

    const featureEditor = document.createElement('textarea');
    featureEditor.id = '__pw_rec_feature_editor__';
    featureEditor.setAttribute(
      'style',
      [
        'flex:1',
        'width:100%',
        'min-height:120px',
        'resize:none',
        'padding:10px',
        'border-radius:12px',
        'border:1px solid rgba(148,163,184,0.25)',
        'background:rgba(15,23,42,0.35)',
        'color:#e5e7eb',
        'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
        'font-size:11px',
        'line-height:1.35',
        'box-sizing:border-box',
        'overflow:auto',
      ].join(';'),
    );
    featureEditor.placeholder = NO_STEPS_TEXT;
    featureEditor.value = NO_STEPS_TEXT;
    featureEditor.addEventListener('input', () => {
      if (suppressInspectorInput) return;
      inspectorDirty = true;
    });
    featureTabPane.appendChild(featureEditor);

    // Feature file tab footer: optional output paths + Generate File button
    const featureFooter = document.createElement('div');
    featureFooter.setAttribute(
      'style',
      [
        'margin-top:8px',
        'padding-top:8px',
        'border-top:1px solid rgba(148,163,184,0.20)',
        'display:flex',
        'flex-direction:column',
        'gap:6px',
        'flex-shrink:0',
      ].join(';'),
    );

    const pathFieldStyle = [
      'width:100%', 'padding:6px 8px', 'border-radius:8px',
      'border:1px solid rgba(148,163,184,0.30)', 'background:rgba(15,23,42,0.5)',
      'color:#e5e7eb', 'outline:none', 'font-size:11px', 'box-sizing:border-box', 'font-family:monospace',
    ].join(';');
    const mkPathRow = (labelText, placeholder, id) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('div');
      lab.textContent = labelText;
      lab.setAttribute('style', 'font-size:10px;color:#94a3b8;margin-bottom:2px');
      const input = document.createElement('input');
      input.type = 'text';
      input.id = id;
      input.placeholder = placeholder;
      input.setAttribute('style', pathFieldStyle);
      wrap.appendChild(lab);
      wrap.appendChild(input);
      return { wrap, input };
    };
    const featPathRow = mkPathRow(
      'Feature file path (leave blank for auto: feature/generated/<category>/<name>.feature)',
      'feature/generated/web/my-flow.feature',
      '__pw_rec_feature_path__',
    );
    const locPathRow = mkPathRow(
      'Locator folder (leave blank for auto: locators/generated/<category>/)',
      'locators/generated/web',
      '__pw_rec_locator_path__',
    );
    featureFooter.appendChild(featPathRow.wrap);
    featureFooter.appendChild(locPathRow.wrap);

    const genBtnRow = document.createElement('div');
    genBtnRow.setAttribute('style', 'display:flex;justify-content:flex-end');

    const genFileBtn = document.createElement('button');
    genFileBtn.type = 'button';
    genFileBtn.textContent = 'Generate File';
    genFileBtn.setAttribute(
      'style',
      [
        'border:0',
        'border-radius:10px',
        'padding:8px 14px',
        'cursor:pointer',
        'font-weight:700',
        'font-size:12px',
        'color:#fff',
        'background:linear-gradient(135deg,#059669,#10b981)',
      ].join(';'),
    );
    genFileBtn.addEventListener('click', async () => {
      if (isGenerating) return;
      isGenerating = true;
      genFileBtn.textContent = 'Generating...';
      genFileBtn.disabled = true;
      try {
        const fileInputEl = document.getElementById('__pw_rec_filename__');
        const rawName = fileInputEl && typeof fileInputEl.value === 'string' ? fileInputEl.value.trim() : '';
        const currentFileName = rawName || 'recorded-flow';
        const currentText = String(featureEditor.value || '').trim();
        if (!currentText || currentText === NO_STEPS_TEXT) {
          alert('Feature file is empty. Add some steps first.');
          return;
        }
        const fpEl = document.getElementById('__pw_rec_feature_path__');
        const lpEl = document.getElementById('__pw_rec_locator_path__');
        const featurePathOverride = fpEl && typeof fpEl.value === 'string' ? fpEl.value.trim() : '';
        const locatorDirOverride = lpEl && typeof lpEl.value === 'string' ? lpEl.value.trim() : '';
        if (window.pwRecorderGenerate) {
          await window.pwRecorderGenerate({
            featureText: featureEditor.value,
            useEdited: true,
            fileName: currentFileName,
            featurePathOverride,
            locatorDirOverride,
          });
        }
      } catch (err) {
        console.error(err);
        alert('Generate failed — see console');
      } finally {
        isGenerating = false;
        genFileBtn.textContent = 'Generate File';
        genFileBtn.disabled = false;
      }
    });
    genBtnRow.appendChild(genFileBtn);
    featureFooter.appendChild(genBtnRow);
    featureTabPane.appendChild(featureFooter);

    // --- Tab 2: Captured APIs ---
    const apisTabPane = document.createElement('div');
    apisTabPane.id = '__pw_rec_tab_pane_apis__';
    apisTabPane.setAttribute('style', 'display:none;flex-direction:column;flex:1;min-height:0;overflow:hidden;');

    const apiNoModeHint = document.createElement('div');
    apiNoModeHint.id = '__pw_rec_api_no_mode_hint__';
    apiNoModeHint.textContent = 'Switch capture mode to API or UI+API to capture APIs.';
    apiNoModeHint.setAttribute('style', ['font-size:12px', 'color:#94a3b8', 'margin-bottom:8px', 'display:none'].join(';'));

    const apiSectionHint = document.createElement('div');
    apiSectionHint.textContent = 'Delete removes the API call from preview + generated feature.';
    apiSectionHint.setAttribute('style', ['font-size:11px', 'color:#94a3b8', 'margin-bottom:8px', 'flex-shrink:0'].join(';'));

    const apiInlineList = document.createElement('div');
    apiInlineList.id = '__pw_rec_api_inline_list__';
    apiInlineList.setAttribute(
      'style',
      [
        'display:flex',
        'flex-direction:column',
        'gap:8px',
        'flex:1',
        'overflow:auto',
        'padding:6px',
        'border-radius:10px',
        'border:1px solid rgba(148,163,184,0.12)',
        'background:rgba(15,23,42,0.18)',
      ].join(';'),
    );

    const inputStyle = [
      'box-sizing:border-box',
      'padding:7px 10px',
      'border-radius:8px',
      'border:1px solid rgba(148,163,184,0.25)',
      'background:rgba(15,23,42,0.55)',
      'color:#e5e7eb',
      'font-size:12px',
      'outline:none',
    ].join(';');

    const apiFilterBar = document.createElement('div');
    apiFilterBar.setAttribute('style', ['display:flex', 'flex-direction:column', 'gap:6px', 'margin-bottom:8px', 'flex-shrink:0'].join(';'));

    const apiFilterInput = document.createElement('input');
    apiFilterInput.type = 'text';
    apiFilterInput.id = '__pw_rec_api_filter_input__';
    apiFilterInput.placeholder = 'Filter by URL...';
    apiFilterInput.setAttribute('style', 'width:100%;' + inputStyle);

    const apiFilterRow2 = document.createElement('div');
    apiFilterRow2.setAttribute('style', ['display:flex', 'gap:6px'].join(';'));

    const apiMethodSelect = document.createElement('select');
    apiMethodSelect.id = '__pw_rec_api_method_select__';
    apiMethodSelect.setAttribute('style', ['flex:0 0 auto', inputStyle].join(';'));
    ['All', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m === 'All' ? '' : m;
      opt.textContent = m;
      apiMethodSelect.appendChild(opt);
    });

    const apiStatusInput = document.createElement('input');
    apiStatusInput.type = 'text';
    apiStatusInput.id = '__pw_rec_api_status_input__';
    apiStatusInput.placeholder = 'Status (200, 4, 404...)';
    apiStatusInput.setAttribute('style', ['flex:1', inputStyle].join(';'));

    apiFilterRow2.appendChild(apiMethodSelect);
    apiFilterRow2.appendChild(apiStatusInput);
    apiFilterBar.appendChild(apiFilterInput);
    apiFilterBar.appendChild(apiFilterRow2);

    const triggerApiRerender = () => { (async () => { try { await renderApiTab(); } catch {} })(); };
    apiFilterInput.addEventListener('input', triggerApiRerender);
    apiMethodSelect.addEventListener('change', triggerApiRerender);
    apiStatusInput.addEventListener('input', triggerApiRerender);

    apisTabPane.appendChild(apiNoModeHint);
    apisTabPane.appendChild(apiFilterBar);
    apisTabPane.appendChild(apiSectionHint);
    apisTabPane.appendChild(apiInlineList);

    // --- Tab 3: Captured Objects ---
    const objectsTabPane = document.createElement('div');
    objectsTabPane.id = '__pw_rec_tab_pane_objects__';
    objectsTabPane.setAttribute('style', 'display:none;flex-direction:column;flex:1;min-height:0;overflow:hidden;');

    const objectStatus = document.createElement('div');
    objectStatus.id = '__pw_rec_object_inspector_status__';
    objectStatus.setAttribute('style', ['font-size:12px', 'color:#94a3b8', 'margin-bottom:8px', 'flex-shrink:0'].join(';'));
    objectStatus.textContent = '';

    const objectList = document.createElement('div');
    objectList.id = '__pw_rec_object_inspector_list__';
    objectList.setAttribute('style', ['flex:1', 'display:flex', 'flex-direction:column', 'gap:8px', 'overflow:auto'].join(';'));

    const objectFooter = document.createElement('div');
    objectFooter.setAttribute('style', ['margin-top:10px', 'padding-top:10px', 'border-top:1px solid rgba(148,163,184,0.20)', 'display:flex', 'justify-content:flex-end', 'flex-shrink:0'].join(';'));
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
    objectsTabPane.appendChild(objectStatus);
    objectsTabPane.appendChild(objectList);
    objectsTabPane.appendChild(objectFooter);

    tabContent.appendChild(featureTabPane);
    tabContent.appendChild(apisTabPane);
    tabContent.appendChild(objectsTabPane);

    panel.appendChild(panelHeader);
    panel.appendChild(tabBar);
    panel.appendChild(tabContent);
    wrapper.appendChild(panel);

    wireDraggableResizable(panel, panelTitle, { minW: 300, minH: 220 });

    // Tab switching
    const switchTab = (tab) => {
      activeTab = tab;
      const paneMap = { feature: featureTabPane, apis: apisTabPane, objects: objectsTabPane };
      const btnMap = { feature: tabFeatureBtn, apis: tabApisBtn, objects: tabObjectsBtn };
      for (const [k, pane] of Object.entries(paneMap)) {
        pane.style.display = k === tab ? 'flex' : 'none';
      }
      for (const [k, btn] of Object.entries(btnMap)) {
        btn.setAttribute('style', k === tab ? tabStyleActive : tabStyleInactive);
      }
      if (tab === 'apis') (async () => { try { await renderApiTab(); } catch {} })();
      if (tab === 'objects') void loadCapturedObjects();
    };

    tabFeatureBtn.addEventListener('click', () => switchTab('feature'));
    tabApisBtn.addEventListener('click', () => switchTab('apis'));
    tabObjectsBtn.addEventListener('click', () => switchTab('objects'));

    // Captured Objects logic
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

    // Captured APIs render
    const renderApiTab = async () => {
      try {
        const listEl = document.getElementById('__pw_rec_api_inline_list__');
        const noModeHint = document.getElementById('__pw_rec_api_no_mode_hint__');
        if (!listEl) return;
        const cm = String(captureMode || '').toUpperCase();
        if (cm === 'UI') {
          if (noModeHint) noModeHint.style.display = 'block';
          listEl.innerHTML = '';
          return;
        }
        if (noModeHint) noModeHint.style.display = 'none';
        const allRows = window.pwRecorderGetCapturedApis ? await window.pwRecorderGetCapturedApis().catch(() => []) : [];
        const filterEl = document.getElementById('__pw_rec_api_filter_input__');
        const methodEl = document.getElementById('__pw_rec_api_method_select__');
        const statusEl = document.getElementById('__pw_rec_api_status_input__');
        const urlFilter = filterEl ? String(filterEl.value || '').trim().toLowerCase() : '';
        const methodFilter = methodEl ? String(methodEl.value || '').trim().toUpperCase() : '';
        const statusFilter = statusEl ? String(statusEl.value || '').trim() : '';
        const rows = (allRows || []).filter((r) => {
          if (urlFilter && !String(r.fullUrl || r.url || '').toLowerCase().includes(urlFilter)) return false;
          if (methodFilter && String(r.method || '').toUpperCase() !== methodFilter) return false;
          if (statusFilter && !String(r.status ?? '').startsWith(statusFilter)) return false;
          return true;
        });
        listEl.innerHTML = '';
        if (!rows.length) {
          const hasFilter = urlFilter || methodFilter || statusFilter;
          const msg = hasFilter ? 'No APIs match the current filters.' : 'No APIs captured yet.';
          listEl.innerHTML = '<div style="font-size:12px;color:#94a3b8;padding:8px;">' + msg + '</div>';
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
          const urlEl = document.createElement('div');
          urlEl.textContent = String(r.fullUrl || r.url || '');
          urlEl.setAttribute('style', ['font-size:12px', 'color:#e2e8f0', 'word-break:break-all'].join(';'));
          top.appendChild(badge);
          top.appendChild(urlEl);
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
            void renderApiTab();
          };
          card.appendChild(left);
          card.appendChild(del);
          listEl.appendChild(card);
        });
      } catch {}
    };

    const setInspectorOpen = (open, tab) => {
      isInspectorOpen = !!open;
      const panelEl = document.getElementById('__pw_rec_inspector_panel__');
      if (panelEl) panelEl.style.display = isInspectorOpen ? 'flex' : 'none';
      if (isInspectorOpen) {
        switchTab(tab || activeTab || 'feature');
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

    // Allow the element-info popup to open the Objects tab from outside mountUi()
    window.__pwRecOpenObjectsTab = () => {
      setInspectorOpen(true, 'objects');
      void loadCapturedObjects();
    };

    // Append a Gherkin step for a picked element and mark the editor dirty
    window.__pwRecAppendToFeature = (info) => {
      const editorEl = document.getElementById('__pw_rec_feature_editor__');
      if (!editorEl) return;
      const eName = String(info && info.name ? info.name : '');
      const eStrategy = String(info && info.strategy ? info.strategy : '');
      const eLocator = String(info && info.locatorValue ? info.locatorValue : '').toLowerCase();

      // Infer Gherkin step from element type
      const isInputEl = eStrategy === 'getByLabel' || eStrategy === 'getByPlaceholder'
        || eLocator.indexOf("'textbox'") >= 0 || eLocator.indexOf('"textbox"') >= 0
        || eLocator.indexOf("'searchbox'") >= 0 || eLocator.indexOf("'spinbutton'") >= 0;
      const isButtonEl = eStrategy === 'getByRole'
        && (eLocator.indexOf("'button'") >= 0 || eLocator.indexOf('"button"') >= 0);
      const isLinkEl = (eStrategy === 'getByRole'
        && (eLocator.indexOf("'link'") >= 0 || eLocator.indexOf('"link"') >= 0))
        || eStrategy === 'getByText';

      const step = isInputEl
        ? 'When User enters "" text in "' + eName + '" textbox'
        : isButtonEl
          ? 'When User clicks on "' + eName + '" button'
          : isLinkEl
            ? 'When User clicks on "' + eName + '" link'
            : 'When User clicks on "' + eName + '" element';

      const current = String(editorEl.value || '');
      const isEmpty = !current.trim() || current === NO_STEPS_TEXT;
      let newContent;
      if (isEmpty) {
        const fileInputEl = document.getElementById('__pw_rec_filename__');
        const rawName = fileInputEl && typeof fileInputEl.value === 'string' ? fileInputEl.value.trim() : '';
        const screenName = rawName || 'testscreen';
        const currentUrl = window.location.href || '';
        newContent = 'Feature: Auto Generated Test\\n\\n  Scenario: User flow\\n\\n    Given User navigates to "' + currentUrl + '" URL\\n    Given User is on "' + screenName + '" screen\\n    ' + step + '\\n';
      } else {
        newContent = current.trimEnd() + '\\n    ' + step + '\\n';
      }
      editorEl.value = newContent;
      generatedFeatureContent = newContent;
      inspectorDirty = true;
    };

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
        if (activeTab === 'apis') (async () => { try { await renderApiTab(); } catch {} })();
        if (activeTab === 'objects') void loadCapturedObjects();
      } catch {}
    };

    generatedFeatureContent = NO_STEPS_TEXT;
    window.__pwRecorderRender({ featureContent: NO_STEPS_TEXT, force: true });

    updateToggleUi(toggleBtn);
    ensureHoverUi();
    try { void renderApiTab(); } catch {}

    // Restore recording state after a navigation/page reload. The server keeps the
    // real recording flag alive across page loads; sync this fresh page to it so
    // recording continues seamlessly when the user clicks links/buttons that navigate.
    if (window.pwRecorderGetRecordingState) {
      window.pwRecorderGetRecordingState().then((s) => {
        if (s && s.recording) {
          isRecording = true;
          updateToggleUi(toggleBtn);
        }
        // Always re-pull the accumulated feature preview so steps captured on
        // earlier pages remain visible after navigating to a new page.
        if (window.pwRecorderRequestSync) window.pwRecorderRequestSync().catch(() => {});
      }).catch(() => {});
    }
  }

  function hideElementInfoPopup() {
    const p = document.getElementById('__pw_rec_element_info_popup__');
    if (p) p.style.display = 'none';
  }

  function showElementInfoPopup(x, y, name, strategy, locatorValue, fallback) {
    let popup = document.getElementById('__pw_rec_element_info_popup__');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = '__pw_rec_element_info_popup__';
      popup.setAttribute(
        'style',
        [
          'position:fixed',
          'z-index:2147483647',
          'background:rgba(2,6,23,0.96)',
          'border:1px solid rgba(5,150,105,0.6)',
          'border-radius:12px',
          'padding:14px 16px 12px',
          'min-width:300px',
          'max-width:440px',
          'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
          'font-family:system-ui,Segoe UI,Roboto,sans-serif',
          'display:none',
        ].join(';'),
      );
      const uiRoot = document.getElementById('pw-recorder-ui-root') || document.body;
      uiRoot.appendChild(popup);
    }

    const infoRow = (label, val) =>
      '<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:5px;">' +
        '<span style="font-size:11px;font-weight:700;color:#94a3b8;white-space:nowrap;min-width:68px;">' + label + '</span>' +
        '<span style="font-size:11px;color:#e2e8f0;word-break:break-all;line-height:1.4;">' + val + '</span>' +
      '</div>';

    const safeVal = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    popup.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
        '<span style="font-size:12px;font-weight:800;color:#34d399;">Captured Element</span>' +
        '<button id="__pw_rec_eip_close__" type="button" style="border:0;background:transparent;color:#94a3b8;font-size:14px;cursor:pointer;padding:2px 6px;border-radius:6px;">✕</button>' +
      '</div>' +
      '<div style="margin-bottom:8px;">' +
        '<label style="font-size:11px;font-weight:700;color:#94a3b8;display:block;margin-bottom:4px;">Element Name</label>' +
        '<input id="__pw_rec_eip_name__" type="text" value="' + safeVal(name) + '" ' +
          'style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid rgba(148,163,184,0.3);background:rgba(15,23,42,0.5);color:#e5e7eb;font-size:12px;font-weight:700;outline:none;" />' +
      '</div>' +
      infoRow('Strategy', strategy || 'xpath') +
      infoRow('Locator', locatorValue || '') +
      (fallback && fallback !== locatorValue ? infoRow('XPath', fallback) : '') +
      '<div style="margin-top:12px;display:flex;gap:8px;">' +
        '<button id="__pw_rec_eip_add__" type="button" style="flex:1;padding:8px 10px;border-radius:8px;border:0;background:rgba(5,150,105,0.9);color:#fff;font-size:11px;font-weight:800;cursor:pointer;">Add to YAML &amp; Feature</button>' +
        '<button id="__pw_rec_eip_copy__" type="button" style="padding:8px 10px;border-radius:8px;border:0;background:rgba(148,163,184,0.15);color:#94a3b8;font-size:11px;font-weight:700;cursor:pointer;">Copy</button>' +
      '</div>' +
      '<div id="__pw_rec_eip_status__" style="margin-top:6px;font-size:11px;color:#34d399;min-height:14px;"></div>';

    // Position near click, keep within viewport
    const margin = 12;
    popup.style.display = 'block';
    const pw = popup.offsetWidth || 320;
    const ph = popup.offsetHeight || 200;
    let left = x + 14;
    let top = y + 14;
    if (left + pw > window.innerWidth - margin) left = x - pw - 14;
    if (top + ph > window.innerHeight - margin) top = y - ph - 14;
    popup.style.left = Math.max(margin, left) + 'px';
    popup.style.top = Math.max(margin, top) + 'px';

    const closeEl = document.getElementById('__pw_rec_eip_close__');
    if (closeEl) closeEl.onclick = () => { hideElementInfoPopup(); };

    const copyEl = document.getElementById('__pw_rec_eip_copy__');
    if (copyEl) {
      copyEl.onclick = () => {
        try {
          navigator.clipboard.writeText(locatorValue || '').then(() => {
            copyEl.textContent = 'Copied!';
            setTimeout(() => { copyEl.textContent = 'Copy'; }, 1200);
          });
        } catch (ex) { copyEl.textContent = 'Copy failed'; }
      };
    }

    const addEl = document.getElementById('__pw_rec_eip_add__');
    const statusEl = document.getElementById('__pw_rec_eip_status__');
    if (addEl) {
      addEl.onclick = async () => {
        const nameInput = document.getElementById('__pw_rec_eip_name__');
        const finalName = nameInput ? String(nameInput.value || '').trim() : (name || '');
        if (!finalName) {
          if (statusEl) statusEl.textContent = 'Please enter an element name.';
          return;
        }
        addEl.disabled = true;
        addEl.textContent = 'Adding...';
        try {
          // 1. Save to server-side pickedObjects — prefer XPath (fallback) for stable YAML
          if (window.pwRecorderAddPickedObject) {
            const yamlStrategy = fallback ? 'xpath' : (strategy || 'xpath');
            const yamlValue = fallback || locatorValue || '';
            await window.pwRecorderAddPickedObject({ element: finalName, strategy: yamlStrategy, value: yamlValue });
          }

          // 2. Append Gherkin step to feature editor (via helper that also marks dirty)
          if (window.__pwRecAppendToFeature) {
            window.__pwRecAppendToFeature({ name: finalName, strategy: strategy || 'xpath', locatorValue: locatorValue || '', fallback: fallback || '' });
          }

          // 3. Open Inspector on Objects tab so user can see + Generate YAML
          if (window.__pwRecOpenObjectsTab) window.__pwRecOpenObjectsTab();

          if (statusEl) statusEl.textContent = 'Added! See Objects tab → Generate YAML.';
          addEl.textContent = 'Added ✓';
        } catch (ex) {
          if (statusEl) statusEl.textContent = 'Error: ' + String(ex && ex.message ? ex.message : ex);
          addEl.disabled = false;
          addEl.textContent = 'Add to YAML & Feature';
        }
      };
    }
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
    const elementText = String(o.elementText || '').trim();
    const suggestedName = String(o.suggestedName || '').trim();

    // Priority: selected text → table cell text → the element's own text.
    const textToRecord = st || cellTextForAssert || elementText;
    const canVerifyText = !!(textToRecord && textToRecord.length);
    const canWebTable = !!(tableForMenu && tableForMenu.tagName && String(tableForMenu.tagName).toLowerCase() === 'table');

    if (btnText) {
      btnText.textContent = 'Verify text';
      btnText.style.display = canVerifyText ? '' : 'none';
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
      // Only show the web-table option when right-clicking inside an actual table.
      btnTable.textContent = 'Verify web table';
      btnTable.style.display = canWebTable ? '' : 'none';
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

  // Returns the nearest interactive element to record a click on, or null.
  // Covers custom/clickable elements (menu items, cards, div-buttons) that are
  // NOT plain <a>/<button>/<input> — so clicks on them still generate a step.
  function findClickableElement(start) {
    try {
      let el = start && start.nodeType === 1 ? start : (start && start.parentElement) || null;
      const INTERACTIVE_ROLES = ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'checkbox', 'radio', 'switch', 'treeitem'];
      let depth = 0;
      while (el && el.nodeType === 1 && depth < 6) {
        if (el.closest && el.closest('#pw-recorder-ui-root')) return null;
        const tag = String(el.tagName || '').toLowerCase();
        if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return el;
        const role = String(el.getAttribute && el.getAttribute('role') ? el.getAttribute('role') : '').toLowerCase();
        if (role && INTERACTIVE_ROLES.includes(role)) return el;
        if (el.hasAttribute && (el.hasAttribute('onclick') || el.hasAttribute('ng-click') || el.hasAttribute('@click') || el.hasAttribute('data-click'))) return el;
        if (el.getAttribute && el.getAttribute('tabindex') !== null && el.getAttribute('tabindex') !== '-1') return el;
        try {
          const cs = window.getComputedStyle(el);
          if (cs && cs.cursor === 'pointer') return el;
        } catch (e) {}
        el = el.parentElement;
        depth++;
      }
    } catch (e) {}
    return null;
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
      let { colIdx, rowIdx, selHeaders, selRows } = getSelectedProjection();

      if (!tableName) {
        error.textContent = 'Table name is required.';
        error.style.display = 'block';
        return;
      }

      // No manual cell selection → capture the FULL table (all columns + all rows).
      // This is the default the user expects: verify the whole table's data.
      if (!selectedCells.size || !colIdx.length || !selRows.length) {
        const MAX_ROWS = 50; // keep the generated step readable
        colIdx = headers.map((_, i) => i);
        rowIdx = rows.slice(0, MAX_ROWS).map((_, i) => i);
        selHeaders = headers.slice();
        selRows = rows.slice(0, MAX_ROWS).map((r) => {
          const out = [];
          for (let i = 0; i < colIdx.length; i++) out.push(r[i] !== undefined ? r[i] : '');
          return out;
        });
      }

      if (!colIdx.length || !selRows.length) {
        error.textContent = 'No table data found to capture.';
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

  // Right-click when not recording shows the element capture popup
  document.addEventListener('contextmenu', (e) => {
    if (isRecording || isGenerating) return;
    const raw = e.target;
    if (!raw || !raw.closest) return;
    if (raw.closest('#pw-recorder-ui-root')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = raw.nodeType === 1 ? raw : (raw.parentElement || null);
    if (!el || !el.setAttribute) return;
    const mark = uid();
    el.setAttribute(MARK, mark);
    const payload = { markId: mark, snapshot: snap(el) };
    if (window.pwRecorderHoverPreview) {
      window.pwRecorderHoverPreview(payload).then((resp) => {
        try { el.removeAttribute(MARK); } catch (ex) {}
        if (!resp) return;
        const strategy = (resp.locator || '').split('(')[0] || 'xpath';
        showElementInfoPopup(e.clientX, e.clientY, resp.name || '', strategy, resp.locator || '', resp.fallback || '');
      }).catch(() => { try { el.removeAttribute(MARK); } catch (ex) {} });
    }
  });

  document.addEventListener('click', (e) => {
    const raw = e.target;
    if (!raw || !raw.closest) return;
    if (raw.closest('#pw-recorder-ui-root')) return;

    if (!isRecording || isGenerating) return;

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
        } else if (looksLikeTextElement(el) && !findClickableElement(el)) {
          // Only treat as a "verify text" target when it is NOT a clickable element.
          const t = getVisibleTextFromElement(el);
          if (t && t.length) {
            showTextConfirmTooltip(e.clientX || 10, e.clientY || 10, t);
          }
        }
      }
    } catch (err) {}

    // The exposeFunction binding dispatches the report payload synchronously at
    // call time, so the click is captured before the page navigates. (No need to
    // hijack navigation — that broke SPA links and normal link recording.)
    if (raw.tagName === 'INPUT') {
      const t = (raw.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') { void report('checkbox', raw, {}); return; }
      if (t === 'radio') { void report('radio', raw, {}); return; }
      if (t === 'submit' || t === 'button') { void report('click', raw, {}); return; }
    }

    // Label wrapping a radio/checkbox — clicking the label triggers the input.
    // Walk up to find a <label> or element with role="radio"/"checkbox", then
    // locate the associated input so we record the correct action type.
    const labelEl = raw.closest && raw.closest('label');
    if (labelEl) {
      // Explicit <label for="id"> association
      const forId = labelEl.getAttribute('for');
      const assocInput = forId ? document.getElementById(forId) : labelEl.querySelector('input[type="radio"],input[type="checkbox"]');
      if (assocInput) {
        const itype = (assocInput.getAttribute('type') || '').toLowerCase();
        if (itype === 'radio')    { void report('radio',    assocInput, {}); return; }
        if (itype === 'checkbox') { void report('checkbox', assocInput, {}); return; }
      }
    }

    // ARIA role="radio" / role="checkbox" (e.g. custom component libraries)
    const ariaRole = raw.closest && (raw.closest('[role="radio"]') || raw.closest('[role="checkbox"]'));
    if (ariaRole) {
      const role = ariaRole.getAttribute('role');
      if (role === 'radio')    { void report('radio',    ariaRole, {}); return; }
      if (role === 'checkbox') { void report('checkbox', ariaRole, {}); return; }
    }

    const link = raw.closest && raw.closest('a');
    if (link) { void report('click', link, {}); return; }

    const button = raw.closest && raw.closest('button');
    if (button) { void report('click', button, {}); return; }

    const roleBtn = raw.closest && raw.closest('[role=\"button\"]');
    if (roleBtn) { void report('click', roleBtn, {}); return; }

    // Fallback: record clicks on other interactive elements (menu items, tabs,
    // cards, div-buttons with click handlers or cursor:pointer) so they still
    // generate a Gherkin step instead of being silently ignored.
    const clickable = findClickableElement(raw);
    if (clickable) { void report('click', clickable, {}); return; }
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
    // Fallback text = the right-clicked element's own visible text, so the user can
    // verify text by just right-clicking on it (no manual selection required).
    const elementText = cleanInlineText(getVisibleTextFromElement(el) || el.innerText || el.textContent || '');
    showQuickAssertMenu(e.clientX || 10, e.clientY || 10, st, {
      tableEl: tableElCtx || null,
      cellText: cellTextCtx,
      elementText,
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
    if (!el || !el.matches) return;
    if (el.closest && el.closest('#pw-recorder-ui-root')) return;
    const rect = el.getBoundingClientRect && el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const cs = window.getComputedStyle && window.getComputedStyle(el);
    if (cs && cs.visibility === 'hidden') return;

    if (el.matches('select')) { void report('select', el, {}); return; }

    // Radio/checkbox change events — fired when state toggles via keyboard or
    // programmatic click; acts as a safety net when the click listener misses them.
    if (el.matches('input[type="radio"]'))    { void report('radio',    el, {}); return; }
    if (el.matches('input[type="checkbox"]')) { void report('checkbox', el, {}); return; }
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
      // Custom-dropdown option pick → emit a select marked for pairing with the
      // preceding trigger click (PrimeReact/MUI/Ant/React-Select render options as
      // <li>/<div> with role=option, not native <option>).
      if (snap.isOption) {
        return {
          type: 'select',
          href,
          element: resolvedName,
          value: resolvedName,
          locator,
          controlKind: 'select',
          fromOption: true,
        };
      }
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
        // Mark dropdown triggers so pairing can fold the next option pick into them.
        controlKind: snap.isDropdownTrigger ? 'select' : 'button',
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

/**
 * Folds custom-dropdown click sequences into single select steps, mirroring the
 * codegen specParser logic:
 *   Dropdown:    [trigger click]  + [option pick]            → select
 *   AutoComplete:[field fill]      + [option pick]            → select
 *   MultiSelect: [trigger click]  + [option pick] [pick]...  → select "a, b, c"
 * Option picks are flagged with `fromOption` by mapPayloadToAction.
 */
function pairCustomDropdownActions(actions: RecordedAction[]): RecordedAction[] {
  const out: RecordedAction[] = [];
  for (const action of actions) {
    if (action.fromOption) {
      const prev = out[out.length - 1];
      const optValue = String(action.value ?? action.element);

      // MultiSelect: append to an already-built select
      if (prev && prev.type === 'select') {
        const existing = String(prev.value ?? '').trim();
        const parts = existing ? existing.split(',').map((s) => s.trim()) : [];
        if (!parts.includes(optValue)) parts.push(optValue);
        prev.value = parts.join(', ');
        continue;
      }

      // Fold trigger click / field fill into a select
      const triggerOk = prev && (prev.type === 'click' || prev.type === 'input') &&
        (prev.controlKind === 'select' || prev.controlKind === 'button' || prev.controlKind === 'textbox');
      if (triggerOk) {
        out[out.length - 1] = {
          type: 'select',
          element: prev.element,
          value: optValue,
          controlKind: 'select',
          href: prev.href,
          locator: prev.locator && prev.locator[1] ? prev.locator : action.locator,
          timestamp: prev.timestamp,
        };
        continue;
      }

      // Standalone option pick — keep as a select on the option itself
      const { fromOption, ...rest } = action;
      out.push(rest);
      continue;
    }
    out.push(action);
  }
  return out;
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
  const pickedObjects: InspectorObjectRow[] = [];
  let apiCaptureStop: (() => void) | undefined;
  let captureSelection: 'UI' | 'API' | 'UI+API' = 'UI';
  let apiUrlFilters: { name: string; url: string }[] = [];
  const buildUrlAliases = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const f of apiUrlFilters) { if (f.name && f.url) out[f.name] = f.url; }
    return out;
  };
  const filterUrls = (): string[] => apiUrlFilters.map((f) => f.url).filter(Boolean);
  let recorderIsRecording = false;
  let lastUrl = startUrl;
  let initialPageTitle = '';
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
      const aliases = buildUrlAliases();
      const apiSteps = apiEnabled ? generateApiStepsFromCapturedApis(capturedApis, aliases) : '';

      const previewActions = pairCustomDropdownActions(actions);
      let featureContent: string;
      if (uiEnabled && apiEnabled && actions.length && capturedApis.length) {
        // UI + API: interleave by timestamp so APIs sit where they actually fired.
        featureContent = rewriteWebTableStep(
          convertToInterleavedArtifacts(previewActions, apiEventsFromCaptured(capturedApis, aliases), {
            scenarioTitle,
            scenarioUrl: lastUrl,
            featureFile: '__pw_tmp.feature',
            pageKey: previewPageKey,
          }).featureContent,
        );
      } else {
        const uiFeature =
          uiEnabled && actions.length
            ? rewriteWebTableStep(
                convertToArtifacts(previewActions, {
                  scenarioTitle,
                  scenarioUrl: lastUrl,
                  featureFile: '__pw_tmp.feature',
                  pageKey: previewPageKey,
                }).featureContent,
              )
            : '';
        featureContent =
          uiFeature && apiSteps
            ? `${uiFeature}\n${apiSteps}\n`
            : uiFeature
              ? uiFeature
              : apiSteps
                ? generateFeatureFromCapturedApis({
                    capturedApis,
                    featureName: 'Auto Generated Test',
                    scenarioName: scenarioTitle,
                    urlAliases: aliases,
                  })
                : NO_STEPS_TEXT;
      }

      await page.evaluate(
        (payload) => {
          (window as any).__pwRecorderRender?.(payload);
        },
        { featureContent, force: forceFeature },
      );
    } catch (err) {
      // Surface the error so we can diagnose why the preview isn't updating.
      // eslint-disable-next-line no-console
      console.error('[recorder] syncUi failed:', err instanceof Error ? err.stack || err.message : err);
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

    action.timestamp = Date.now();
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

    // Diagnostic: confirm the browser→server bridge fires and which mode is active.
    // eslint-disable-next-line no-console
    console.log(`[recorder] report received: type=${payload?.type} mode=${captureSelection} recordUi=${shouldRecordUiActions()}`);

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
    action.timestamp = Date.now();
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
          timestamp: Date.now(),
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
          timestamp: Date.now(),
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

    // Merge manually picked objects (from Pick mode) — these take precedence by name
    for (const p of pickedObjects) {
      const key = String(p.element || '').toLowerCase();
      if (key) byName.set(key, p);
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
    'pwRecorderAddPickedObject',
    async (args?: { element?: string; strategy?: string; value?: string }) => {
      const element = capitalizeWords(String(args?.element || '').trim());
      const strategy = String(args?.strategy || 'xpath').trim();
      const value = String(args?.value || '').trim();
      if (!element || !value) return { ok: false, message: 'element and value are required' };
      const key = element.toLowerCase();
      const existingIdx = pickedObjects.findIndex((p) => p.element.toLowerCase() === key);
      const row: InspectorObjectRow = { element, locator: [strategy, value] };
      if (existingIdx >= 0) {
        pickedObjects[existingIdx] = row;
      } else {
        pickedObjects.push(row);
      }
      return { ok: true };
    },
  );

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

        // Write companion API URL config if any named filters are active
        const urlConfigPath = path.join(generatedDir, `${fileNameSafe}-api-config.yaml`);
        const namedFilters = apiUrlFilters.filter((f) => f.name && f.url);
        if (namedFilters.length) {
          const urlLines = ['# API URL aliases used during capture', '# Usage: replace ${name} in feature steps with actual base URL'];
          for (const f of namedFilters) urlLines.push(`${f.name}: ${f.url}`);
          fs.writeFileSync(urlConfigPath, urlLines.join('\n') + '\n', 'utf8');
        }

        return { ok: true, path: path.relative(ROOT, outPath).replace(/\\/g, '/') };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  await page.exposeFunction(
    'pwRecorderGenerate',
    async (args?: { featureText?: string; useEdited?: boolean; fileName?: string; featurePathOverride?: string; locatorDirOverride?: string }) => {
    const uiEnabled = shouldRecordUiActions();
    const apiEnabled = shouldCaptureApi();
    const apiSteps = apiEnabled ? generateApiStepsFromCapturedApis(capturedApis, buildUrlAliases()) : '';

    // Stop network capture during feature generation to keep output stable.
    apiCaptureStop?.();
    apiCaptureStop = undefined;
    recorderIsRecording = false;

    if (uiEnabled) flushPendingInput();

    const hasAnyUi = uiEnabled && actions.length > 0;
    const hasAnyApi = apiEnabled && apiSteps.trim().length > 0;
    const hasEditedContent = !!(args?.useEdited && args?.featureText?.trim());
    if (!hasAnyUi && !hasAnyApi && !hasEditedContent) {
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
    // Use the title captured when recording STARTED (matches the navigate-step URL).
    // Fall back to current title only if the user never pressed Start.
    const startingTitle = initialPageTitle || websiteTitle;
    // UI + API → interleave by timestamp; UI-only → plain conversion.
    const interleaved = uiEnabled && apiEnabled && capturedApis.length > 0;
    const finalActions = pairCustomDropdownActions(actions);
    const artifact = uiEnabled
      ? interleaved
        ? convertToInterleavedArtifacts(finalActions, apiEventsFromCaptured(capturedApis, buildUrlAliases()), {
            scenarioTitle,
            scenarioUrl: lastUrl,
            featureFile: featurePath,
            pageKey,
          })
        : convertToArtifacts(finalActions, {
            scenarioTitle,
            scenarioUrl: lastUrl,
            featureFile: featurePath,
            pageKey,
            pageStepInput: { title: startingTitle },
          })
      : undefined;

    try {
      const shouldUseEdited = !!(args && args.useEdited);
      const overrideText = shouldUseEdited && typeof args?.featureText === 'string' ? args.featureText : '';
      let featureToWrite = overrideText.trim().length ? overrideText : '';

      if (!featureToWrite) {
        if (uiEnabled && artifact) {
          featureToWrite = rewriteWebTableStep(artifact.featureContent);
          // Interleaved already contains the API steps inline; only append when UI-only conversion.
          if (!interleaved && apiSteps.trim().length) featureToWrite = `${featureToWrite}\n${apiSteps}\n`;
        } else if (apiSteps.trim().length) {
          featureToWrite = generateFeatureFromCapturedApis({
            capturedApis,
            featureName: 'Auto Generated Test',
            scenarioName: scenarioTitle,
            urlAliases: buildUrlAliases(),
          });
        } else {
          featureToWrite = rewriteWebTableStep(artifact?.featureContent || '');
        }
      }
      // Classify by content → write into generated/<category>/feature + /locator
      const genCategory = classifyFeature(featureToWrite);
      ensureCategoryDirs(genCategory);

      // Honor optional user overrides for feature file path + locator folder.
      const resolveRoot = (p: string) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
      const featPathOv = String(args?.featurePathOverride || '').trim();
      const locDirOv = String(args?.locatorDirOverride || '').trim();
      const outFeaturePath = featPathOv
        ? resolveRoot(featPathOv.endsWith('.feature') ? featPathOv : `${featPathOv}/${pageKey}.feature`)
        : featureFilePath(genCategory, pageKey);
      const locatorBaseDir = locDirOv ? resolveRoot(locDirOv) : path.dirname(locatorFilePath(genCategory, pageKey));
      const outLocatorPath = path.join(locatorBaseDir, `${pageKey}.yaml`);

      ensureDir(path.dirname(outFeaturePath));
      ensureDir(locatorBaseDir);
      fs.writeFileSync(outFeaturePath, featureToWrite, 'utf8');

      if (uiEnabled && artifact?.pages && artifact.pages.length) {
        ensureDir(path.dirname(pagesYamlPath));
        // Write a locator YAML for EVERY page (each redirected screen), and
        // register each in pages.yaml — mirrors DOM Mode's multi-page output.
        // Move locators that appear on 2+ pages into common.yaml, and remove
        // them from the per-page YAMLs (so common locators match across pages).
        const commonMap = new Map<string, [string, string]>();
        const commonNames = new Set<string>();
        const nameCount = new Map<string, Set<string>>();
        for (const pg of artifact.pages) {
          for (const name of pg.locatorMap.keys()) {
            const s = nameCount.get(name) || new Set<string>();
            s.add(pg.pageKey);
            nameCount.set(name, s);
          }
        }
        for (const [name, pagesWith] of nameCount.entries()) {
          if (pagesWith.size >= 2) {
            for (const pg of artifact.pages) {
              const t = pg.locatorMap.get(name);
              if (t) { commonMap.set(name, t); break; }
            }
            commonNames.add(name);
          }
        }

        for (const pg of artifact.pages) {
          // Drop shared locators from the page map (they live in common.yaml now).
          for (const name of commonNames) pg.locatorMap.delete(name);
          const pgLocatorPath = path.join(locatorBaseDir, `${pg.pageKey}.yaml`);
          ensureDir(path.dirname(pgLocatorPath));
          writePageLocatorsYaml(pgLocatorPath, pg.locatorMap);
          registerPage(pagesYamlPath, pg.pageKey, pg.title, pg.label);
        }
        // Merge into common.yaml (preserve any existing entries).
        if (commonMap.size) {
          const commonPath = path.join(locatorBaseDir, 'common.yaml');
          const existingCommon = loadYamlRecord(commonPath);
          for (const [name, tuple] of commonMap.entries()) existingCommon[name] = tuple;
          fs.writeFileSync(commonPath, require('js-yaml').dump(existingCommon, { noRefs: true, lineWidth: 160 }), 'utf8');
        }
      } else if (uiEnabled && artifact?.pageKey && artifact.pageMeta) {
        // Fallback: single page (no segments produced)
        ensureDir(path.dirname(pagesYamlPath));
        registerPage(pagesYamlPath, artifact.pageKey, artifact.pageMeta.title, artifact.pageMeta.label);
        writePageLocatorsYaml(outLocatorPath, artifact.locatorMap);
      }

      // Write API URL alias config alongside locators when named filters are active
      const namedFilters = apiUrlFilters.filter((f) => f.name && f.url);
      let apiConfigRel = '';
      if (apiEnabled && namedFilters.length) {
        const apiConfigDir = path.join(ROOT, 'locators', 'generated');
        ensureDir(apiConfigDir);
        const apiConfigPath = path.join(apiConfigDir, `${pageKey}-api-config.yaml`);
        const configLines = [
          '# API URL aliases used during capture',
          '# Replace ${name} references in the feature file with the actual base URL',
        ];
        for (const f of namedFilters) configLines.push(`${f.name}: ${f.url}`);
        fs.writeFileSync(apiConfigPath, configLines.join('\n') + '\n', 'utf8');
        apiConfigRel = path.relative(ROOT, apiConfigPath).replace(/\\/g, '/');
      }

      const sessionDir = path.join(ROOT, 'feature', 'generated');
      ensureDir(sessionDir);
      const sessionPath = path.join(sessionDir, 'recorded-session.json');
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
      const apiConfigLine = apiConfigRel ? `\\nAPI config: ${apiConfigRel}` : '';
      const message =
        `✅ Files generated successfully!\\nFeature: ${featureRel}\\nPages: ${pagesRel}\\nPage locators: ${pageLocRel}${apiConfigLine}`;

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
        apiCaptureStop = attachApiCapture(page, capturedApis, { onCaptured: () => scheduleUiSync(true), urlFilters: filterUrls() }).stop;
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

  await page.exposeFunction('pwRecorderSetApiUrlFilters', (values: { name: string; url: string }[]) => {
    apiUrlFilters = Array.isArray(values)
      ? values.map((v) => ({ name: String(v?.name ?? '').trim(), url: String(v?.url ?? '').trim() })).filter((f) => f.url)
      : [];
    if (recorderIsRecording && shouldCaptureApi()) {
      apiCaptureStop?.();
      apiCaptureStop = attachApiCapture(page, capturedApis, { onCaptured: () => scheduleUiSync(true), urlFilters: filterUrls() }).stop;
    }
    return { ok: true };
  });

  await page.exposeFunction('pwRecorderSetRecording', async (value: boolean, reset?: boolean) => {
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
      initialPageTitle = '';

      scheduleUiSync(false);
    }

    if (value === true) {
      // Capture the starting page title so pages.yaml reflects the navigate-step URL, not the ending URL.
      if (!initialPageTitle) initialPageTitle = await page.title().catch(() => '');

      // Start capture based on user selection.
      if (shouldCaptureApi()) {
        apiCaptureStop?.();
        apiCaptureStop = attachApiCapture(page, capturedApis, { onCaptured: () => scheduleUiSync(true), urlFilters: filterUrls() }).stop;
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

  // Lets a freshly-loaded page (after navigation) restore the recording state,
  // so recording continues across clicks/navigations instead of resetting.
  await page.exposeFunction('pwRecorderGetRecordingState', () => {
    return { recording: recorderIsRecording };
  });

  // Lets a freshly-loaded page (after navigation) re-pull the accumulated feature
  // preview, so previously captured steps from earlier pages stay visible.
  await page.exposeFunction('pwRecorderRequestSync', () => {
    scheduleUiSync(true);
    return { ok: true };
  });

  await page.exposeFunction(
    'pwRecorderAiGenerateSave',
    async (args?: {
      fileName?: string;
      featureContent?: string;
      pageYamls?: Record<string, string>;
      // Legacy single-yaml support
      locatorsYaml?: string;
      overwrite?: boolean;
    }): Promise<{ savedPaths: string[]; featurePath: string; needsConfirm?: boolean; existingPaths?: string[] }> => {
      const fileName = String(args?.fileName || 'generated-flow').replace(/[^a-zA-Z0-9_-]/g, '-');
      const featureContent = String(args?.featureContent || '').trim();
      if (!featureContent) throw new Error('Feature content is empty');

      const savedPaths: string[] = [];
      const locatorRoot = path.join(ROOT, 'locators');
      const pagesYamlPath = resolvePagesYamlPath(locatorRoot);

      // Classify feature by content → generated/<category>/feature + /locator
      const category: FeatureCategory = classifyFeature(featureContent);
      ensureCategoryDirs(category);

      const featurePath = featureFilePath(category, fileName);

      // Collect pageYamls: prefer new multi-page format, fall back to legacy single yaml
      const yamls: Record<string, string> = {};
      if (args?.pageYamls && typeof args.pageYamls === 'object') {
        Object.assign(yamls, args.pageYamls);
      } else if (args?.locatorsYaml) {
        const pkMatch = featureContent.match(/User is on "([^"]+)" screen/);
        const pk = pkMatch ? pkMatch[1].replace(/[^a-zA-Z0-9]/g, '') : fileName.replace(/[^a-zA-Z0-9]/g, '');
        yamls[pk] = args.locatorsYaml;
      }

      // ── Single-page: use the TYPED file name as the page key everywhere ─────
      // locator/<fileName>.yaml, pages.yaml key = <fileName>, and the feature's
      // "User is on <X> screen" step is rewritten to match.
      let featureToSave = featureContent;
      let carriedTitle = '';
      const desiredKey = fileName.replace(/[^a-zA-Z0-9]/g, '') || 'page';
      const yamlKeys = Object.keys(yamls).filter((k) => yamls[k] && yamls[k].trim());
      if (yamlKeys.length === 1 && yamlKeys[0] !== desiredKey) {
        const oldKey = yamlKeys[0];
        // Carry over the real title the scan registered under the old key.
        const oldEntry = loadYamlRecord(pagesYamlPath)[oldKey];
        carriedTitle =
          Array.isArray(oldEntry) && oldEntry[0] && typeof oldEntry[0] === 'object'
            ? String((oldEntry[0] as { title?: string }).title || '')
            : '';
        yamls[desiredKey] = yamls[oldKey];
        delete yamls[oldKey];
        featureToSave = featureToSave.replace(/(User is on ")[^"]+(" screen)/g, `$1${desiredKey}$2`);

        // Clean up stale artifacts the scan wrote under the old key.
        try {
          const staleLoc = locatorFilePath(category, oldKey);
          if (fs.existsSync(staleLoc)) fs.unlinkSync(staleLoc);
        } catch { /* ignore */ }
        try {
          const reg = loadYamlRecord(pagesYamlPath);
          if (reg[oldKey]) {
            delete reg[oldKey];
            fs.writeFileSync(pagesYamlPath, require('js-yaml').dump(reg, { noRefs: true, lineWidth: 160 }), 'utf8');
          }
        } catch { /* ignore */ }
      }

      // ── Overwrite guard: if any target file already exists, ask first ──────
      if (!args?.overwrite) {
        const existingPaths: string[] = [];
        if (fs.existsSync(featurePath)) existingPaths.push(path.relative(ROOT, featurePath).replace(/\\/g, '/'));
        for (const pageKey of Object.keys(yamls)) {
          if (!yamls[pageKey] || !yamls[pageKey].trim()) continue;
          const lp = locatorFilePath(category, pageKey);
          if (fs.existsSync(lp)) existingPaths.push(path.relative(ROOT, lp).replace(/\\/g, '/'));
        }
        if (existingPaths.length) {
          return { savedPaths: [], featurePath, needsConfirm: true, existingPaths };
        }
      }

      // Save feature file into generated/<category>/feature/ (use the remapped content)
      fs.writeFileSync(featurePath, featureToSave + '\n', 'utf8');
      savedPaths.push(path.relative(ROOT, featurePath).replace(/\\/g, '/'));

      // Save each page's YAML into generated/<category>/locator/ and register it
      for (const [pageKey, yamlContent] of Object.entries(yamls)) {
        if (!yamlContent || !yamlContent.trim()) continue;
        const pageLocatorPath = locatorFilePath(category, pageKey);
        ensureDir(path.dirname(pageLocatorPath));
        fs.writeFileSync(pageLocatorPath, yamlContent.trim() + '\n', 'utf8');
        savedPaths.push(path.relative(ROOT, pageLocatorPath).replace(/\\/g, '/'));

        // Register in pages.yaml (unchanged location).
        // Preserve the real title captured during the DOM scan (do NOT derive it
        // from a "verify ... text" assertion — that produced wrong titles).
        const existing = loadYamlRecord(pagesYamlPath)[pageKey];
        const existingTitle =
          Array.isArray(existing) && existing[0] && typeof existing[0] === 'object'
            ? String((existing[0] as { title?: string }).title || '')
            : '';
        const pageTitle = existingTitle || carriedTitle || pageKey;
        const labelMatch = yamlContent.match(/^([A-Za-z][^\n:]+):/m);
        const pageLabel = labelMatch ? labelMatch[1].trim() : pageKey;
        registerPage(pagesYamlPath, pageKey, pageTitle, pageLabel);
      }
      if (Object.keys(yamls).length > 0) {
        savedPaths.push(path.relative(ROOT, pagesYamlPath).replace(/\\/g, '/'));
      }

      return { savedPaths, featurePath };
    },
  );

  await page.exposeFunction(
    'pwRecorderRunFeature',
    async (args?: { featurePath?: string }): Promise<{ output: string; exitCode: number }> => {
      const featurePath = String(args?.featurePath || '').trim();
      if (!featurePath) throw new Error('featurePath is required');

      const absPath = path.isAbsolute(featurePath) ? featurePath : path.join(ROOT, featurePath);
      if (!fs.existsSync(absPath)) throw new Error(`Feature file not found: ${absPath}`);

      return new Promise((resolve) => {
        const { spawn } = require('child_process') as typeof import('child_process');
        // Use Node directly — avoids all cmd.exe / shell-quoting issues on
        // Windows paths with spaces (e.g. "OneDrive - Evanke")
        const cucumberEntry = resolveCucumberEntry();
        const nodeArgs = [
          cucumberEntry,
          absPath,
          '--require-module', 'ts-node/register',
          '--require', 'steps-def/**/*.ts',
        ];
        const chunks: string[] = [];
        const child = spawn(process.execPath, nodeArgs, {
          cwd: ROOT,
          env: { ...process.env },
          shell: false,
        });

        child.stdout?.on('data', (d: Buffer) => chunks.push(d.toString()));
        child.stderr?.on('data', (d: Buffer) => chunks.push(d.toString()));

        const timeout = setTimeout(() => {
          child.kill();
          chunks.push('\n[TIMEOUT] Test run exceeded 3 minutes and was stopped.\n');
          resolve({ output: chunks.join(''), exitCode: 1 });
        }, 180_000);

        child.on('close', (code: number | null) => {
          clearTimeout(timeout);
          resolve({ output: chunks.join(''), exitCode: code ?? 1 });
        });

        child.on('error', (err: Error) => {
          clearTimeout(timeout);
          chunks.push(`\n[ERROR] ${err.message}\n`);
          resolve({ output: chunks.join(''), exitCode: 1 });
        });
      });
    },
  );

  // ── Auto-fix loop state (keyed by loopId) ────────────────────────────────
  type LoopState = {
    done: boolean;
    passed: boolean;
    iterations: number;
    log: string;
    statusLine: string;
    finalFeature: string;
    finalYaml: string;
  };
  const loopStates = new Map<string, LoopState>();

  /**
   * Resolve the real cucumber-js JS entry point so we can call it with
   * the current Node binary directly — no .cmd wrapper, no cmd.exe, no
   * shell quoting issues even on Windows paths that contain spaces.
   */
  function resolveCucumberEntry(): string {
    const pkgJson = path.join(ROOT, 'node_modules', '@cucumber', 'cucumber', 'package.json');
    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { bin?: string | Record<string, string> };
      const binVal = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.['cucumber-js'] ?? pkg.bin?.['cucumber'] ?? '');
      if (binVal) return path.resolve(path.join(ROOT, 'node_modules', '@cucumber', 'cucumber'), binVal);
    }
    // Fallback to well-known path
    return path.join(ROOT, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js');
  }

  function spawnCucumber(absFeaturePath: string): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process') as typeof import('child_process');
      // Use the current Node.js binary to run cucumber's JS entry directly.
      // This avoids all cmd.exe / .cmd-wrapper / shell-quoting issues on Windows
      // paths that contain spaces (e.g. OneDrive - Evanke).
      const cucumberEntry = resolveCucumberEntry();
      const nodeArgs = [
        cucumberEntry,
        absFeaturePath,
        '--require-module', 'ts-node/register',
        '--require', 'steps-def/**/*.ts',
      ];
      const child = spawn(process.execPath, nodeArgs, {
        cwd: ROOT,
        env: { ...process.env },
        shell: false,   // Never go through cmd.exe
      });
      const chunks: string[] = [];

      child.stdout?.on('data', (d: Buffer) => chunks.push(d.toString()));
      child.stderr?.on('data', (d: Buffer) => chunks.push(d.toString()));
      const timer = setTimeout(() => {
        child.kill();
        chunks.push('\n[TIMEOUT] Exceeded 3 minutes.\n');
        resolve({ output: chunks.join(''), exitCode: 1 });
      }, 180_000);
      child.on('close', (code: number | null) => { clearTimeout(timer); resolve({ output: chunks.join(''), exitCode: code ?? 1 }); });
      child.on('error', (err: Error) => { clearTimeout(timer); chunks.push(`\n[ERROR] ${err.message}\n`); resolve({ output: chunks.join(''), exitCode: 1 }); });
    });
  }

  await page.exposeFunction(
    'pwRecorderListFeatureFiles',
    (): Array<{ label: string; absPath: string }> => {
      const results: Array<{ label: string; absPath: string }> = [];
      const dirs = [
        path.join(ROOT, 'features'),
        path.join(ROOT, 'generated'),
      ];
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        const folder = path.basename(dir);
        const walk = (d: string) => {
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.feature')) continue;
            const rel = path.relative(ROOT, full).replace(/\\/g, '/');
            results.push({ label: `${folder}/${path.relative(dir, full).replace(/\\/g, '/')}`, absPath: full });
          }
        };
        walk(dir);
      }
      return results.sort((a, b) => a.label.localeCompare(b.label));
    },
  );

  await page.exposeFunction(
    'pwRecorderSaveUploadedFiles',
    async (args?: {
      files?: Array<{ name?: string; content?: string }>;
    }): Promise<{ savedPaths: string[]; featureAbsPath: string }> => {
      const files = Array.isArray(args?.files) ? args!.files : [];
      if (!files.length) throw new Error('No files provided');

      const savedPaths: string[] = [];
      let featureAbsPath = '';

      // Classify by the uploaded feature's content so feature + locators land together.
      const featFile = files.find((f) => String(f?.name || '').endsWith('.feature'));
      const category: FeatureCategory = featFile ? classifyFeature(String(featFile.content || '')) : 'web';
      ensureCategoryDirs(category);

      for (const f of files) {
        const name = String(f?.name || '').trim();
        const content = String(f?.content || '').trim();
        if (!name || !content) continue;

        if (name.endsWith('.feature')) {
          const baseName = name.replace(/\.feature$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
          const dest = featureFilePath(category, baseName);
          fs.writeFileSync(dest, content + '\n', 'utf8');
          featureAbsPath = dest;
          savedPaths.push(path.relative(ROOT, dest).replace(/\\/g, '/'));

          // Auto-register page in pages.yaml if feature references a screen
          const screenMatch = content.match(/User is on "([^"]+)" screen/);
          if (screenMatch) {
            const pageKey = screenMatch[1].replace(/[^a-zA-Z0-9]/g, '');
            const pagesYamlPath = resolvePagesYamlPath(path.join(ROOT, 'locators'));
            const titleMatch = content.match(/verify "([^"]+)" text/);
            registerPage(pagesYamlPath, pageKey, titleMatch ? titleMatch[1] : pageKey, pageKey);
          }

        } else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
          // common.yaml goes to the category common file; otherwise per-page locator.
          const base = name.replace(/\.(yaml|yml)$/, '').replace(/[^a-zA-Z0-9_-]/g, '');
          const dest = base.toLowerCase() === 'common'
            ? commonFilePath(category)
            : locatorFilePath(category, base);
          ensureDir(path.dirname(dest));
          fs.writeFileSync(dest, content + '\n', 'utf8');
          savedPaths.push(path.relative(ROOT, dest).replace(/\\/g, '/'));
        }
      }

      if (!featureAbsPath) throw new Error('No .feature file found in uploaded files');
      return { savedPaths, featureAbsPath };
    },
  );

  await page.exposeFunction(
    'pwRecorderStartFixLoop',
    async (args?: { featurePath?: string; maxIterations?: number; domMode?: boolean }): Promise<{ loopId: string }> => {
      const featurePath = String(args?.featurePath || '').trim();
      const domMode = !!args?.domMode;
      // 0 or negative = unlimited (cap at 100 for safety)
      const rawMax = Number(args?.maxIterations ?? 5);
      const maxIterations = rawMax <= 0 ? 100 : rawMax;
      if (!featurePath) throw new Error('featurePath required');

      const absFeature = path.isAbsolute(featurePath) ? featurePath : path.join(ROOT, featurePath);
      if (!fs.existsSync(absFeature)) throw new Error(`Feature file not found: ${absFeature}`);

      const loopId = `loop-${Date.now()}`;
      const state: LoopState = { done: false, passed: false, iterations: 0, log: '', statusLine: 'Starting...', finalFeature: '', finalYaml: '' };
      loopStates.set(loopId, state);
      const appendLog = (line: string) => { state.log += line + '\n'; };

      // ── Strip markdown fences the LLM adds around code blocks ────────────
      const stripFences = (text: string): string =>
        text.replace(/^```[\w]*\r?\n?/gm, '').replace(/\r?\n?```\s*$/gm, '').trim();

      // ── Derive locator YAML path from current feature ─────────────────────
      const getPageKey = (): string => {
        const ft = fs.readFileSync(absFeature, 'utf8');
        const m = ft.match(/User is on "([^"]+)" screen/);
        return m ? m[1].replace(/[^a-zA-Z0-9]/g, '') : '';
      };
      const getAbsLocator = (pk: string) => {
        if (!pk) return '';
        // Prefer an existing locator (new generated/<cat>/locator or legacy); else
        // default to the category implied by the current feature content.
        const existing = findLocatorFile(pk);
        if (existing) return existing;
        const cat = classifyFeature(fs.readFileSync(absFeature, 'utf8'));
        ensureCategoryDirs(cat);
        return locatorFilePath(cat, pk);
      };

      // ── Capture DOM elements from a Playwright Page ───────────────────────
      const capturePageDOM = async (tab: import('playwright').Page): Promise<string> => {
        return tab.evaluate(() => {
          const rows: string[] = [];
          const getLabel = (el: Element) => {
            if (el.id) {
              const l = document.querySelector(`label[for="${el.id}"]`);
              if (l) return l.textContent?.trim() || '';
            }
            const p = el.closest('label,[class*="form"],[class*="field"],[class*="group"]');
            if (p) { const l = p.querySelector('label,span,p'); if (l && l !== el) return l.textContent?.trim().slice(0, 60) || ''; }
            return '';
          };
          document.querySelectorAll('input,textarea,select').forEach((el) => {
            const e = el as HTMLInputElement;
            const parts = [`<${e.tagName.toLowerCase()}`];
            if (e.id) parts.push(`id="${e.id}"`);
            if (e.name) parts.push(`name="${e.name}"`);
            if (e.type && e.type !== 'text') parts.push(`type="${e.type}"`);
            if (e.placeholder) parts.push(`placeholder="${e.placeholder}"`);
            const cls = e.className?.toString().trim();
            if (cls) parts.push(`class="${cls.slice(0, 60)}"`);
            const lbl = getLabel(e); if (lbl) parts.push(`[label:"${lbl}"]`);
            rows.push(parts.join(' ') + '>');
          });
          document.querySelectorAll('button,input[type="button"],input[type="submit"],[role="button"]').forEach((el) => {
            const text = (el.textContent || (el as HTMLInputElement).value || '').trim().slice(0, 80);
            const id = (el as HTMLElement).id; const cls = ((el as HTMLElement).className || '').toString().trim().slice(0, 50);
            const type = (el as HTMLInputElement).type || '';
            const parts = [`<${el.tagName.toLowerCase()}`];
            if (id) parts.push(`id="${id}"`); if (type) parts.push(`type="${type}"`); if (cls) parts.push(`class="${cls}"`);
            rows.push(parts.join(' ') + `>${text}</${el.tagName.toLowerCase()}>`);
          });
          document.querySelectorAll('a[href]').forEach((el) => {
            const text = el.textContent?.trim().slice(0, 60) || '';
            if (text) rows.push(`<a href="${(el as HTMLAnchorElement).href.slice(0, 80)}">${text}</a>`);
          });
          document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').forEach((el) => {
            const text = el.textContent?.trim().slice(0, 100) || '';
            if (text) rows.push(`<${el.tagName.toLowerCase()}>${text}</${el.tagName.toLowerCase()}>`);
          });
          document.querySelectorAll('table').forEach((tbl) => {
            const headers = Array.from(tbl.querySelectorAll('th,thead td')).map(th => th.textContent?.trim()).filter(Boolean);
            if (headers.length) rows.push(`<table headers=[${headers.join(', ')}]>`);
          });
          // Visible text on page (for text assertions)
          const bodyText = document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 1000);
          rows.push(`\n[VISIBLE PAGE TEXT]: ${bodyText}`);
          return rows.join('\n');
        }).catch(() => '(DOM capture failed)');
      };

      // ── Replay feature steps in a tab to reach the failure point ─────────
      const replayStepsInTab = async (tab: import('playwright').Page, featureText: string): Promise<void> => {
        const steps = featureText.split('\n').map(l => l.trim()).filter(l => /^(Given|When|Then|And|But)\s/i.test(l));
        for (const step of steps) {
          // Navigate
          const nav = step.match(/navigates to "([^"]+)"/i);
          if (nav) { await tab.goto(nav[1], { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {}); await tab.waitForTimeout(1500); continue; }
          // Skip page-registration steps
          if (/User is on "[^"]+" screen/i.test(step)) continue;
          // Fill input: enters "value" text in "Field" textbox
          const fill = step.match(/enters "([^"]+)" text in "([^"]+)"/i);
          if (fill) {
            const [, val, field] = fill;
            const selectors = [`[id="${field}"]`, `[name="${field}"]`, `[placeholder="${field}"]`, `[placeholder*="${field}" i]`, `input[type="email"]`, `input[type="password"]`, `textarea`];
            for (const sel of selectors) {
              try { const l = tab.locator(sel).first(); if (await l.count() > 0) { await l.fill(val); break; } } catch {}
            }
            continue;
          }
          // Click button/link
          const click = step.match(/clicks?\s+on "([^"]+)"/i);
          if (click) {
            const name = click[1];
            const sels = [`button:has-text("${name}")`, `[value="${name}"]`, `[aria-label="${name}"]`, `a:has-text("${name}")`, `input[type="submit"]`];
            for (const sel of sels) {
              try { const l = tab.locator(sel).first(); if (await l.count() > 0) { await l.click(); await tab.waitForTimeout(3000); break; } } catch {}
            }
            continue;
          }
          // Stop BEFORE verify/assert steps — we want HTML at this point
          if (/verify\s+".+"\s+text/i.test(step) || /verify\s+data\s+from/i.test(step)) break;
        }
      };

      // ── Open ONE persistent tab for the whole loop ────────────────────────
      const liveTab = await context.newPage();

      // Run async so the browser gets loopId immediately
      (async () => {
        const iterLabel = maxIterations >= 100 ? '∞' : String(maxIterations);
        for (let i = 1; i <= maxIterations; i++) {
          state.iterations = i;
          state.statusLine = `Iteration ${i}/${iterLabel} — running cucumber-js...`;
          appendLog(`\n${'─'.repeat(50)}`);
          appendLog(`▶ Iteration ${i}/${iterLabel}`);
          appendLog('─'.repeat(50));

          const { output, exitCode } = await spawnCucumber(absFeature);
          appendLog(output);

          const pageKey = getPageKey();
          const absLocator = getAbsLocator(pageKey);

          if (exitCode === 0) {
            state.passed = true;
            state.statusLine = `✅ Passed on iteration ${i}!`;
            state.finalFeature = fs.readFileSync(absFeature, 'utf8');
            state.finalYaml = absLocator && fs.existsSync(absLocator) ? fs.readFileSync(absLocator, 'utf8') : '';
            break;
          }

          if (i >= maxIterations) {
            state.statusLine = `❌ Still failing after ${i} attempt(s).`;
            state.finalFeature = fs.readFileSync(absFeature, 'utf8');
            state.finalYaml = absLocator && fs.existsSync(absLocator) ? fs.readFileSync(absLocator, 'utf8') : '';
            break;
          }

          // ── Replay steps in persistent tab to reach the failure point ─────────
          state.statusLine = `Iteration ${i} failed — replaying steps to capture live HTML...`;

          const latestFeatureText = fs.readFileSync(absFeature, 'utf8');
          const urlMatch = latestFeatureText.match(/User navigates to "([^"]+)"\s+URL/i);
          const targetUrl = urlMatch ? urlMatch[1].trim() : '';

          let pageHtmlSnapshot = '(could not capture page HTML)';
          let pageTitle = '';

          if (targetUrl) {
            appendLog(`\n🌐 Replaying steps in live tab to reach failure point...`);
            try {
              // Replay all steps up to the first verify — persistent tab stays open
              await replayStepsInTab(liveTab, latestFeatureText);
              pageTitle = await liveTab.title().catch(() => '');
              pageHtmlSnapshot = await capturePageDOM(liveTab);
              appendLog(`   ✔ Live page captured after replay: "${pageTitle}" — ${pageHtmlSnapshot.split('\n').length} elements`);
            } catch (err) {
              appendLog(`   ⚠ Step replay failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            appendLog('\n⚠ No URL found in feature file — skipping page capture');
          }

          // ── DOM Mode: find failing elements by scanning the live page ─────────
          if (domMode) {
            state.statusLine = `Iteration ${i} failed — DOM scanning for correct locators...`;
            appendLog(`\n🔍 DOM Mode: searching live page for failing elements...`);

            // Parse ALL "Element X not found" errors from the output
            const failRegex = /Element "([^"]+)" not found in page "([^"]+)"/g;
            let fm: RegExpExecArray | null;
            const failures: Array<{ element: string; pageKey: string }> = [];
            while ((fm = failRegex.exec(output)) !== null) {
              failures.push({ element: fm[1], pageKey: fm[2] });
            }

            if (!failures.length) {
              appendLog('   ⚠ Could not parse failing element from error — no DOM fix possible.');
              state.statusLine = `❌ Could not auto-fix (unknown error type). Check test output.`;
              break;
            }

            // Group by pageKey so we open each page once
            const byPage = new Map<string, string[]>();
            for (const { element, pageKey } of failures) {
              if (!byPage.has(pageKey)) byPage.set(pageKey, []);
              byPage.get(pageKey)!.push(element);
            }

            for (const [failPageKey, elements] of byPage.entries()) {
              const locatorFile = getAbsLocator(failPageKey);
              const existingYaml = fs.existsSync(locatorFile)
                ? (require('js-yaml').load(fs.readFileSync(locatorFile, 'utf8')) as Record<string, unknown>) || {}
                : {};

              appendLog(`   📄 Page: ${failPageKey} — fixing ${elements.length} element(s): [${elements.join(', ')}]`);

              for (const elementName of elements) {
                // Search the live tab DOM for the best matching element
                const found = await liveTab.evaluate((name: string) => {
                  const allEls = Array.from(document.querySelectorAll(
                    'input,textarea,select,button,a,[role="button"],[role="link"],label,h1,h2,h3,h4,h5,h6'
                  ));
                  const n = name.toLowerCase().trim();

                  const score = (el: Element) => {
                    const e = el as HTMLInputElement;
                    const id = (e.id || '').toLowerCase();
                    const ph = (e.placeholder || '').toLowerCase();
                    const txt = (e.textContent || e.value || '').trim().toLowerCase().replace(/\s+/g, ' ');
                    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    const nm = (e.name || '').toLowerCase();
                    let lblTxt = '';
                    if (e.id) { const l = document.querySelector(`label[for="${e.id}"]`); if (l) lblTxt = (l.textContent || '').trim().toLowerCase(); }

                    const fields = [id, ph, lblTxt, aria, txt, nm];
                    // Exact match on any non-empty field.
                    if (fields.some((v) => v && v === n)) return 100;
                    // Substring — never compare against empty values (that matched everything).
                    let s = 0;
                    for (const v of fields) {
                      if (!v || v.length < 3) continue;
                      if (v.includes(n) && n.length >= 3) s = Math.max(s, 55);
                      else if (n.includes(v)) s = Math.max(s, 45);
                    }
                    return s;
                  };

                  const scored = allEls.map(el => ({ el, s: score(el) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
                  if (!scored.length) return null;
                  const best = scored[0].el as HTMLInputElement;
                  const tag = best.tagName.toLowerCase();

                  // Generate best unique XPath for the found element
                  const candidates: Array<{ expr: string; p: number }> = [];
                  if (best.id) candidates.push({ expr: `//*[@id='${best.id}']`, p: 100 });
                  if (best.placeholder) candidates.push({ expr: `//input[@placeholder='${best.placeholder}']`, p: 90 });
                  const t = (best.textContent || best.value || '').trim().replace(/\s+/g, ' ');
                  if (t && (tag === 'button' || tag === 'a')) candidates.push({ expr: `//${tag}[normalize-space()='${t}']`, p: 88 });
                  if (best.id) {
                    const l = document.querySelector(`label[for="${best.id}"]`);
                    if (l) {
                      const lt = (l.textContent || '').trim();
                      candidates.push({ expr: `//label[normalize-space()='${lt}']/following-sibling::input`, p: 82 });
                      candidates.push({ expr: `//label[normalize-space()='${lt}']/..//input`, p: 81 });
                    }
                  }
                  if (best.name) candidates.push({ expr: `//*[@name='${best.name}']`, p: 75 });
                  if (best.type && ['email','password','tel','number','search'].includes(best.type)) {
                    candidates.push({ expr: `//input[@type='${best.type}']`, p: 55 });
                  }

                  for (const c of candidates.sort((a, b) => b.p - a.p)) {
                    try {
                      const res = document.evaluate(c.expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                      if (res.snapshotLength === 1) return { strategy: 'xpath', expression: c.expr, score: scored[0].s };
                    } catch {}
                  }
                  if (best.id) return { strategy: 'css', expression: `#${best.id}`, score: scored[0].s };
                  return null;
                }, elementName).catch(() => null);

                if (found) {
                  existingYaml[elementName] = [found.strategy, found.expression];
                  appendLog(`   ✔ "${elementName}" → ${found.strategy}: ${found.expression} (score: ${found.score})`);
                } else {
                  appendLog(`   ✗ "${elementName}" — not found in DOM. Try a different element name in the feature file.`);
                }
              }

              // Write updated YAML
              ensureDir(path.dirname(locatorFile));
              fs.writeFileSync(locatorFile, require('js-yaml').dump(existingYaml, { noRefs: true, lineWidth: 160 }), 'utf8');
              appendLog(`   💾 Updated ${path.relative(ROOT, locatorFile).replace(/\\/g, '/')}`);
            }

          }
        }
        state.done = true;
        await liveTab.close().catch(() => {});
      })().catch((err) => {
        state.log += `\n[FATAL] ${err instanceof Error ? err.message : String(err)}\n`;
        state.statusLine = 'Fatal error in fix loop.';
        state.done = true;
        liveTab.close().catch(() => {});
      });

      return { loopId };
    },
  );

  await page.exposeFunction(
    'pwRecorderGetLoopStatus',
    (args?: { loopId?: string }): LoopState & { found: boolean } => {
      const id = String(args?.loopId || '');
      const state = loopStates.get(id);
      if (!state) return { found: false, done: true, passed: false, iterations: 0, log: 'Loop not found', statusLine: 'Error', finalFeature: '', finalYaml: '' };
      return { found: true, ...state };
    },
  );

  // ── DOM Scan: parse plain English, navigate browser, find only requested elements (Zero LLM) ──
  await page.exposeFunction(
    'pwRecorderDomScan',
    async (args?: {
      description?: string;
      fileName?: string;
    }): Promise<{ featureContent: string; pageYamls: Record<string, string>; status: string }> => {
      const description = String(args?.description || '').trim();
      const fileName = String(args?.fileName || 'dom-generated').replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!description) throw new Error('Description is required');

      // ── Step 1: Parse plain English into structured actions ──────────────
      type ParsedAction =
        | { type: 'navigate'; url: string }
        | { type: 'page'; pageKey: string }
        | { type: 'click'; target: string }
        | { type: 'fill'; target: string; value: string }
        | { type: 'verify'; text: string }
        | { type: 'select'; target: string }
        | { type: 'checkbox'; target: string }
        | { type: 'radio'; target: string }
        | { type: 'dropdown'; target: string; value: string }
        | { type: 'table'; target: string };

      const parseDesc = (text: string): ParsedAction[] => {
        const acts: ParsedAction[] = [];
        const segs = text
          .replace(/\r?\n/g, '. ')
          .split(/(?<=[.!?])\s+|\band\b|\bthen\b|\bafter\s+that\b|\bnext\b/i)
          .map(s => s.trim()).filter(s => s.length > 2);

        for (const seg of segs) {
          // [pageKey] marker
          const pageM = seg.match(/\[([a-zA-Z][a-zA-Z0-9]*)\]/);
          if (pageM) acts.push({ type: 'page', pageKey: pageM[1] });

          // Navigate
          const navM = seg.match(/(?:go\s+to|navigate\s+to|open|visit|load)\s+(?:the\s+)?(?:url\s+)?["']?(https?:\/\/[^\s"',]+)["']?/i);
          if (navM) { acts.push({ type: 'navigate', url: navM[1].replace(/[.,;]$/, '') }); continue; }

          // ── Specific components FIRST (before generic click/select) ──────

          // Dropdown: select "value" from "Field" dropdown / drop-down / list
          const ddQ = seg.match(/(?:select|choose|pick)\s+["']([^"']+)["']\s+(?:from|in)\s+(?:the\s+)?["']([^"']+)["']\s*(?:dropdown|drop-?down|select|list)?/i);
          if (ddQ) { acts.push({ type: 'dropdown', value: ddQ[1].trim(), target: ddQ[2].trim() }); continue; }

          // Checkbox: check/tick/select "X" checkbox
          const cbQ = seg.match(/(?:check|tick|toggle|select|enable)\s+(?:the\s+)?["']([^"']+)["']\s+checkbox/i)
            || seg.match(/(?:check|tick)\s+(?:the\s+)?["']([^"']+)["']/i);
          if (cbQ) { acts.push({ type: 'checkbox', target: cbQ[1].trim() }); continue; }

          // Radio: select/choose/click "X" radio (button)
          const rbQ = seg.match(/(?:select|choose|click|pick)\s+(?:on\s+)?(?:the\s+)?["']([^"']+)["']\s+radio(?:\s+button)?/i);
          if (rbQ) { acts.push({ type: 'radio', target: rbQ[1].trim() }); continue; }

          // Web table: verify (data from) table "X"
          const tblQ = seg.match(/(?:verify|check|validate)\s+(?:data\s+(?:from|in)\s+)?(?:the\s+)?["']([^"']+)["']\s+(?:web\s+)?table/i)
            || seg.match(/(?:verify|check|validate)\s+(?:the\s+)?(?:web\s+)?table\s+["']([^"']+)["']/i);
          if (tblQ) { acts.push({ type: 'table', target: tblQ[1].trim() }); continue; }

          // ── Generic interactions ─────────────────────────────────────────

          // Click "X"
          const clickQ = seg.match(/click(?:\s+on)?(?:\s+the)?\s+["']([^"']+)["']/i);
          if (clickQ) { acts.push({ type: 'click', target: clickQ[1].trim() }); continue; }
          const clickU = seg.match(/click(?:\s+on)?(?:\s+the)?\s+([\w][\w\s]*?)\s+(?:button|link|option|tab|icon|menu)/i);
          if (clickU) { acts.push({ type: 'click', target: clickU[1].trim() }); continue; }

          // Fill: enter "value" in "field"
          const fillQ = seg.match(/(?:enter|type|input|fill|put)\s+["']([^"']+)["']\s+(?:in(?:to)?|for)\s+(?:the\s+)?["']([^"']+)["']/i);
          if (fillQ) { acts.push({ type: 'fill', value: fillQ[1].trim(), target: fillQ[2].trim() }); continue; }
          const fillU = seg.match(/(?:enter|type|input|fill)\s+["']([^"']+)["']\s+(?:in(?:to)?\s+)?(?:the\s+)?([a-zA-Z][\w\s]*?)\s+(?:field|input|textbox|box)/i);
          if (fillU) { acts.push({ type: 'fill', value: fillU[1].trim(), target: fillU[2].trim() }); continue; }

          // Generic select "X" (fallback → treated as a click on an option)
          const selQ = seg.match(/(?:select|choose)\s+["']([^"']+)["']/i);
          if (selQ) { acts.push({ type: 'select', target: selQ[1].trim() }); continue; }

          // Verify "X"
          const verQ = seg.match(/(?:verify|check|assert|confirm|see|ensure|validate)(?:\s+that)?(?:\s+the)?(?:\s+text)?\s+["']([^"']+)["']/i);
          if (verQ) { acts.push({ type: 'verify', text: verQ[1].trim() }); continue; }
          const verU = seg.match(/(?:verify|check|assert)\s+(?:that\s+)?["']([^"']+)["']\s+(?:is\s+)?(?:present|visible|shown|displayed)/i);
          if (verU) { acts.push({ type: 'verify', text: verU[1].trim() }); continue; }
        }
        return acts;
      };

      const actions = parseDesc(description);
      const firstNav = actions.find(a => a.type === 'navigate') as { type: 'navigate'; url: string } | undefined;
      if (!firstNav) throw new Error('Description must include a URL. Example: go to https://example.com');

      // ── Step 2: Open tab, execute actions, find DOM locators ─────────────
      const domTab = await context.newPage();
      await domTab.bringToFront().catch(() => {}); // make actions visible to the user
      const featureLines: string[] = [`Feature: ${fileName}`, `  Scenario: ${fileName.replace(/-/g, ' ')}`];
      const pageYamls: Record<string, string> = {};
      let currentPageKey = 'mainPage';
      let pageHeaderAdded = false;
      const locatorRoot = path.join(ROOT, 'locators');
      const pagesYamlPath = resolvePagesYamlPath(locatorRoot);
      const pageLocators: Record<string, Record<string, [string, string]>> = {};
      const pageTitles: Record<string, string> = {}; // real document.title per page
      const ensurePage = (pk: string) => { if (!pageLocators[pk]) pageLocators[pk] = {}; };

      // Find the best XPath for an element name in the live DOM (single attempt)
      const findLocatorOnce = async (name: string): Promise<[string, string] | null> => {
        return domTab.evaluate((n: string) => {
          const lower = n.toLowerCase().trim();
          // Only ACTIONABLE elements (no bare <label> — labels aren't clickable and
          // produce no usable locator, which silently skipped actions).
          const all = Array.from(document.querySelectorAll(
            'a,button,input,select,textarea,option,[role="button"],[role="link"],[role="option"],[role="combobox"],[role="listbox"],[role="checkbox"],[role="radio"],[role="switch"]'
          )).filter(el => !el.closest('#pw-recorder-ui-root') && !el.closest('[id^="__pw_"]'));

          const score = (el: Element): number => {
            const e = el as HTMLInputElement;
            const txt  = (e.textContent || e.value || '').trim().replace(/\s+/g, ' ').toLowerCase();
            const ph   = (e.placeholder || '').toLowerCase();
            const id   = (e.id || '').toLowerCase();
            const nm   = (e.name || '').toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            let lbl = '';
            if (e.id) { const l = document.querySelector(`label[for="${e.id}"]`); if (l) lbl = (l.textContent || '').trim().toLowerCase(); }
            // Also a wrapping <label> (fields without a "for" attribute).
            if (!lbl) { const wrap = el.closest('label'); if (wrap) lbl = (wrap.textContent || '').trim().toLowerCase(); }

            // Candidate attribute values to compare against the wanted name.
            const fields = [txt, id, ph, lbl, aria, nm];

            // Exact match on ANY non-empty field → best.
            if (fields.some((v) => v && v === lower)) return 100;

            // Substring match — ONLY on non-empty fields of reasonable length.
            // (Never compare against "" — that wrongly matched every empty input,
            //  e.g. "status" picking the email field.)
            let best = 0;
            for (const v of fields) {
              if (!v || v.length < 3) continue;
              if (v.includes(lower) && lower.length >= 3) best = Math.max(best, 60);
              else if (lower.includes(v)) best = Math.max(best, 55);
            }
            return best;
          };

          const best = all.map(el => ({ el, s: score(el) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0];
          if (!best) return null;
          const el = best.el as HTMLInputElement;
          const tag = el.tagName.toLowerCase();
          const txt = (el.textContent || el.value || '').trim().replace(/\s+/g, ' ');

          const candidates: Array<{ expr: string; p: number }> = [];
          if (el.id) candidates.push({ expr: `//*[@id='${el.id}']`, p: 100 });
          if (el.placeholder) candidates.push({ expr: `//input[@placeholder='${el.placeholder}']`, p: 90 });
          if (txt && ['button', 'a', 'option'].includes(tag)) candidates.push({ expr: `//${tag}[normalize-space()='${txt}']`, p: 88 });
          if (el.id) {
            const l = document.querySelector(`label[for="${el.id}"]`);
            if (l) {
              const lt = (l.textContent || '').trim();
              candidates.push({ expr: `//label[normalize-space()='${lt}']/following-sibling::input`, p: 82 });
            }
          }
          if (el.name) candidates.push({ expr: `//*[@name='${el.name}']`, p: 75 });
          if (el.type && ['email','password','tel','number'].includes(el.type)) candidates.push({ expr: `//input[@type='${el.type}']`, p: 55 });

          for (const c of candidates.sort((a, b) => b.p - a.p)) {
            try {
              const res = document.evaluate(c.expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              if (res.snapshotLength === 1) return ['xpath', c.expr] as [string, string];
            } catch {}
          }
          if (el.id) return ['css', `#${el.id}`] as [string, string];
          return candidates[0] ? ['xpath', candidates[0].expr] as [string, string] : null;
        }, name).catch(() => null);
      };

      // Retry wrapper: elements often render AFTER a navigation/login, so poll a few
      // times before giving up. This is why "status" was missing — it hadn't rendered yet.
      const findLocator = async (name: string): Promise<[string, string] | null> => {
        for (let attempt = 0; attempt < 6; attempt++) {
          const loc = await findLocatorOnce(name);
          if (loc) return loc;
          await domTab.waitForTimeout(800);
        }
        return null;
      };

      // Generate a clean page key from a page title (fallback to page2, page3...).
      let autoPageCount = 1;
      const usedKeys = new Set<string>();
      const makePageKey = (title: string): string => {
        let key = String(title || '')
          .replace(/[^a-zA-Z0-9 ]/g, ' ')
          .trim()
          .split(/\s+/)
          .slice(0, 4)
          .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
          .join('')
          .slice(0, 30);
        if (!key || usedKeys.has(key)) key = `page${++autoPageCount}`;
        usedKeys.add(key);
        return key;
      };
      usedKeys.add(currentPageKey);

      try {
        for (let ai = 0; ai < actions.length; ai++) {
          const action = actions[ai];
          if (action.type === 'navigate') {
            await domTab.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
            await domTab.waitForTimeout(1500);
            featureLines.push(`    Given User navigates to "${action.url}" URL`);
            if (!pageHeaderAdded) {
              featureLines.push(`    And User is on "${currentPageKey}" screen`);
              pageHeaderAdded = true;
              ensurePage(currentPageKey);
            }
            // Capture the real page title for pages.yaml
            pageTitles[currentPageKey] = (await domTab.title().catch(() => '')) || pageTitles[currentPageKey] || '';
          } else if (action.type === 'page') {
            currentPageKey = action.pageKey;
            pageHeaderAdded = false;
            ensurePage(currentPageKey);
            pageTitles[currentPageKey] = (await domTab.title().catch(() => '')) || pageTitles[currentPageKey] || '';
          } else if (action.type === 'click') {
            const urlBeforeClick = domTab.url();
            const loc = await findLocator(action.target);
            ensurePage(currentPageKey);
            if (loc) {
              pageLocators[currentPageKey][action.target] = loc;
              // Actually perform the click so the user sees it (and the page advances)
              try {
                const sel = loc[0] === 'xpath' ? `xpath=${loc[1]}` : loc[1];
                await domTab.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
                await domTab.locator(sel).first().click({ timeout: 8000 });
              } catch (e) { /* click failed */
              }
              featureLines.push(`    When User clicks on "${action.target}" button`);
            } else {
              featureLines.push(`    # ⚠ Could not find "${action.target}" in DOM — check element name`);
              featureLines.push(`    When User clicks on "${action.target}" button`);
            }
            // A click may navigate. Wait for the page to settle before deciding.
            await domTab.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
            await domTab.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            await domTab.waitForTimeout(1500);
            if (!pageTitles[currentPageKey]) {
              pageTitles[currentPageKey] = (await domTab.title().catch(() => '')) || '';
            }

            // ── Auto-segment: if the click changed the page (navigation), start a
            //    new page so each redirected page gets its own "User is on" step
            //    and its own locator YAML — unless the user already put a [pageKey]
            //    marker as the next action.
            const urlAfterClick = domTab.url();
            const navigated = urlAfterClick.split('#')[0] !== urlBeforeClick.split('#')[0];
            const nextIsExplicitPage = actions[ai + 1] && actions[ai + 1].type === 'page';
            if (navigated && !nextIsExplicitPage) {
              const newTitle = (await domTab.title().catch(() => '')) || '';
              const newKey = makePageKey(newTitle);
              currentPageKey = newKey;
              pageHeaderAdded = true;
              ensurePage(currentPageKey);
              pageTitles[currentPageKey] = newTitle;
              featureLines.push(`    And User is on "${currentPageKey}" screen`);
            }
          } else if (action.type === 'select') {
            const loc = await findLocator(action.target);
            ensurePage(currentPageKey);
            if (loc) {
              pageLocators[currentPageKey][action.target] = loc;
              try {
                const sel = loc[0] === 'xpath' ? `xpath=${loc[1]}` : loc[1];
                await domTab.locator(sel).first().click({ timeout: 8000 });
              } catch {}
            }
            featureLines.push(`    When User clicks on "${action.target}" button`);
            await domTab.waitForTimeout(800);
          } else if (action.type === 'fill') {
            const loc = await findLocator(action.target);
            ensurePage(currentPageKey);
            if (loc) {
              pageLocators[currentPageKey][action.target] = loc;
              // Actually type the value so the user sees it being entered
              try {
                const sel = loc[0] === 'xpath' ? `xpath=${loc[1]}` : loc[1];
                await domTab.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
                await domTab.locator(sel).first().fill(action.value, { timeout: 8000 });
              } catch (e) { /* fill failed */ }
            }
            featureLines.push(`    Given enters "${action.value}" text in "${action.target}" textbox`);
            await domTab.waitForTimeout(500);
          } else if (action.type === 'checkbox') {
            const loc = await findLocator(action.target);
            ensurePage(currentPageKey);
            if (loc) {
              pageLocators[currentPageKey][action.target] = loc;
              try {
                const sel = loc[0] === 'xpath' ? `xpath=${loc[1]}` : loc[1];
                await domTab.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
                await domTab.locator(sel).first().check({ timeout: 8000 });
              } catch { /* checkbox failed */ }
            }
            featureLines.push(`    Given select "${action.target}" Checkbox`);
            await domTab.waitForTimeout(500);
          } else if (action.type === 'radio') {
            const loc = await findLocator(action.target);
            ensurePage(currentPageKey);
            if (loc) {
              pageLocators[currentPageKey][action.target] = loc;
              try {
                const sel = loc[0] === 'xpath' ? `xpath=${loc[1]}` : loc[1];
                await domTab.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
                await domTab.locator(sel).first().check({ timeout: 8000 });
              } catch { /* radio failed */ }
            }
            featureLines.push(`    When clicks on "${action.target}" Radio button`);
            await domTab.waitForTimeout(500);
          } else if (action.type === 'dropdown') {
            const loc = await findLocator(action.target);
            ensurePage(currentPageKey);
            if (loc) {
              pageLocators[currentPageKey][action.target] = loc;
              const sel = loc[0] === 'xpath' ? `xpath=${loc[1]}` : loc[1];
              const field = domTab.locator(sel).first();
              await field.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
              const tag = await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
              if (tag === 'select') {
                // Native dropdown
                await field.selectOption({ label: action.value }).catch(() => {});
              } else {
                // Custom combobox (Ant/MUI/PrimeReact/react-select): open then click option
                await field.click({ timeout: 5000 }).catch(() => {});
                await domTab.waitForTimeout(400);
                const optionSelectors = [
                  `[role="option"]:has-text("${action.value}")`,
                  `.ant-select-item-option:has-text("${action.value}")`,
                  `li:has-text("${action.value}")`,
                  `[class*="option"]:has-text("${action.value}")`,
                  `text="${action.value}"`,
                ];
                for (const os of optionSelectors) {
                  const opt = domTab.locator(os).first();
                  if (await opt.count().catch(() => 0)) {
                    if (await opt.click({ timeout: 4000 }).then(() => true).catch(() => false)) break;
                  }
                }
              }
            }
            featureLines.push(`    When selects "${action.value}" text from "${action.target}" Drop-down list`);
            await domTab.waitForTimeout(600);
          } else if (action.type === 'table') {
            ensurePage(currentPageKey);
            // Capture the table's header columns + a unique locator for it.
            const tableInfo = await domTab.evaluate((nameHint) => {
              const tables = Array.from(document.querySelectorAll('table'));
              const pick = tables.find((t) =>
                (t.id && t.id.toLowerCase().includes(String(nameHint).toLowerCase())) ||
                (t.textContent || '').toLowerCase().includes(String(nameHint).toLowerCase()),
              ) || tables[0];
              if (!pick) return null;
              const headers = Array.from(pick.querySelectorAll('th, thead td'))
                .map((h) => (h.textContent || '').trim()).filter(Boolean);
              const idx = tables.indexOf(pick) + 1;
              const id = (pick as HTMLElement).id || '';
              const expr = id ? `//*[@id='${id}']` : `(//table)[${idx}]`;
              // First data row (sample) so the generated DataTable isn't empty.
              const firstRow = Array.from(pick.querySelectorAll('tbody tr, tr'))
                .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim()))
                .find((cells) => cells.length > 0) || [];
              return { headers, expr, firstRow };
            }, action.target).catch(() => null);

            if (tableInfo && tableInfo.headers.length) {
              pageLocators[currentPageKey][action.target] = ['xpath', tableInfo.expr];
              featureLines.push(`    When verify data from "${action.target}" web table`);
              // DataTable: header row + one sample data row (edit as needed).
              featureLines.push(`      | ${tableInfo.headers.join(' | ')} |`);
              if (tableInfo.firstRow.length) {
                const row = tableInfo.headers.map((_, i) => tableInfo.firstRow[i] || '');
                featureLines.push(`      | ${row.join(' | ')} |`);
              }
            } else {
              featureLines.push(`    # ⚠ Could not find web table "${action.target}"`);
              featureLines.push(`    When verify data from "${action.target}" web table`);
              featureLines.push(`      | Column1 | Column2 |`);
              featureLines.push(`      | value1  | value2  |`);
            }
            await domTab.waitForTimeout(400);
          } else if (action.type === 'verify') {
            featureLines.push(`    Then verify "${action.text}" text is present on the screen`);
          }
        }
      } finally {
        await domTab.close().catch(() => {});
      }

      // ── Step 3: Write YAML files into the organized category folder ──────────
      const builtFeature = featureLines.join('\n') + '\n';
      const category: FeatureCategory = classifyFeature(builtFeature);
      ensureCategoryDirs(category);
      let totalLocators = 0;
      // Write a YAML for EVERY page that appeared (even pages with no captured
      // locators — e.g. a verify-only page after a redirect still gets its file).
      for (const [pk, locs] of Object.entries(pageLocators)) {
        const lines: string[] = [];
        for (const [name, [strategy, expression]] of Object.entries(locs)) {
          lines.push(`${name}:`, `  - ${strategy}`, `  - ${expression}`, '');
          totalLocators++;
        }
        // Empty page → just the page-key header (no invented locators).
        pageYamls[pk] = lines.length ? lines.join('\n') : `${pk}:\n`;
        const locPath = locatorFilePath(category, pk);
        ensureDir(path.dirname(locPath));
        fs.writeFileSync(locPath, pageYamls[pk] + (lines.length ? '\n' : ''), 'utf8');
        // title = real document.title captured during the run; label = first element name
        registerPage(pagesYamlPath, pk, pageTitles[pk] || pk, Object.keys(locs)[0] || '');
      }

      const actionCount = actions.filter(a => a.type !== 'page').length;
      return {
        featureContent: featureLines.join('\n') + '\n',
        pageYamls,
        status: `✅ Parsed ${actionCount} action(s), found ${totalLocators} locator(s) from real DOM. Review and Save.`,
      };
    },
  );


  await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  // Inject the DOM Mode panel (the only generator — zero LLM).
  await injectAiGeneratePanel(page).catch(() => undefined);

  // Re-attach the panel after each navigation. The toolbar itself is re-injected
  // automatically by addInitScript, and injectAiGeneratePanel polls for the toolbar.
  page.on('load', () => {
    injectAiGeneratePanel(page).catch(() => undefined);
  });

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
