/**
 * Builds stable locators for a recorder using Playwright semantic strategies.
 * The YAML contract stores the semantic strategy (role/label/placeholder/text/
 * testId/altText/title) plus an XPath fallback for defense-in-depth, so a
 * getByRole('button', {name:'Submit'}) match actually gets replayed as
 * getByRole at runtime instead of degrading to XPath.
 */
import type { Locator, Page } from 'playwright';

export const MARK_ATTR = 'data-pw-rec-id';

export type ElementSnapshot = {
  tagName: string;
  type?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  placeholder?: string;
  label?: string;
  text?: string;
  href?: string;
  role?: string;
  value?: string;
  selectedLabel?: string;
  /** alt attribute — img/area elements (getByAltText). */
  alt?: string;
  /** title attribute (getByTitle). */
  title?: string;
  /** data-testid attribute value (getByTestId). */
  testId?: string;
  /** True when the clicked element is an option inside a custom dropdown/listbox. */
  isOption?: boolean;
  /** True when the clicked element opens a custom dropdown (combobox/listbox trigger). */
  isDropdownTrigger?: boolean;
};

export type LocatorStrategy =
  | 'getByTestId'
  | 'getByRole'
  | 'getByLabel'
  | 'getByPlaceholder'
  | 'getByAltText'
  | 'getByTitle'
  | 'getByText'
  | 'xpath';

export type ResolvedLocator = {
  name: string;
  strategy: LocatorStrategy;
  /** Human readable kind used internally (e.g. 'button', 'textbox', ...) */
  locator: string;
  options: Record<string, unknown>;
  /** Last-resort fallback if the semantic strategy above ever stops matching. */
  fallback: ['xpath', string];
};

/**
 * On-disk/runtime locator tuple: [kind, value, xpathFallback?]. No embedded
 * JSON - kind and value are both plain strings, same simplicity as the
 * existing WDIO-style entries (id/name/tagName/linkText/...).
 *  - kind === 'xpath' | 'css'   -> value is a raw XPath/CSS string, no fallback needed.
 *  - kind === 'role:<ariaRole>' -> value is the accessible name (e.g. 'role:button' / 'Sign In').
 *    The ARIA role (button/link/checkbox/...) lives in the kind itself so
 *    "role" never appears twice - once as the strategy, once inside the value.
 *  - kind === 'label'           -> value is the label text
 *  - kind === 'placeholder'     -> value is the placeholder text
 *  - kind === 'text'            -> value is the visible text
 *  - kind === 'testid'          -> value is the data-testid value
 *  - kind === 'alttext'         -> value is the alt text
 *  - kind === 'title'           -> value is the title attribute text
 *  - anything else (e.g. WDIO id/name/tagName/className/linkText/buttonText,
 *    or a custom attribute name) -> handled by world.ts's buildLocatorFromTuple.
 * The optional 3rd element is an XPath fallback tried if the semantic locator
 * above ever fails to match (defense-in-depth, same idea as `.or()` chaining).
 * Matching is always exact - no separate exact/fuzzy flag to keep this simple.
 */
export type LocatorTuple = [string, string] | [string, string, string];

/**
 * Converts a resolved locator into the tuple actually persisted to YAML. This
 * is what closes the "computed the semantic strategy, then threw it away"
 * gap: every caller used to persist only `resolved.fallback` (XPath), so even
 * a uniquely-matched getByRole('button', {name}) got replayed as XPath at
 * runtime. Now the semantic strategy + value travel to disk, with the XPath
 * fallback kept alongside for resilience if the semantic match ever breaks.
 */
export function toPersistedTuple(resolved: ResolvedLocator): LocatorTuple {
  const fallbackXPath = resolved.fallback[1];

  switch (resolved.strategy) {
    case 'getByTestId':
      return ['testid', String(resolved.options.testId), fallbackXPath];
    case 'getByRole':
      // ARIA role folds into the kind itself (role:button, role:link, ...) so
      // the value is just the plain accessible name - no nested "role" key.
      return [`role:${resolved.locator}`, String(resolved.options.name ?? ''), fallbackXPath];
    case 'getByLabel':
      return ['label', String(resolved.options.label), fallbackXPath];
    case 'getByPlaceholder':
      return ['placeholder', String(resolved.options.placeholder), fallbackXPath];
    case 'getByAltText':
      return ['alttext', String(resolved.options.altText), fallbackXPath];
    case 'getByTitle':
      return ['title', String(resolved.options.title), fallbackXPath];
    case 'getByText':
      return ['text', String(resolved.options.text), fallbackXPath];
    default:
      return ['xpath', fallbackXPath];
  }
}

function normalizeVisibleText(raw: string): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function xpathLiteral(s: string): string {
  const str = String(s ?? '');
  if (!str.includes("'")) return `'${str}'`;
  if (!str.includes('"')) return `"${str}"`;
  // If string contains both quote types, use concat("part1", "'", "part2")
  const parts = str.split("'");
  const quoteSingle = `"'"`; // XPath literal for the single quote character
  return `concat(${parts.map((p) => `"${p}"`).join(', ' + quoteSingle + ', ')})`;
}

function normalizeElementName(raw: string): string {
  const s = normalizeVisibleText(raw);
  if (!s) return '';
  const tokens = s.split(' ').filter(Boolean);
  const out = tokens
    .map((t) => {
      if (!t) return t;
      if (/^[A-Z0-9_]+$/.test(t) && t.length > 1) return t; // keep acronyms
      if (/^[a-z]+$/i.test(t)) return t[0].toUpperCase() + t.slice(1).toLowerCase();
      return t;
    })
    .join(' ');
  return out;
}

export function deriveElementName(snapshot: ElementSnapshot): string {
  return normalizeElementName(
    snapshot.label ||
      snapshot.ariaLabel ||
      snapshot.placeholder ||
      snapshot.text ||
      snapshot.alt ||
      snapshot.title ||
      snapshot.id ||
      snapshot.name ||
      snapshot.tagName ||
      'Element',
  );
}

async function absoluteXPathFromLocatorFirst(loc: Locator): Promise<string> {
  return loc.evaluate((el: Element) => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let index = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.nodeType === 1 && (sib as Element).tagName === node.tagName) index++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      node = node.parentElement;
    }
    return '/html/' + parts.join('/');
  });
}

function buildFallbackXPathCandidates(snapshot: ElementSnapshot): string[] {
  const tag = (snapshot.tagName || '').toLowerCase();
  const id = (snapshot.id || '').trim();
  const name = (snapshot.name || '').trim();
  const placeholder = (snapshot.placeholder || '').trim();
  const aria = (snapshot.ariaLabel || '').trim();
  const label = (snapshot.label || '').trim();
  const text = normalizeVisibleText(snapshot.text || '');
  const typeAttr = (snapshot.type || '').toLowerCase();
  const href = (snapshot.href || '').trim();

  const testId = (snapshot.testId || '').trim();
  const alt = (snapshot.alt || '').trim();
  const title = (snapshot.title || '').trim();

  const candidates: string[] = [];

  // data-testid is an explicit developer hook - most stable candidate available,
  // tried before id (which can be framework-generated and change across builds).
  if (testId) candidates.push(`//*[@data-testid=${xpathLiteral(testId)}]`);
  if (id) candidates.push(`//*[@id=${xpathLiteral(id)}]`);
  if (aria) candidates.push(`//*[@aria-label=${xpathLiteral(aria)}]`);
  if (alt && (tag === 'img' || tag === 'area')) candidates.push(`//${tag}[@alt=${xpathLiteral(alt)}]`);
  if (title) candidates.push(`//*[@title=${xpathLiteral(title)}]`);
  if (placeholder && (tag === 'input' || tag === 'textarea')) candidates.push(`//${tag}[@placeholder=${xpathLiteral(placeholder)}]`);
  if (name && (tag === 'input' || tag === 'textarea' || tag === 'select')) candidates.push(`//${tag}[@name=${xpathLiteral(name)}]`);
  if (tag === 'select' && snapshot.name) candidates.push(`//select[@name=${xpathLiteral(snapshot.name)}]`);

  if (tag === 'a' || tag === 'button') {
    // 1. Specific-tag text match (most precise)
    if (text) candidates.push(`//${tag}[normalize-space(.)=${xpathLiteral(text)}]`);

    // 2. Href-based match for links (stable: survives text re-wording)
    if (tag === 'a' && href) {
      try {
        const pathPart = new URL(href).pathname;
        if (pathPart && pathPart !== '/') candidates.push(`//a[contains(@href,${xpathLiteral(pathPart)})]`);
      } catch {
        if (!href.startsWith('http') && href.length < 100) candidates.push(`//a[@href=${xpathLiteral(href)}]`);
      }
    }

    // 3. Tag-agnostic text match — handles navigation items that switch between <button> and <a>
    //    depending on which page is loaded (e.g. top-nav vs sidebar).
    if (text) {
      const otherTag = tag === 'button' ? 'a' : 'button';
      candidates.push(`//*[normalize-space(.)=${xpathLiteral(text)} and (self::${tag} or self::${otherTag})]`);
    }
  }

  // input[type=button|submit]
  if (tag === 'input' && (typeAttr === 'submit' || typeAttr === 'button')) {
    const valueAsText = normalizeVisibleText(snapshot.value || snapshot.text || '');
    if (valueAsText) {
      candidates.push(
        `//input[@type=${xpathLiteral(typeAttr)} and normalize-space(@value)=${xpathLiteral(valueAsText)}]`,
      );
    }
  }

  // As a last resort, if label exists, try aria-label-ish mapping for some HTML patterns:
  if (!aria && label) candidates.push(`//*[@aria-label=${xpathLiteral(label)}]`);

  // Avoid empty candidates
  return candidates.filter(Boolean);
}

async function uniqueXPathOrNull(page: Page, expr: string): Promise<string | null> {
  try {
    const n = await page.locator(`xpath=${expr}`).count();
    if (n === 1) return expr;
    return null;
  } catch {
    return null;
  }
}

async function resolveFallbackXPath(page: Page, markId: string, snapshot: ElementSnapshot): Promise<string> {
  const candidates = buildFallbackXPathCandidates(snapshot);

  // Pass 1: prefer a uniquely-matching XPath (most stable).
  for (const expr of candidates) {
    const ok = await uniqueXPathOrNull(page, expr);
    if (ok) return ok;
  }

  // Pass 2: use an indexed selector for any candidate with at least one match.
  // This is far more stable than an absolute body-path XPath because it stays
  // anchored to a meaningful attribute (text, href, id) even if the DOM restructures.
  for (const expr of candidates) {
    try {
      const n = await page.locator(`xpath=${expr}`).count();
      if (n > 0) return `(${expr})[1]`;
    } catch {
      // ignore unparseable expressions
    }
  }

  // Pass 3: absolute XPath — last resort only (fragile, breaks on DOM changes).
  const marked = page.locator(`[${MARK_ATTR}="${markId}"]`).first();
  return absoluteXPathFromLocatorFirst(marked);
}

function semanticNameCandidates(snapshot: ElementSnapshot, derivedName: string): string[] {
  const candidates: string[] = [];
  const push = (s?: string) => {
    const v = normalizeVisibleText(s || '');
    if (v) candidates.push(v);
  };
  push(snapshot.label);
  push(snapshot.ariaLabel);
  push(snapshot.placeholder);
  push(derivedName);
  push(snapshot.text);
  push(snapshot.id);
  return [...new Set(candidates)].slice(0, 5);
}

async function tryUniqueStrategy(
  page: Page,
  build: () => Locator,
): Promise<boolean> {
  try {
    return (await build().count()) === 1;
  } catch {
    return false;
  }
}

export async function resolveLocator(page: Page, markId: string, snapshot: ElementSnapshot): Promise<ResolvedLocator> {
  const derivedName = deriveElementName(snapshot);
  const candidates = semanticNameCandidates(snapshot, derivedName);
  const tag = (snapshot.tagName || '').toLowerCase();
  const role = (snapshot.role || '').toLowerCase();
  const typeAttr = (snapshot.type || '').toLowerCase();

  // Priority 0: getByTestId — an explicit, developer-intentional hook (data-testid),
  // more stable than any inferred name/role match. Playwright's own docs list it
  // as the most resilient option when present.
  if (snapshot.testId) {
    const tid = snapshot.testId.trim();
    if (tid) {
      const ok = await tryUniqueStrategy(page, () => page.getByTestId(tid));
      if (ok) {
        const fallback = await resolveFallbackXPath(page, markId, snapshot);
        return { name: derivedName, strategy: 'getByTestId', locator: 'testId', options: { testId: tid }, fallback: ['xpath', fallback] };
      }
    }
  }

  const tryGetByRole = async (roleToTry: string): Promise<{ name: string; locator: string; options: Record<string, unknown> } | null> => {
    for (const c of candidates) {
      const ok = await tryUniqueStrategy(page, () => page.getByRole(roleToTry as any, { name: c, exact: true } as any));
      if (ok) return { name: c, locator: roleToTry, options: { name: c, exact: true } };
    }
    // Fuzzy (non-exact) retry — mirrors getByLabel's fallback below. Accessible
    // names captured with minor whitespace/casing drift would otherwise skip a
    // valid role match entirely and fall through to weaker strategies.
    for (const c of candidates) {
      const ok = await tryUniqueStrategy(page, () => page.getByRole(roleToTry as any, { name: c } as any));
      if (ok) return { name: c, locator: roleToTry, options: { name: c } };
    }
    return null;
  };

  // Priority 1: getByRole — expanded beyond link/button/textbox/combobox to cover
  // the other roles Playwright codegen itself would emit.
  //
  // An explicit role attribute always wins over tag-based guessing - that's
  // what ARIA role overriding means (e.g. Docusaurus sidebar categories render
  // as <a role="button">Guides</a>: tag says "link", but the accessible role
  // computed by the browser - and by Playwright's getByRole() - is "button".
  // Checking tag first here meant getByRole('link', ...) was tried, found 0
  // matches, and the element fell all the way through to getByText instead of
  // the correct getByRole('button', ...), which would have matched uniquely.
  const KNOWN_ROLES = new Set(['link', 'button', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem', 'heading', 'img', 'textbox']);
  const roleToTry =
    role && KNOWN_ROLES.has(role) ? role :
    tag === 'a' ? 'link' :
    tag === 'button' || (tag === 'input' && ['button', 'submit'].includes(typeAttr)) ? 'button' :
    tag === 'input' && typeAttr === 'checkbox' ? 'checkbox' :
    tag === 'input' && typeAttr === 'radio' ? 'radio' :
    tag === 'input' || tag === 'textarea' ? 'textbox' :
    tag === 'select' ? 'combobox' :
    /^h[1-6]$/.test(tag) ? 'heading' :
    tag === 'img' ? 'img' :
    role || null;
  if (roleToTry) {
    const hit = await tryGetByRole(roleToTry);
    if (hit) {
      const fallback = await resolveFallbackXPath(page, markId, snapshot);
      return { name: derivedName, strategy: 'getByRole', locator: hit.locator, options: hit.options, fallback: ['xpath', fallback] };
    }
  }

  // Priority 2: getByLabel
  const labelCandidates = [...new Set([snapshot.label, snapshot.ariaLabel].map((x) => normalizeVisibleText(x || '')).filter(Boolean))].slice(0, 3);
  for (const c of labelCandidates) {
    const ok = await tryUniqueStrategy(page, () => page.getByLabel(c, { exact: true }));
    if (ok) {
      const fallback = await resolveFallbackXPath(page, markId, snapshot);
      return { name: derivedName, strategy: 'getByLabel', locator: 'label', options: { label: c, exact: true }, fallback: ['xpath', fallback] };
    }
    const fuzzyOk = await tryUniqueStrategy(page, () => page.getByLabel(c));
    if (fuzzyOk) {
      const fallback = await resolveFallbackXPath(page, markId, snapshot);
      return { name: derivedName, strategy: 'getByLabel', locator: 'label', options: { label: c }, fallback: ['xpath', fallback] };
    }
  }

  // Priority 3: getByPlaceholder
  if (snapshot.placeholder) {
    const ph = normalizeVisibleText(snapshot.placeholder);
    if (ph) {
      const ok = await tryUniqueStrategy(page, () => page.getByPlaceholder(ph, { exact: true }));
      if (ok) {
        const fallback = await resolveFallbackXPath(page, markId, snapshot);
        return { name: derivedName, strategy: 'getByPlaceholder', locator: 'placeholder', options: { placeholder: ph, exact: true }, fallback: ['xpath', fallback] };
      }
    }
  }

  // Priority 4: getByAltText — img/area elements identified by alt text.
  if (snapshot.alt && (tag === 'img' || tag === 'area')) {
    const alt = normalizeVisibleText(snapshot.alt);
    if (alt) {
      const ok = await tryUniqueStrategy(page, () => page.getByAltText(alt, { exact: true }));
      if (ok) {
        const fallback = await resolveFallbackXPath(page, markId, snapshot);
        return { name: derivedName, strategy: 'getByAltText', locator: 'altText', options: { altText: alt, exact: true }, fallback: ['xpath', fallback] };
      }
    }
  }

  // Priority 5: getByTitle
  if (snapshot.title) {
    const title = normalizeVisibleText(snapshot.title);
    if (title) {
      const ok = await tryUniqueStrategy(page, () => page.getByTitle(title, { exact: true }));
      if (ok) {
        const fallback = await resolveFallbackXPath(page, markId, snapshot);
        return { name: derivedName, strategy: 'getByTitle', locator: 'title', options: { title, exact: true }, fallback: ['xpath', fallback] };
      }
    }
  }

  // Priority 6: getByText
  if (snapshot.text) {
    const t = normalizeVisibleText(snapshot.text);
    if (t) {
      const ok = await tryUniqueStrategy(page, () => page.getByText(t, { exact: true }));
      if (ok) {
        const fallback = await resolveFallbackXPath(page, markId, snapshot);
        return { name: derivedName, strategy: 'getByText', locator: 'text', options: { text: t, exact: true }, fallback: ['xpath', fallback] };
      }
    }
  }

  // Priority 7: fallback XPath
  const fallback = await resolveFallbackXPath(page, markId, snapshot);
  return { name: derivedName, strategy: 'xpath', locator: 'xpath', options: {}, fallback: ['xpath', fallback] };
}
