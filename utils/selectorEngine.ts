/**
 * Builds stable locators for a recorder using Playwright semantic strategies.
 * The YAML contract stores ONLY fallback XPath.
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
};

export type LocatorStrategy = 'getByRole' | 'getByLabel' | 'getByPlaceholder' | 'getByText' | 'xpath';

export type ResolvedLocator = {
  name: string;
  strategy: LocatorStrategy;
  /** Human readable kind used internally (e.g. 'button', 'textbox', ...) */
  locator: string;
  options: Record<string, unknown>;
  /** YAML stores ONLY this tuple */
  fallback: ['xpath', string];
};

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

  const candidates: string[] = [];

  if (id) candidates.push(`//*[@id=${xpathLiteral(id)}]`);
  if (aria) candidates.push(`//*[@aria-label=${xpathLiteral(aria)}]`);
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

  const tryGetByRole = async (roleToTry: string): Promise<{ name: string; locator: string; options: Record<string, unknown> } | null> => {
    for (const c of candidates) {
      const ok = await tryUniqueStrategy(page, () => page.getByRole(roleToTry as any, { name: c, exact: true } as any));
      if (ok) return { name: c, locator: roleToTry, options: { name: c, exact: true } };
    }
    return null;
  };

  // Priority 1: getByRole
  if (tag === 'a' || role === 'link') {
    const hit = await tryGetByRole('link');
    if (hit) {
      const fallback = await resolveFallbackXPath(page, markId, snapshot);
      return { name: derivedName, strategy: 'getByRole', locator: hit.locator, options: hit.options, fallback: ['xpath', fallback] };
    }
  }
  if (tag === 'button' || role === 'button' || (tag === 'input' && ['button', 'submit'].includes(typeAttr))) {
    const hit = await tryGetByRole('button');
    if (hit) {
      const fallback = await resolveFallbackXPath(page, markId, snapshot);
      return { name: derivedName, strategy: 'getByRole', locator: hit.locator, options: hit.options, fallback: ['xpath', fallback] };
    }
  }
  if (tag === 'input' || tag === 'textarea') {
    const hit = await tryGetByRole('textbox');
    if (hit) {
      const fallback = await resolveFallbackXPath(page, markId, snapshot);
      return { name: derivedName, strategy: 'getByRole', locator: hit.locator, options: hit.options, fallback: ['xpath', fallback] };
    }
  }
  if (tag === 'select' || role === 'combobox') {
    const hit = await tryGetByRole('combobox');
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

  // Priority 4: getByText
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

  // Priority 5: fallback XPath
  const fallback = await resolveFallbackXPath(page, markId, snapshot);
  return { name: derivedName, strategy: 'xpath', locator: 'xpath', options: {}, fallback: ['xpath', fallback] };
}
