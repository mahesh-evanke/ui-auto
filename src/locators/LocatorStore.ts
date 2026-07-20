/**
 * Loads and looks up locator tuples from YAML — the non-BDD equivalent of
 * AutomationWorld's locator bits in the Cucumber branches, minus the
 * Cucumber World dependency. One instance per test (created by the
 * `webActions` fixture).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Frame, FrameLocator, Locator, Page } from 'playwright';
import { buildLocatorFromTuple, type LocatorTuple } from './locatorResolver';
import { findCommonFiles, findLocatorFile } from './locatorPaths';
import { suggestClosestName } from './suggestLocatorName';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Converts a YAML list value into a LocatorTuple. Supports two forms:
 *   - [kind, value, xpathFallback?]        e.g. [label, Password, //input[@id='password']]
 *   - [{kind: value}, xpathFallback?]      e.g. [{label: Password}, //input[@id='password']]
 * The second form is shorthand: a single YAML mapping entry standing in for
 * the [kind, value] pair, so a locator can be written in one line less:
 *   Password Field:
 *     - label: Password
 *     - //input[@id='password']
 */
function tupleFromYamlValue(v: unknown[]): LocatorTuple {
  if (v.length >= 1 && isPlainObject(v[0])) {
    const entries = Object.entries(v[0]);
    if (entries.length === 1) {
      const [kind, value] = entries[0];
      const xpathFallback = v[1] !== undefined ? String(v[1]) : undefined;
      return xpathFallback ? [kind, String(value), xpathFallback] : [kind, String(value)];
    }
  }
  return v.length >= 3 ? [String(v[0]), String(v[1]), String(v[2])] : [String(v[0]), String(v[1])];
}

function parseLocatorFile(fp: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const doc = fp.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    return doc as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class LocatorStore {
  private readonly pageLocatorByName = new Map<string, LocatorTuple>();
  private readonly commonLocatorByName = new Map<string, LocatorTuple>();
  currentPageKey?: string;

  constructor() {
    this.loadCommonLocators();
  }

  private loadCommonLocators(): void {
    this.commonLocatorByName.clear();
    for (const fp of findCommonFiles()) {
      const doc = parseLocatorFile(fp);
      if (!doc) continue;
      for (const [k, v] of Object.entries(doc)) {
        if (Array.isArray(v) && v.length >= 2) this.commonLocatorByName.set(k, tupleFromYamlValue(v));
      }
    }
  }

  /** Load a page's locator YAML (e2e/locators/generated/<category>/<pageKey>.yaml). */
  usePage(pageKey: string): void {
    this.currentPageKey = pageKey.trim();
    this.pageLocatorByName.clear();
    const fp = findLocatorFile(this.currentPageKey);
    if (!fp) return;
    const doc = parseLocatorFile(fp);
    if (!doc) return;
    for (const [k, v] of Object.entries(doc)) {
      if (Array.isArray(v) && v.length >= 2) this.pageLocatorByName.set(k, tupleFromYamlValue(v));
    }
  }

  tryResolveTuple(name: string): LocatorTuple | null {
    const key = name.trim();
    const direct = this.pageLocatorByName.get(key) ?? this.commonLocatorByName.get(key);
    if (direct) return direct;
    const found =
      [...this.pageLocatorByName.entries()].find(([k]) => k.toLowerCase() === key.toLowerCase()) ??
      [...this.commonLocatorByName.entries()].find(([k]) => k.toLowerCase() === key.toLowerCase());
    return found ? found[1] : null;
  }

  /** Every locator name currently loaded (page-scoped + common), for "did you mean...?" suggestions. */
  allKnownNames(): string[] {
    return [...this.pageLocatorByName.keys(), ...this.commonLocatorByName.keys()];
  }

  /** Warns with the closest known name when `name` isn't registered in any loaded locator YAML. */
  private warnIfUnresolved(name: string): void {
    const suggestion = suggestClosestName(name, this.allKnownNames());
    if (suggestion) {
      console.warn(`[locators] "${name}" not found in any loaded locator YAML - did you mean "${suggestion}"? Falling back to a broad guess.`);
    }
  }

  /** Fallback when a name isn't registered in any locator YAML: a broad semantic guess. */
  smartLocator(page: Page, name: string): Locator {
    this.warnIfUnresolved(name);
    const n = name.trim();
    return page
      .getByRole('button', { name: n })
      .or(page.getByRole('link', { name: n }))
      .or(page.getByRole('textbox', { name: n }))
      .or(page.getByRole('combobox', { name: n }))
      .or(page.getByPlaceholder(n))
      .or(page.getByLabel(n))
      .or(page.locator(`xpath=//*[@id=${JSON.stringify(n)} or @name=${JSON.stringify(n)} or @placeholder=${JSON.stringify(n)}]`))
      .or(page.getByText(n, { exact: false }))
      .first();
  }

  getLocator(page: Page, name: string): Locator {
    const tuple = this.tryResolveTuple(name);
    if (!tuple) return this.smartLocator(page, name);
    return buildLocatorFromTuple(page, tuple).first();
  }

  getLocatorInFirstFrame(page: Page, name: string): Locator {
    const tuple = this.tryResolveTuple(name);
    const fl = page.frameLocator('iframe').first();
    if (!tuple) throw new Error(`Element "${name}" not found in any loaded locator YAML.`);
    return buildLocatorFromTuple(fl, tuple).first();
  }

  /**
   * Resolve a locator that may live on the main page OR inside any iframe.
   * Tries the main page first, then every child frame, returning the
   * matching locator together with the scope it was found in.
   */
  async resolveAcrossFrames(page: Page, name: string): Promise<{ loc: Locator; scope: Page | Frame }> {
    const tuple = this.tryResolveTuple(name);
    if (tuple) {
      const scopes: Array<Page | Frame> = [page, ...page.frames()];
      for (const scope of scopes) {
        try {
          const loc = buildLocatorFromTuple(scope, tuple).first();
          if ((await loc.count().catch(() => 0)) > 0) return { loc, scope };
        } catch {
          /* try next scope */
        }
      }
      return { loc: buildLocatorFromTuple(page, tuple).first(), scope: page };
    }
    return { loc: this.getLocator(page, name), scope: page };
  }

  /** Table root: page-scoped locator YAML → common.yaml → fallback xpath by id. */
  getTableRootLocator(page: Page, objName: string): Locator {
    const name = objName.trim();
    const fromMap = (m: Map<string, LocatorTuple>): Locator | null => {
      const direct = m.get(name);
      const tuple = direct ?? [...m.entries()].find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
      if (!tuple) return null;
      return buildLocatorFromTuple(page, tuple);
    };
    return (
      fromMap(this.pageLocatorByName) ?? fromMap(this.commonLocatorByName) ?? page.locator(`xpath=//*[@id=${JSON.stringify(name)}]`)
    );
  }
}
