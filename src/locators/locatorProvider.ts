/**
 * Locator provider for consumer projects.
 *
 * Consumers own locators under (e.g. e2e/web/locators or e2e/webui-api/locators):
 * - <locators-root>/common.json
 * - <locators-root>/pages.json
 * - <locators-root>/pages/*.json
 *
 * The SDK resolves these from the consumer root (cwd by default).
 */
import * as fs from 'fs';
import * as path from 'path';
import { getConsumerRoot } from '../config/consumerRoot';

export interface LocatorOpts {
  consumerRoot?: string;
  common?: boolean;
  pageName?: string;
}

const cache = new Map<string, Record<string, any>>();

function readJsonFile(filePath: string): Record<string, any> {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function getCachedJson(filePath: string): Record<string, any> {
  const abs = path.resolve(filePath);
  const existing = cache.get(abs);
  if (existing) return existing;
  if (!fs.existsSync(abs)) throw new Error(`Locator JSON not found: ${abs}`);
  const json = readJsonFile(abs);
  cache.set(abs, json);
  return json;
}

export function resolveLocatorsDir(opts?: LocatorOpts): string {
  const root = opts?.consumerRoot ? path.resolve(opts.consumerRoot) : getConsumerRoot();
  const override = process.env.UI_AUTO_LOCATORS_ROOT;
  if (override && override.trim().length > 0) {
    // Allow either absolute or project-relative override (e.g. "./e2e/web/locators").
    return path.isAbsolute(override)
      ? override
      : path.join(root, override);
  }
  return path.join(root, 'e2e', 'web', 'locators');
}

export function resolveCommonLocatorsPath(opts?: LocatorOpts): string {
  return path.join(resolveLocatorsDir(opts), 'common.json');
}

export function resolvePagesMapPath(opts?: LocatorOpts): string {
  return path.join(resolveLocatorsDir(opts), 'pages.json');
}

export function resolvePageLocatorsPath(pageName: string, opts?: LocatorOpts): string {
  return path.join(resolveLocatorsDir(opts), 'pages', `${pageName}.json`);
}

function normalizeLocatorValue(val: unknown): [string, string] | undefined {
  if (!Array.isArray(val)) return val as [string, string] | undefined;
  if (val.length >= 2 && (val.length === 2 || (val.length === 6 && val[0] && val[1]))) {
    return [String(val[0]), String(val[1])];
  }
  return undefined;
}

function normalizeKeyForLookup(name: string): string {
  // Backward-compatible, minimal normalization for generated keys:
  // - Ignore whitespace differences (e.g., "Type of Service *" vs "TypeofService*")
  // - Ignore case
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function getLocatorByFuzzyKey(
  json: Record<string, any>,
  elementName: string
): [string, string] | undefined {
  const norm = normalizeKeyForLookup(elementName);
  if (!norm) return undefined;
  const keys = Object.keys(json);
  for (const k of keys) {
    if (normalizeKeyForLookup(k) === norm) {
      return normalizeLocatorValue(json[k]) ?? (json[k] as [string, string] | undefined);
    }
  }
  return undefined;
}

export function getElementLocator(elementName: string, opts: LocatorOpts & { common?: boolean; pageName?: string }): [string, string] | undefined {
  const common = Boolean(opts.common);
  const pageName = opts.pageName;
  if (common) {
    const filePath = resolveCommonLocatorsPath(opts);
    const json = getCachedJson(filePath);
    const direct = normalizeLocatorValue(json[elementName]) ?? (json[elementName] as [string, string] | undefined);
    if (direct) return direct;
    return getLocatorByFuzzyKey(json, elementName);
  }
  const pagesPath = resolvePageLocatorsPath(String(pageName ?? ''), opts);
  if (fs.existsSync(pagesPath)) {
    const json = getCachedJson(pagesPath);
    const val = json[elementName];
    const normalized = normalizeLocatorValue(val);
    if (normalized) return normalized;
    const direct = val as [string, string] | undefined;
    if (direct) return direct;
    return getLocatorByFuzzyKey(json, elementName);
  }
  throw new Error(`Locator JSON not found: ${pagesPath}`);
}

export function getPageUrlByName(pageName: string, opts?: LocatorOpts): string {
  const json = getCachedJson(resolvePagesMapPath(opts));
  const v = json[pageName];
  if (typeof v === 'string') return v;
  return '';
}

export interface PageMetadata {
  title: string;
  label?: string;
}

export function getPageMetadata(screenName: string, opts?: LocatorOpts): PageMetadata | null {
  const json = getCachedJson(resolvePagesMapPath(opts));
  const raw = json[screenName];
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (!first || typeof first !== 'object') return null;
  const title = first.title;
  const label = first.label;
  if (!title || typeof title !== 'string') return null;
  return { title, label: typeof label === 'string' ? label : undefined };
}

export function clearLocatorCache(): void {
  cache.clear();
}
