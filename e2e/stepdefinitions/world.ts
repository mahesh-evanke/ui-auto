/**
 * Cucumber World definition for Playwright UI + API replay/execution.
 */
import {
  type IWorldOptions,
  setWorldConstructor,
  World,
} from '@cucumber/cucumber';
import type { APIRequestContext } from 'playwright';
import type { Browser, BrowserContext, Frame, FrameLocator, Locator, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createEmptyApiState, type ApiState } from './apiState';
import type { RunConfig } from '../support/mode';
import { findCommonFiles, findLocatorFile } from '../support/featurePaths';

type LocatorTuple = [string, string] | [string, string, string];
type PageRegistryRow = { title: string; label: string };

const SEMANTIC_KINDS = new Set(['label', 'placeholder', 'text', 'testid', 'alttext', 'title']);

/**
 * Reconstructs the actual Playwright locator a tuple describes. Plain
 * strings only, no embedded JSON - kind carries the strategy (with the ARIA
 * role folded into it for role:<ariaRole>, so "role" never appears twice),
 * value is the plain accessible name/label/text/etc. An XPath fallback
 * (tuple[2]) is OR'd in for resilience if the semantic match ever breaks -
 * mirroring how the recorder itself always keeps an XPath fallback around.
 * 'xpath'/'css' and the WDIO-style kinds (id/name/tagName/className/
 * linkText/buttonText) behave exactly as before.
 */
function buildLocatorFromTuple(scope: Page | Frame | FrameLocator, tuple: LocatorTuple): Locator {
  const [kindRaw, expr, xpathFallback] = tuple;
  const kind = kindRaw.toLowerCase();

  if (kind === 'xpath') return scope.locator(`xpath=${expr}`);
  if (kind === 'css') return scope.locator(expr);

  // role:<ariaRole> e.g. "role:button", "role:link" - the ARIA role lives in
  // the kind itself, value is just the plain accessible name.
  if (kind.startsWith('role:')) {
    const ariaRole = kind.slice('role:'.length);
    const semantic = scope.getByRole(ariaRole as never, { name: expr, exact: true });
    return xpathFallback ? semantic.or(scope.locator(`xpath=${xpathFallback}`)) : semantic;
  }

  // WDIO-style attribute/tag/text kinds, translated to their Playwright
  // equivalent instead of a WDIO-flavoured selector string. id/name/tagName/
  // className are all just CSS under the hood (Playwright's own locator()
  // takes CSS natively); linkText/buttonText use getByRole with an exact
  // accessible-name match, which is the idiomatic Playwright replacement for
  // WDIO's generic "=exact text" strategy.
  switch (kind) {
    case 'id':
      return scope.locator(`#${expr}`);
    case 'name':
      return scope.locator(`[name="${expr}"]`);
    case 'tagname':
      return scope.locator(expr);
    case 'classname':
      return scope.locator(`.${expr}`);
    case 'linktext':
      return scope.getByRole('link', { name: expr, exact: true });
    case 'buttontext':
      return scope.getByRole('button', { name: expr, exact: true });
    default:
      break;
  }

  if (SEMANTIC_KINDS.has(kind)) {
    let semantic: Locator;
    switch (kind) {
      case 'label':
        semantic = scope.getByLabel(expr, { exact: true });
        break;
      case 'placeholder':
        semantic = scope.getByPlaceholder(expr, { exact: true });
        break;
      case 'text':
        semantic = scope.getByText(expr, { exact: true });
        break;
      case 'testid':
        semantic = scope.getByTestId(expr);
        break;
      case 'alttext':
        semantic = scope.getByAltText(expr, { exact: true });
        break;
      case 'title':
        semantic = scope.getByTitle(expr, { exact: true });
        break;
      default:
        semantic = scope.locator(`xpath=${xpathFallback || ''}`);
    }
    return xpathFallback ? semantic.or(scope.locator(`xpath=${xpathFallback}`)) : semantic;
  }

  // Any other kind: generic attribute selector using the kind string itself
  // as the attribute name (e.g. kind="data-testid" -> [data-testid="value"]),
  // matching WDIO's PageConfigHelper.locationPath() fallback exactly.
  return scope.locator(`[${kind}="${expr}"]`);
}

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

  /** Parse a locator file — supports both .yaml and .json extensions. */
  private parseLocatorFile(fp: string): Record<string, unknown> | null {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const doc = fp.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
      return doc as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private static tupleFromYamlValue(v: unknown[]): LocatorTuple {
    return v.length >= 3
      ? [String(v[0]), String(v[1]), String(v[2])]
      : [String(v[0]), String(v[1])];
  }

  loadCommonLocators(): void {
    this.commonLocatorByName.clear();
    for (const fp of findCommonFiles()) {
      const doc = this.parseLocatorFile(fp);
      if (!doc) continue;
      for (const [k, v] of Object.entries(doc)) {
        if (Array.isArray(v) && v.length >= 2) this.commonLocatorByName.set(k, AutomationWorld.tupleFromYamlValue(v));
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
      return buildLocatorFromTuple(p, tuple);
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
      // Create a placeholder yaml so the run can continue.
      fp = path.join(__dirname, '..', 'locators', 'pages', `${pageKey}.yaml`);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, yaml.dump({}, { noRefs: true, lineWidth: 160 }), 'utf8');
    }
    const doc = this.parseLocatorFile(fp);
    if (!doc) return;
    for (const [k, v] of Object.entries(doc)) {
      if (Array.isArray(v) && v.length >= 2) this.pageLocatorByName.set(k, AutomationWorld.tupleFromYamlValue(v));
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
    const tuple = this.tryResolveTuple(name);
    if (!tuple) {
      return this.smartLocator(name);
    }
    return buildLocatorFromTuple(this.page, tuple).first();
  }

  getLocatorInFirstFrame(name: string): Locator {
    if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
    const tuple = this.resolveTarget(name);
    const fl = this.page.frameLocator('iframe').first();
    return buildLocatorFromTuple(fl, tuple).first();
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
    if (tuple) {
      // page.frames() includes the main frame; check the Page object first anyway.
      const scopes: Array<Page | Frame> = [this.page, ...this.page.frames()];
      for (const scope of scopes) {
        try {
          const loc = buildLocatorFromTuple(scope, tuple).first();
          if ((await loc.count().catch(() => 0)) > 0) return { loc, scope };
        } catch { /* try next scope */ }
      }
      // Nothing matched yet — the frame may still be loading. Return the main-page
      // locator so the caller's expect(visible) retries against the live DOM.
      return { loc: buildLocatorFromTuple(this.page, tuple).first(), scope: this.page };
    }
    // No YAML tuple — fall back to the smart heuristic locator (page-scoped).
    return { loc: this.getLocator(name), scope: this.page };
  }
}

setWorldConstructor(AutomationWorld);
