/**
 * Locator YAML file lookup — consumer projects keep locators under
 * e2e/locators/generated/<category>/<pageKey>.yaml (same layout the BDD
 * branches use), plus e2e/locators/common.yaml for shared elements.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(process.cwd(), 'e2e');
export const LOCATOR_ROOT = path.join(ROOT, 'locators', 'generated');

export type LocatorCategory = 'web' | 'api' | 'endtoend';
export const CATEGORIES: LocatorCategory[] = ['web', 'api', 'endtoend'];

export function locatorDir(cat: LocatorCategory): string {
  return path.join(LOCATOR_ROOT, cat);
}
export function locatorFilePath(cat: LocatorCategory, pageKey: string, ext: 'yaml' | 'json' = 'yaml'): string {
  return path.join(LOCATOR_ROOT, cat, `${pageKey}.${ext}`);
}

/** Extension probe order - json first when LOCATOR_FORMAT=json (both formats still load either way). */
function preferredExts(): Array<'yaml' | 'json'> {
  return String(process.env.LOCATOR_FORMAT || '').toLowerCase() === 'json' ? ['json', 'yaml'] : ['yaml', 'json'];
}

/** Locate a page's locator file (yaml or json) across category folders. */
export function findLocatorFile(pageKey: string): string | null {
  const exts = preferredExts();
  for (const cat of CATEGORIES) {
    for (const ext of exts) {
      const fp = locatorFilePath(cat, pageKey, ext);
      if (fs.existsSync(fp)) return fp;
    }
  }
  // Flat layout fallback: e2e/locators/generated/<pageKey>.yaml
  for (const ext of exts) {
    const flat = path.join(LOCATOR_ROOT, `${pageKey}.${ext}`);
    if (fs.existsSync(flat)) return flat;
  }
  return null;
}

/** Every common locator file (yaml or json) across categories, plus the shared common.yaml/json. */
export function findCommonFiles(): string[] {
  const out: string[] = [];
  const [first, second] = preferredExts();
  const push = (...candidates: string[]) => candidates.forEach((f) => fs.existsSync(f) && out.push(f));
  for (const cat of CATEGORIES) {
    push(path.join(LOCATOR_ROOT, cat, `common.${first}`), path.join(LOCATOR_ROOT, cat, `common.${second}`));
  }
  push(path.join(ROOT, 'locators', `common.${first}`), path.join(ROOT, 'locators', `common.${second}`));
  return out;
}
