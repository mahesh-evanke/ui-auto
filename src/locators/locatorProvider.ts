/**
 * Locator provider for consumer projects.
 *
 * Consumers own locators under:
 * - e2e/locators/common.json
 * - e2e/locators/pages.json
 * - e2e/locators/pages/*.json
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
  return path.join(root, 'e2e', 'locators');
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

export function getElementLocator(elementName: string, opts: LocatorOpts & { common?: boolean; pageName?: string }): [string, string] | undefined {
  const common = Boolean(opts.common);
  const pageName = opts.pageName;
  const filePath = common ? resolveCommonLocatorsPath(opts) : resolvePageLocatorsPath(String(pageName ?? ''), opts);
  const json = getCachedJson(filePath);
  return json[elementName];
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
