/**
 * Cucumber World definition for Playwright UI + API replay/execution.
 */
import {
  type IWorldOptions,
  setWorldConstructor,
  World,
} from '@cucumber/cucumber';
import type { APIRequestContext } from 'playwright';
import type { Browser, BrowserContext, Frame, Locator, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createEmptyApiState, type ApiState } from './apiState';
import type { RunConfig } from '../support/mode';
import { findCommonFiles, findLocatorFile } from '../support/featurePaths';

type LocatorTuple = [string, string];
type PageRegistryRow = { title: string; label: string };

export class AutomationWorld extends World {
  // Playwright UI browser primitives (optional; may be absent in API-only mode).
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;

  /** Active screen key from last "User is on ... screen" step. */
  currentPageKey?: string;
  pagesRegistry: Record<string, PageRegistryRow[]> = {};
  /** Locators for current page (locators/generated/<cat>/<pageKey>.yaml). */
  readonly pageLocatorByName = new Map<string, LocatorTuple>();
  /** Shared locators (locators/common.yaml + locators/generated/<cat>/common.yaml). */
  readonly commonLocatorByName = new Map<string, LocatorTuple>();

  // API replay/execution state.
  apiRequestContext?: APIRequestContext;
  apiState: ApiState = createEmptyApiState();

  /** When true, we attached API capture listeners to the page. */
  apiCaptureEnabled = false;
  /** Optional cleanup callback for capture listeners. */
  apiCaptureStop?: () => void;

  /** Environment-derived run configuration (mode/capture/browser flags). */
  runConfig?: RunConfig;

  constructor(props: IWorldOptions) {
    super(props);
  }

  loadCommonLocators(): void {
    this.commonLocatorByName.clear();
    for (const fp of findCommonFiles()) {
      try {
        const raw = fs.readFileSync(fp, 'utf8');
        const doc = yaml.load(raw) as unknown;
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
        for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
          if (Array.isArray(v) && v.length >= 2) this.commonLocatorByName.set(k, [String(v[0]), String(v[1])]);
        }
      } catch {
        // skip unreadable common file
      }
    }
  }

  /** Resolve table/container: current page YAML → common.yaml → fallback xpath by id. */
  getTableRootLocator(objName: string): Locator {
    if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
    const p = this.page;
    const name = objName.trim();
    const fromMap = (m: Map<string, LocatorTuple>): Locator | null => {
      const direct = m.get(name);
      const tuple = direct ?? [...m.entries()].find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
      if (!tuple) return null;
      const [kind, expr] = tuple;
      if (kind.toLowerCase() === 'xpath') return p.locator(`xpath=${expr}`);
      return p.locator(expr);
    };
    return fromMap(this.pageLocatorByName) ?? fromMap(this.commonLocatorByName) ?? p.locator(`xpath=//*[@id=${JSON.stringify(name)}]`);
  }

  loadPagesRegistry(): void {
    this.pagesRegistry = {};
    // pages.yaml is under e2e/locators/ — one level up from stepdefinitions/
    const p = path.join(__dirname, '..', 'locators', 'pages.yaml');
    if (!fs.existsSync(p)) return;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const doc = yaml.load(raw) as unknown;
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) this.pagesRegistry = doc as Record<string, PageRegistryRow[]>;
    } catch {
      this.pagesRegistry = {};
    }
  }

  loadPageLocators(pageKey: string): void {
    this.pageLocatorByName.clear();
    let fp = findLocatorFile(pageKey);
    if (!fp) {
      // Create a placeholder in the legacy pages/ subfolder so the run can continue.
      fp = path.join(__dirname, '..', 'locators', 'pages', `${pageKey}.yaml`);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, yaml.dump({}, { noRefs: true, lineWidth: 160 }), 'utf8');
    }
    const raw = fs.readFileSync(fp, 'utf8');
    const doc = yaml.load(raw) as unknown;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length >= 2) this.pageLocatorByName.set(k, [String(v[0]), String(v[1])]);
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

  resolveTarget(name: string): LocatorTuple {
    if (!this.currentPageKey) {
      throw new Error(`No active page set. Add step: Given User is on "<pageKey>" screen`);
    }
    const tuple = this.tryResolveTuple(name);
    if (tuple) return tuple;
    const fp = findLocatorFile(this.currentPageKey) || path.join(__dirname, '..', 'locators', 'pages', `${this.currentPageKey}.yaml`);
    throw new Error(`Element "${name}" not found in page "${this.currentPageKey}"\nFile: ${fp}`);
  }

  smartLocator(name: string): Locator {
    const p = this.page!;
    const n = name.trim();
    return p
      .getByRole('button', { name: n })
      .or(p.getByRole('link', { name: n }))
      .or(p.getByRole('textbox', { name: n }))
      .or(p.getByRole('combobox', { name: n }))
      .or(p.getByPlaceholder(n))
      .or(p.getByLabel(n))
      .or(p.locator(`xpath=//*[@id=${JSON.stringify(n)} or @name=${JSON.stringify(n)} or @placeholder=${JSON.stringify(n)}]`))
      .or(p.getByText(n, { exact: false }))
      .first();
  }

  getLocator(name: string): Locator {
    if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
    const p = this.page;
    const tuple = this.tryResolveTuple(name);
    if (!tuple) {
      return this.smartLocator(name);
    }
    const [kind, expr] = tuple;
    if (kind.toLowerCase() === 'xpath') {
      return p.locator(`xpath=${expr}`).first();
    }
    return p.locator(expr).first();
  }

  getLocatorInFirstFrame(name: string): Locator {
    if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
    const [kind, expr] = this.resolveTarget(name);
    const fl = this.page.frameLocator('iframe').first();
    if (kind.toLowerCase() === 'xpath') {
      return fl.locator(`xpath=${expr}`).first();
    }
    return fl.locator(expr).first();
  }

  /**
   * Resolve a locator that may live on the main page OR inside any iframe.
   * Tries the main page first, then every child frame, returning the matching
   * locator together with the scope it was found in (so option panels / nested
   * queries can run in the same frame). Falls back to the main-page locator.
   */
  async resolveAcrossFrames(name: string): Promise<{ loc: Locator; scope: Page | Frame }> {
    if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
    const tuple = this.tryResolveTuple(name);
    const kind = tuple ? tuple[0].toLowerCase() : 'xpath';
    const expr = tuple ? tuple[1] : null;
    if (expr) {
      // page.frames() includes the main frame; check the Page object first anyway.
      const scopes: Array<Page | Frame> = [this.page, ...this.page.frames()];
      for (const scope of scopes) {
        try {
          const loc = kind === 'xpath' ? scope.locator(`xpath=${expr}`).first() : scope.locator(expr).first();
          if ((await loc.count().catch(() => 0)) > 0) return { loc, scope };
        } catch { /* try next scope */ }
      }
      // Nothing matched yet — the frame may still be loading. Return the main-page
      // locator so the caller's expect(visible) retries against the live DOM.
      const main = kind === 'xpath' ? this.page.locator(`xpath=${expr}`).first() : this.page.locator(expr).first();
      return { loc: main, scope: this.page };
    }
    // No YAML tuple — fall back to the smart heuristic locator (page-scoped).
    return { loc: this.getLocator(name), scope: this.page };
  }
}

setWorldConstructor(AutomationWorld);
