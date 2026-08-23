/**
 * Page registry: pageKey, titles, labels, and per-page locator YAML paths.
 * Aligns feature steps, pages.yaml, and locators/pages/<pageKey>.yaml.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export type PageMetaEntry = { title: string; label: string };

/** Optional structured input for title/label (e.g. WebIO-style steps). */
export type PageStepInput = {
  title?: string;
  screenId?: string;
  labels?: string[];
  uiActions?: Array<{ logicalName?: string }>;
  stepName?: string;
  name?: string;
};

export function generatePageKey(step: PageStepInput, index: number): string {
  const rawName = step.stepName || step.name || `Step${index + 1}`;
  const key = String(rawName).replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
  return key || `Step${index + 1}`;
}

export function humanize(text: string): string {
  const s = String(text || '').trim();
  if (!s) return '';

  const spaced = s
    // Step1UserInfo -> Step 1User Info (then next rule fixes 1User)
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    // Step 1User -> Step 1 User
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    // UserInfo -> User Info
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim();

  // "tester" -> "Tester", "step 1 user info" -> "Step 1 User Info"
  return spaced
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function generateTitle(step: PageStepInput, pageKey: string): string {
  return step.title || step.screenId || humanize(pageKey) || pageKey;
}

export function generateLabel(step: PageStepInput, pageKey: string): string {
  if (step.labels && step.labels.length > 0) {
    const first = String(step.labels.find((x) => String(x || '').trim().length) || '').trim();
    return first || humanize(pageKey) || pageKey;
  }

  if (step.uiActions && step.uiActions.length > 0) {
    const first = step.uiActions.map((a) => a.logicalName).find((x) => String(x || '').trim().length);
    return (first ? String(first).trim() : '') || humanize(pageKey) || pageKey;
  }

  return humanize(pageKey) || pageKey;
}

export function loadYamlRecord(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const doc = yaml.load(raw) as unknown;
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function saveYaml(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const dumped = yaml.dump(data, { noRefs: true, lineWidth: 160 });
  fs.writeFileSync(filePath, dumped, 'utf8');
}

/**
 * Register or update a page in pages.yaml (merged, keyed by pageKey).
 */
export function registerPage(pagesYamlPath: string, pageKey: string, title: string, label: string): void {
  const pages = loadYamlRecord(pagesYamlPath);
  pages[pageKey] = [{ title, label }];
  saveYaml(pagesYamlPath, pages);
}

export function resolvePageLocatorPath(pageKey: string, locatorRoot: string): string {
  return path.join(locatorRoot, 'pages', `${pageKey}.yaml`);
}

export function resolvePagesYamlPath(locatorRoot: string): string {
  return path.join(locatorRoot, 'pages.yaml');
}

/**
 * Ensure per-page locator file exists; returns absolute file path.
 */
export function createLocatorFile(pageKey: string, locatorRoot: string): string {
  const filePath = resolvePageLocatorPath(pageKey, locatorRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, yaml.dump({}, { noRefs: true, lineWidth: 160 }), 'utf8');
  }
  return filePath;
}

export type LocatorTuple = [string, string];

export function locatorMapToJsonObject(map: Map<string, LocatorTuple>): Record<string, LocatorTuple> {
  const out: Record<string, LocatorTuple> = {};
  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    out[k] = map.get(k)!;
  }
  return out;
}

export function writePageLocatorsYaml(filePath: string, map: Map<string, LocatorTuple>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const doc = locatorMapToJsonObject(map);
  fs.writeFileSync(filePath, yaml.dump(doc, { noRefs: true, lineWidth: 160 }), 'utf8');
}
