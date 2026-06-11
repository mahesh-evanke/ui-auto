/**
 * Converts recorded actions into Gherkin steps and per-page JSON locator entries.
 * Maps only to the approved step vocabulary.
 */
import type { ResolvedLocator } from './selectorEngine';
import type { PageStepInput } from './pageRegistry';
import { generateLabel, generateTitle } from './pageRegistry';

export type RecordedActionType =
  | 'navigate'
  | 'click'
  | 'input'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'assert_text'
  | 'assert_web_table'
  | 'verify';

export type RecordedAction = {
  type: RecordedActionType;
  href: string;
  /** Epoch ms when the action was recorded (for UI+API interleaving). */
  timestamp?: number;
  /** Element display name */
  element: string;
  /** For input/select */
  value?: string;
  /** xpath or css + expression */
  locator: [string, string];
  /** button | link | textbox | select | checkbox | radio */
  controlKind: 'button' | 'link' | 'textbox' | 'select' | 'checkbox' | 'radio';
};

export type GeneratedPage = {
  pageKey: string;
  title: string;
  label: string;
  locatorMap: Map<string, [string, string]>;
};

export type GenerationResult = {
  featurePath: string;
  featureContent: string;
  /** First page (backward compatible) — feature includes "User is on <pageKey> screen". */
  pageKey?: string;
  pageMeta?: { title: string; label: string };
  locatorMap: Map<string, [string, string]>;
  /** All pages (one per redirected screen). Each gets its own locators/<pageKey>.yaml. */
  pages?: GeneratedPage[];
};

function normalizeKey(name: string): string {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function capitalizeWords(s: string): string {
  const normalized = normalizeKey(s);
  if (!normalized) return '';
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      if (!w) return w;
      if (/^[A-Z0-9_]+$/.test(w) && w.length > 1) return w; // acronyms
      if (/^[a-z]+$/i.test(w)) return w[0].toUpperCase() + w.slice(1).toLowerCase();
      return w;
    })
    .join(' ');
}

function escapeFeatureString(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function indentStepLines(step: string, indent: string): string {
  const parts = String(step ?? '').split('\n');
  return parts.map((p) => `${indent}${p}`).join('\n');
}

/**
 * Merge locators by normalized YAML key; first non-empty wins unless later is more specific (longer xpath).
 */
export function dedupeLocators(entries: Array<{ key: string; locator: [string, string] }>): Map<string, [string, string]> {
  const map = new Map<string, [string, string]>();
  for (const e of entries) {
    const key = capitalizeWords(e.key);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, e.locator);
      continue;
    }
    const [, vNew] = e.locator;
    const [, vOld] = existing;
    if (String(vNew).length > String(vOld).length) map.set(key, e.locator);
  }
  return map;
}

function elementKey(name: string): string {
  return normalizeKey(name).toLowerCase();
}

/**
 * Merges repeated inputs (same element) so only the final typed value is emitted.
 * Also removes duplicate consecutive actions to avoid noisy steps.
 */
export function mergeRecordedActions(actions: RecordedAction[]): RecordedAction[] {
  const merged: RecordedAction[] = [];

  for (const a of actions) {
    if (a.type === 'navigate') continue;

    const last = merged[merged.length - 1];
    if (a.type === 'input' && last && last.type === 'input' && elementKey(last.element) === elementKey(a.element)) {
      merged[merged.length - 1] = { ...last, value: a.value, locator: a.locator };
      continue;
    }

    if (last) {
      const sameType = last.type === a.type;
      const sameElement = elementKey(last.element) === elementKey(a.element);
      const sameValue = (last.value ?? '') === (a.value ?? '');
      const sameControl = last.controlKind === a.controlKind;
      const sameLocator = JSON.stringify(last.locator) === JSON.stringify(a.locator);
      if (sameType && sameElement && sameValue && sameControl && sameLocator) continue;
    }

    merged.push(a);
  }

  return merged;
}

/** Render a single recorded action as one (possibly multi-line) Gherkin step. */
function renderActionStep(a: RecordedAction): string | null {
  const el = escapeFeatureString(capitalizeWords(a.element));
  switch (a.type) {
    case 'assert_text': {
      const text = escapeFeatureString(a.value ?? a.element ?? '');
      return `When verify "${text}" text is present on the screen`;
    }
    case 'assert_web_table': {
      const raw = String(a.value || '').trim();
      if (!raw) return `When verify "${el}" web table contains`;
      try {
        const parsed = JSON.parse(raw) as { tableName?: string; headers?: string[]; rows?: string[][] };
        const name = escapeFeatureString(parsed.tableName || capitalizeWords(a.element) || '');
        const headers = Array.isArray(parsed.headers) ? parsed.headers.map((h) => String(h ?? '')) : [];
        const rows = Array.isArray(parsed.rows) ? parsed.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])) : [];
        const out: string[] = [`When verify "${name}" web table contains`];
        if (headers.length) {
          const pipe = (cells: string[]) => `| ${cells.map((c) => escapeFeatureString(c)).join(' | ')} |`;
          out.push(`  ${pipe(headers)}`);
          for (const r of rows) out.push(`  ${pipe(r)}`);
        }
        return out.join('\n');
      } catch {
        return `When verify "${el}" web table contains`;
      }
    }
    case 'click':
      // Textbox/select clicks are redundant — the fill/select step implies focus.
      if (a.controlKind === 'textbox' || a.controlKind === 'select') return null;
      return a.controlKind === 'link' ? `When clicks on "${el}" link` : `When User clicks on "${el}" button`;
    case 'input':
      return `Given enters "${escapeFeatureString(a.value ?? '')}" text in "${el}" textbox`;
    case 'select':
      return `When selects "${escapeFeatureString(a.value ?? '')}" text from "${el}" Drop-down list`;
    case 'checkbox':
      return `Given select "${el}" Checkbox`;
    case 'radio':
      return `When clicks on "${el}" Radio button`;
    case 'verify': {
      const text = escapeFeatureString(a.value ?? a.element ?? '');
      return `When verify "${text}" text is present on the screen`;
    }
    default:
      return null;
  }
}

/** Make a page key from a URL path segment, e.g. /inputnumber/ → "inputnumber". */
function makePageKeyFromUrl(href: string, fallbackIndex: number): string {
  try {
    const u = new URL(href);
    const seg = u.pathname.split('/').filter(Boolean).pop() || u.hostname.split('.')[0] || '';
    const key = seg
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join('')
      .slice(0, 30);
    return key || `page${fallbackIndex}`;
  } catch {
    return `page${fallbackIndex}`;
  }
}

type PageSegment = { pageKey: string; href: string; actions: RecordedAction[] };

/**
 * Group actions into page segments. A new segment starts whenever the action's
 * href (the page it ran on) changes — so each redirected page becomes its own
 * "User is on <pageKey> screen" with its own locators.
 */
function segmentActionsByPage(actions: RecordedAction[], firstPageKey?: string): PageSegment[] {
  const acts = mergeRecordedActions(actions).filter((a) => a.type !== 'navigate');
  const segments: PageSegment[] = [];
  const keyByHref = new Map<string, string>();
  let count = 1;
  for (const a of acts) {
    const href = a.href || '';
    const last = segments[segments.length - 1];
    if (!last || last.href !== href) {
      let key: string;
      if (keyByHref.has(href)) key = keyByHref.get(href)!;
      else if (segments.length === 0) key = (firstPageKey && firstPageKey.trim()) || 'mainPage';
      else key = makePageKeyFromUrl(href, ++count);
      keyByHref.set(href, key);
      segments.push({ pageKey: key, href, actions: [] });
    }
    segments[segments.length - 1].actions.push(a);
  }
  return segments;
}

function toGherkinSteps(actions: RecordedAction[], scenarioUrl: string, pageKey?: string): string[] {
  const lines: string[] = [];
  lines.push(`Given User navigates to "${escapeFeatureString(scenarioUrl || 'about:blank')}" URL`);

  const pushLine = (line: string) => {
    if (line !== '' && lines.length && lines[lines.length - 1] === line) return;
    if (line === '' && lines.length && lines[lines.length - 1] === '') return;
    lines.push(line);
  };

  const segments = segmentActionsByPage(actions, pageKey);
  if (!segments.length && pageKey) {
    pushLine('');
    pushLine(`And User is on "${escapeFeatureString(pageKey)}" screen`);
  }
  for (const seg of segments) {
    pushLine('');
    pushLine(`And User is on "${escapeFeatureString(seg.pageKey)}" screen`);
    for (const a of seg.actions) {
      const step = renderActionStep(a);
      if (step) pushLine(step);
    }
  }
  return lines;
}

export function buildFeatureContent(scenarioTitle: string, steps: string[], featureName?: string): string {
  const fName = featureName || 'Auto Generated Test';
  const body = steps.map((s) => (s === '' ? '' : indentStepLines(s, '    '))).join('\n');
  return `Feature: ${fName}\n\n  Scenario: ${scenarioTitle}\n\n${body}\n`;
}

/** Full pipeline: actions → feature text + locator map (paths are chosen by caller). */
export function convertToArtifacts(
  actions: RecordedAction[],
  optionsPages: {
    scenarioTitle?: string;
    scenarioUrl?: string;
    featureFile?: string;
    /** Clean flat page key (no prefixes) — drives screen step + locators/pages/<pageKey>.yaml */
    pageKey?: string;
    pageStepInput?: PageStepInput;
    /** Human-readable name used as the Gherkin Feature title. */
    featureName?: string;
  },
): GenerationResult {
  const scenarioTitle = optionsPages.scenarioTitle || 'User flow';
  const scenarioUrl =
    optionsPages.scenarioUrl ||
    actions.find((a) => a.href && !a.href.startsWith('about:'))?.href ||
    actions[0]?.href ||
    'about:blank';

  const pageKey = optionsPages.pageKey?.trim() || undefined;
  const mergedForMeta = mergeRecordedActions(actions);
  const pageStepMerged: PageStepInput = {
    ...optionsPages.pageStepInput,
    uiActions: mergedForMeta.map((a) => ({ logicalName: capitalizeWords(a.element) })),
  };
  const pageMeta =
    pageKey !== undefined
      ? {
          title: generateTitle(pageStepMerged, pageKey),
          label: generateLabel(pageStepMerged, pageKey),
        }
      : undefined;

  const steps = toGherkinSteps(actions, scenarioUrl, pageKey);
  const featureContent = buildFeatureContent(scenarioTitle, steps, optionsPages.featureName);

  // Per-page locators: group each action's locator under the page it ran on.
  const segments = segmentActionsByPage(actions, pageKey);
  const pages: GeneratedPage[] = segments.map((seg) => {
    const entries: Array<{ key: string; locator: [string, string] }> = [];
    for (const a of seg.actions) {
      if (a.type === 'assert_text') continue; // text checks need no locator
      if (a.type === 'assert_web_table') {
        if (String((a.locator && a.locator[1]) || '').trim()) entries.push({ key: a.element, locator: a.locator });
        continue;
      }
      if (a.locator && a.locator[1]) entries.push({ key: a.element, locator: a.locator });
    }
    const locatorMap = dedupeLocators(entries);
    const firstLabel = seg.actions.find((a) => a.element)?.element || seg.pageKey;
    return {
      pageKey: seg.pageKey,
      title: capitalizeWords(seg.pageKey),
      label: capitalizeWords(firstLabel),
      locatorMap,
    };
  });

  // Backward-compatible single-page fields = the first page.
  const firstPage = pages[0];
  const map = firstPage ? firstPage.locatorMap : dedupeLocators([]);

  return {
    featurePath: optionsPages.featureFile || 'generated/flow.feature',
    featureContent,
    pageKey: firstPage ? firstPage.pageKey : pageKey,
    pageMeta: firstPage ? { title: firstPage.title, label: firstPage.label } : pageMeta,
    locatorMap: map,
    pages,
  };
}

/**
 * UI + API interleaved generation. Merges UI actions and API events by timestamp
 * so each API request/response appears at the exact point it occurred in the flow,
 * with page boundaries ("User is on X screen") preserved. Per-page locators come
 * from the UI actions only.
 */
export function convertToInterleavedArtifacts(
  actions: RecordedAction[],
  apiEvents: Array<{ timestamp: number; gherkin: string }>,
  optionsPages: { scenarioTitle?: string; scenarioUrl?: string; featureFile?: string; pageKey?: string; featureName?: string },
): GenerationResult {
  const scenarioTitle = optionsPages.scenarioTitle || 'User flow';
  const scenarioUrl =
    optionsPages.scenarioUrl ||
    actions.find((a) => a.href && !a.href.startsWith('about:'))?.href ||
    actions[0]?.href ||
    'about:blank';
  const firstPageKey = optionsPages.pageKey?.trim() || 'mainPage';

  const uiActs = mergeRecordedActions(actions).filter((a) => a.type !== 'navigate');

  // Sort ALL ui actions by timestamp (including non-renderable phantom clicks —
  // needed so group time windows are anchored to the earliest action on each page).
  const allSortedUi = [...uiActs].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const sortedApi   = [...apiEvents].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  // Group ALL ui actions by consecutive href.
  // Each group's time window = [startTs, endTs) where startTs is the first action's
  // timestamp and endTs is the first action timestamp of the next group.
  // APIs are assigned to a group if their timestamp falls in (startTs, endTs].
  // Within a group ALL renderable UI steps are emitted first, then APIs — so
  // "fill Email / fill Password / click Login" always precede "POST /login"
  // regardless of individual action timestamp precision.
  type UiGroup = { href: string; actions: RecordedAction[]; startTs: number; endTs: number };
  const uiGroups: UiGroup[] = [];
  for (const a of allSortedUi) {
    const href = a.href || '';
    if (!uiGroups.length || uiGroups[uiGroups.length - 1].href !== href) {
      uiGroups.push({ href, actions: [], startTs: a.timestamp ?? 0, endTs: Infinity });
    }
    uiGroups[uiGroups.length - 1].actions.push(a);
  }
  for (let i = 0; i < uiGroups.length - 1; i++) {
    uiGroups[i].endTs = uiGroups[i + 1].startTs;
  }

  const lines: string[] = [`Given User navigates to "${escapeFeatureString(scenarioUrl)}" URL`];
  const pushLine = (l: string) => {
    if (l !== '' && lines.length && lines[lines.length - 1] === l) return;
    if (l === '' && lines.length && lines[lines.length - 1] === '') return;
    lines.push(l);
  };

  const firstUiHref = uiGroups[0]?.href || scenarioUrl;
  let currentHref = firstUiHref;
  const keyByHref = new Map<string, string>([[firstUiHref, firstPageKey]]);
  let count = 1;
  pushLine('');
  pushLine(`And User is on "${escapeFeatureString(firstPageKey)}" screen`);

  // APIs that fired before any UI action (pre-page-load calls).
  const firstGroupStartTs = uiGroups[0]?.startTs ?? 0;
  for (const e of sortedApi.filter((e) => (e.timestamp ?? 0) < firstGroupStartTs)) {
    pushLine('');
    lines.push(e.gherkin);
  }

  // For each page group:
  //   1. Emit screen boundary step if the page changed.
  //   2. Emit every renderable UI action in order (non-renderable phantom clicks skipped).
  //   3. After ALL UI steps, emit every API whose timestamp falls in this group's window.
  //      This guarantees the triggering action (e.g. "click Login") always appears
  //      immediately before the API it caused (e.g. "POST /login").
  for (const g of uiGroups) {
    // Page boundary.
    if (g.href !== currentHref) {
      const key = keyByHref.has(g.href)
        ? keyByHref.get(g.href)!
        : makePageKeyFromUrl(g.href, ++count);
      keyByHref.set(g.href, key);
      currentHref = g.href;
      pushLine('');
      pushLine(`And User is on "${escapeFeatureString(key)}" screen`);
    }

    // Renderable UI steps in recorded order.
    for (const a of g.actions) {
      const step = renderActionStep(a);
      if (step) pushLine(step);
    }

    // APIs owned by this page (fired within this group's time window).
    for (const e of sortedApi.filter((e) => {
      const ts = e.timestamp ?? 0;
      return ts > g.startTs && ts <= g.endTs;
    })) {
      pushLine('');
      lines.push(e.gherkin);
    }
  }

  const featureContent = buildFeatureContent(scenarioTitle, lines, optionsPages.featureName);

  // Per-page locators (UI only).
  const segments = segmentActionsByPage(actions, firstPageKey);
  const pages: GeneratedPage[] = segments.map((seg) => {
    const entries: Array<{ key: string; locator: [string, string] }> = [];
    for (const a of seg.actions) {
      if (a.type === 'assert_text') continue;
      if (a.type === 'assert_web_table') {
        if (String((a.locator && a.locator[1]) || '').trim()) entries.push({ key: a.element, locator: a.locator });
        continue;
      }
      if (a.locator && a.locator[1]) entries.push({ key: a.element, locator: a.locator });
    }
    const firstLabel = seg.actions.find((a) => a.element)?.element || seg.pageKey;
    return {
      pageKey: seg.pageKey,
      title: capitalizeWords(seg.pageKey),
      label: capitalizeWords(firstLabel),
      locatorMap: dedupeLocators(entries),
    };
  });
  const firstPage = pages[0];

  return {
    featurePath: optionsPages.featureFile || 'generated/flow.feature',
    featureContent,
    pageKey: firstPage ? firstPage.pageKey : firstPageKey,
    pageMeta: firstPage ? { title: firstPage.title, label: firstPage.label } : undefined,
    locatorMap: firstPage ? firstPage.locatorMap : dedupeLocators([]),
    pages,
  };
}

export function mergeResolvedIntoAction(
  base: Omit<RecordedAction, 'element' | 'locator'>,
  resolved: ResolvedLocator,
): RecordedAction {
  return {
    ...base,
    element: capitalizeWords(resolved.name),
    locator: resolved.fallback,
  };
}
