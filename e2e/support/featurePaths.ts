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

const ROOT = path.resolve(process.cwd(), 'e2e');
export const FEATURE_ROOT = path.join(ROOT, 'features', 'generated');
export const LOCATOR_ROOT = path.join(ROOT, 'locators', 'generated');

export type FeatureCategory = 'endtoend' | 'web' | 'api' | 'ai';
export const CATEGORIES: FeatureCategory[] = ['endtoend', 'web', 'api', 'ai'];

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
export function locatorFilePath(cat: FeatureCategory, pageKey: string, ext: 'yaml' | 'json' = 'yaml'): string {
  return path.join(LOCATOR_ROOT, cat, `${pageKey}.${ext}`);
}
export function commonFilePath(cat: FeatureCategory, ext: 'yaml' | 'json' = 'yaml'): string {
  return path.join(LOCATOR_ROOT, cat, `common.${ext}`);
}

/** Create the category feature + locator folders (+ empty common.yaml). */
export function ensureCategoryDirs(cat: FeatureCategory): void {
  fs.mkdirSync(featureDir(cat), { recursive: true });
  fs.mkdirSync(locatorDir(cat), { recursive: true });
  const cp = commonFilePath(cat);
  if (!fs.existsSync(cp)) fs.writeFileSync(cp, '', 'utf8');
}

/**
 * Which locator file extension to look for FIRST, driven by
 * e2e/config/config.yaml's `locators.format` (LOCATOR_FORMAT env var, set by
 * support/config.ts). The other extension is still tried as a fallback, so a
 * project with mixed yaml/json files keeps working - this only decides which
 * one wins when both exist for the same page/common key.
 */
export function preferredLocatorExts(): Array<'yaml' | 'json'> {
  const fmt = String(process.env.LOCATOR_FORMAT || '').toLowerCase();
  return fmt === 'json' ? ['json', 'yaml'] : ['yaml', 'json'];
}

/** Runtime: locate a page's locator file (yaml or json) across category folders, with legacy fallbacks. */
export function findLocatorFile(pageKey: string): string | null {
  const exts = preferredLocatorExts();
  for (const cat of CATEGORIES) {
    for (const ext of exts) {
      const fp = locatorFilePath(cat, pageKey, ext);
      if (fs.existsSync(fp)) return fp;
    }
  }
  // Per-page locator files under locators/generated/ai/pages/ (combined mode).
  for (const ext of exts) {
    const aiPages = path.join(LOCATOR_ROOT, 'ai', 'pages', `${pageKey}.${ext}`);
    if (fs.existsSync(aiPages)) return aiPages;
  }
  // Legacy fallbacks (old layouts)
  for (const ext of exts) {
    const flat = path.join(LOCATOR_ROOT, `${pageKey}.${ext}`);
    if (fs.existsSync(flat)) return flat;
  }
  for (const cat of CATEGORIES) {
    for (const ext of exts) {
      const legacyCat = path.join(ROOT, 'generated', cat, 'locator', `${pageKey}.${ext}`);
      if (fs.existsSync(legacyCat)) return legacyCat;
    }
  }
  for (const ext of exts) {
    const legacyPages = path.join(ROOT, 'locators', 'pages', `${pageKey}.${ext}`);
    if (fs.existsSync(legacyPages)) return legacyPages;
  }
  return null;
}

/** Runtime: every common locator file (yaml or json) across categories (+ legacy locations). */
export function findCommonFiles(): string[] {
  const out: string[] = [];
  const exts = preferredLocatorExts();
  const push = (...candidates: string[]) => candidates.forEach((f) => fs.existsSync(f) && out.push(f));
  for (const cat of CATEGORIES) {
    push(...exts.map((ext) => commonFilePath(cat, ext)));
  }
  push(...exts.map((ext) => path.join(LOCATOR_ROOT, `common.${ext}`)));
  for (const cat of CATEGORIES) {
    push(...exts.map((ext) => path.join(ROOT, 'generated', cat, 'locator', `common.${ext}`)));
  }
  push(...exts.map((ext) => path.join(ROOT, 'locators', `common.${ext}`)));
  return out;
}
