/**
 * Cucumber World definition for Playwright UI + API replay/execution.
 */
import {
  type IWorldOptions,
  setWorldConstructor,
  World,
} from '@cucumber/cucumber';
import type { APIRequestContext } from 'playwright';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createEmptyApiState, type ApiState } from './apiState';
import type { RunConfig } from '../utils/mode';

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
  /** Locators for current page (locators/pages/<pageKey>.yaml). */
  readonly pageLocatorByName = new Map<string, LocatorTuple>();
  /** Optional shared locators (locators/common.yaml). Same shape as page YAML. */
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
    const fp = path.join(__dirname, '..', 'locators', 'common.yaml');
    if (!fs.existsSync(fp)) return;
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const doc = yaml.load(raw) as unknown;
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
      for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
        if (Array.isArray(v) && v.length >= 2) this.commonLocatorByName.set(k, [String(v[0]), String(v[1])]);
      }
    } catch {
      this.commonLocatorByName.clear();
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
    const fp = path.join(__dirname, '..', 'locators', 'pages', `${pageKey}.yaml`);
    if (!fs.existsSync(fp)) {
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

  resolveTarget(name: string): LocatorTuple {
    if (!this.currentPageKey) {
      throw new Error(`No active page set. Add step: Given User is on "<pageKey>" screen`);
    }

    const key = name.trim();
    const direct = this.pageLocatorByName.get(key);
    if (direct) return direct;
    const found = [...this.pageLocatorByName.entries()].find(([k]) => k.toLowerCase() === key.toLowerCase());
    if (found) return found[1];

    const fp = path.join(__dirname, '..', 'locators', 'pages', `${this.currentPageKey}.yaml`);
    throw new Error(`Element "${name}" not found in page "${this.currentPageKey}"\nFile: ${fp}`);
  }

  getLocator(name: string): Locator {
    if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
    const [kind, expr] = this.resolveTarget(name);
    const p = this.page;
    if (kind.toLowerCase() === 'xpath') {
      return p.locator(`xpath=${expr}`);
    }
    return p.locator(expr);
  }

  /**
   * Locator inside the first iframe (matches legacy WebdriverIO switchToFrame flows).
   * Prefer explicit iframe locators in YAML when multiple frames exist.
   */
  getLocatorInFirstFrame(name: string): Locator {
    if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
    const [kind, expr] = this.resolveTarget(name);
    const fl = this.page.frameLocator('iframe').first();
    if (kind.toLowerCase() === 'xpath') {
      return fl.locator(`xpath=${expr}`);
    }
    return fl.locator(expr);
  }
}

setWorldConstructor(AutomationWorld);

