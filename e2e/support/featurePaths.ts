/**
 * Output layout for generated artifacts.
 *
 *   feature/
 *     generated/
 *       endtoend/<name>.feature     (features with BOTH UI and API steps)
 *       web/<name>.feature          (UI-only features)
 *       api/<name>.feature          (API-only features)
 *
 *   locators/
 *     generated/
 *       endtoend/<pageKey>.yaml + common.yaml
 *       web/<pageKey>.yaml      + common.yaml
 *       api/<pageKey>.yaml      + common.yaml
 *     pages.yaml                    (global page registry — unchanged)
 *
 * Feature category is decided by the CONTENT of the generated feature.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
export const FEATURE_ROOT = path.join(ROOT, 'features', 'generated');
export const LOCATOR_ROOT = path.join(ROOT, 'locators', 'generated');

export type FeatureCategory = 'endtoend' | 'web' | 'api';
export const CATEGORIES: FeatureCategory[] = ['endtoend', 'web', 'api'];

/** Decide endtoend / web / api from the feature file content. */
export function classifyFeature(featureContent: string): FeatureCategory {
  const t = String(featureContent || '');
  const hasApi = /User sends\s+\w+\s+request|User expects status code|User validates response/i.test(t);
  const hasUi =
    /User clicks on|enters\s+"[^"]*"\s+text|User is on\s+"[^"]*"\s+screen|verify\s+"[^"]*"\s+text|verify data from|User navigates to/i.test(
      t,
    );
  if (hasApi && hasUi) return 'endtoend';
  if (hasApi && !hasUi) return 'api';
  return 'web';
}

// ── Feature paths (split by category) ─────────────────────────────────────────
export function featureDir(cat: FeatureCategory): string {
  return path.join(FEATURE_ROOT, cat);
}
export function featureFilePath(cat: FeatureCategory, name: string): string {
  return path.join(featureDir(cat), `${name}.feature`);
}

// ── Locator paths (split by category under locators/generated/<cat>) ──────────
export function locatorDir(cat: FeatureCategory): string {
  return path.join(LOCATOR_ROOT, cat);
}
export function locatorFilePath(cat: FeatureCategory, pageKey: string): string {
  return path.join(LOCATOR_ROOT, cat, `${pageKey}.yaml`);
}
export function commonFilePath(cat: FeatureCategory): string {
  return path.join(LOCATOR_ROOT, cat, 'common.yaml');
}

/** Create the category feature + locator folders (+ empty common.yaml). */
export function ensureCategoryDirs(cat: FeatureCategory): void {
  fs.mkdirSync(featureDir(cat), { recursive: true });
  fs.mkdirSync(locatorDir(cat), { recursive: true });
  const cp = commonFilePath(cat);
  if (!fs.existsSync(cp)) fs.writeFileSync(cp, '', 'utf8');
}

/** Runtime: locate a page's locator YAML across category folders, with legacy fallbacks. */
export function findLocatorFile(pageKey: string): string | null {
  for (const cat of CATEGORIES) {
    const fp = locatorFilePath(cat, pageKey);
    if (fs.existsSync(fp)) return fp;
  }
  // Legacy fallbacks (old layouts)
  const flat = path.join(LOCATOR_ROOT, `${pageKey}.yaml`);
  if (fs.existsSync(flat)) return flat;
  for (const cat of CATEGORIES) {
    const legacyCat = path.join(ROOT, 'generated', cat, 'locator', `${pageKey}.yaml`);
    if (fs.existsSync(legacyCat)) return legacyCat;
  }
  const legacyPages = path.join(ROOT, 'locators', 'pages', `${pageKey}.yaml`);
  if (fs.existsSync(legacyPages)) return legacyPages;
  return null;
}

/** Runtime: every common.yaml across categories (+ legacy locations). */
export function findCommonFiles(): string[] {
  const out: string[] = [];
  for (const cat of CATEGORIES) {
    const cp = commonFilePath(cat);
    if (fs.existsSync(cp)) out.push(cp);
  }
  const flat = path.join(LOCATOR_ROOT, 'common.yaml');
  if (fs.existsSync(flat)) out.push(flat);
  for (const cat of CATEGORIES) {
    const legacy = path.join(ROOT, 'generated', cat, 'locator', 'common.yaml');
    if (fs.existsSync(legacy)) out.push(legacy);
  }
  const legacyTop = path.join(ROOT, 'locators', 'common.yaml');
  if (fs.existsSync(legacyTop)) out.push(legacyTop);
  return out;
}
