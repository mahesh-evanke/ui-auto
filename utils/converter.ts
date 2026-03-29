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
  | 'assert_web_table';

export type RecordedAction = {
  type: RecordedActionType;
  href: string;
  /** Element display name */
  element: string;
  /** For input/select */
  value?: string;
  /** xpath or css + expression */
  locator: [string, string];
  /** button | link | textbox | select | checkbox | radio */
  controlKind: 'button' | 'link' | 'textbox' | 'select' | 'checkbox' | 'radio';
};

export type GenerationResult = {
  featurePath: string;
  featureContent: string;
  /** When set, feature includes "User is on <pageKey> screen" and locators go to pages/<pageKey>.yaml */
  pageKey?: string;
  pageMeta?: { title: string; label: string };
  locatorMap: Map<string, [string, string]>;
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

function toGherkinSteps(actions: RecordedAction[], scenarioUrl: string, pageKey?: string): string[] {
  const lines: string[] = [];
  const url = scenarioUrl || 'about:blank';
  lines.push(`Given User navigates to "${escapeFeatureString(url)}" URL`);
  if (pageKey) {
    lines.push(`Given User is on "${escapeFeatureString(pageKey)}" screen`);
  }

  const pushUnique = (line: string) => {
    if (lines.length && lines[lines.length - 1] === line) return;
    lines.push(line);
  };

  const mergedActions = mergeRecordedActions(actions);
  for (const a of mergedActions) {
    const el = escapeFeatureString(capitalizeWords(a.element));

    switch (a.type) {
      case 'assert_text': {
        const text = escapeFeatureString(a.value ?? a.element ?? '');
        pushUnique(`When verify "${text}" text is present on the screen`);
        break;
      }
      case 'assert_web_table': {
        const raw = String(a.value || '').trim();
        if (!raw) {
          pushUnique(`When verify "${el}" web table contains`);
          break;
        }
        try {
          const parsed = JSON.parse(raw) as { tableName?: string; headers?: string[]; rows?: string[][] };
          const name = escapeFeatureString(parsed.tableName || capitalizeWords(a.element) || '');
          const headers = Array.isArray(parsed.headers) ? parsed.headers.map((h) => String(h ?? '')) : [];
          const rows = Array.isArray(parsed.rows) ? parsed.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])) : [];

          const lines: string[] = [];
          lines.push(`When verify "${name}" web table contains`);
          if (headers.length) {
            const pipe = (cells: string[]) => `| ${cells.map((c) => escapeFeatureString(c)).join(' | ')} |`;
            lines.push(`  ${pipe(headers)}`);
            for (const r of rows) lines.push(`  ${pipe(r)}`);
          }
          pushUnique(lines.join('\n'));
        } catch {
          pushUnique(`When verify "${el}" web table contains`);
        }
        break;
      }
      case 'click': {
        if (a.controlKind === 'link') {
          pushUnique(`When clicks on "${el}" link`);
        } else {
          pushUnique(`When User clicks on "${el}" button`);
        }
        break;
      }
      case 'input': {
        const text = escapeFeatureString(a.value ?? '');
        pushUnique(`Given enters "${text}" text in "${el}" textbox`);
        break;
      }
      case 'select': {
        const val = escapeFeatureString(a.value ?? '');
        pushUnique(`When selects "${val}" text from "${el}" Drop-down list`);
        break;
      }
      case 'checkbox': {
        pushUnique(`Given select "${el}" Checkbox`);
        break;
      }
      case 'radio': {
        pushUnique(`When clicks on "${el}" Radio button`);
        break;
      }
      default:
        break;
    }
  }

  return lines;
}

export function buildFeatureContent(scenarioTitle: string, steps: string[]): string {
  const body = steps.map((s) => indentStepLines(s, '    ')).join('\n');
  return `Feature: Auto Generated Test\n\n  Scenario: ${scenarioTitle}\n\n${body}\n`;
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
  const featureContent = buildFeatureContent(scenarioTitle, steps);

  const locatorEntries: Array<{ key: string; locator: [string, string] }> = [];
  for (const a of actions) {
    if (a.type === 'navigate') continue;
    if (a.type === 'assert_text' || a.type === 'assert_web_table') continue;
    locatorEntries.push({ key: a.element, locator: a.locator });
  }
  const map = dedupeLocators(locatorEntries);

  return {
    featurePath: optionsPages.featureFile || 'generated/flow.feature',
    featureContent,
    pageKey,
    pageMeta,
    locatorMap: map,
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
