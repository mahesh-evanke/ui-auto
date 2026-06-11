/**
 * specParser.ts
 * Parses a Playwright-codegen *.spec.ts file → RecordedAction[]
 * so it can be fed directly into the existing converter.ts pipeline.
 */
import type { RecordedAction } from './converter';

export type ParsedSpec = {
  actions:       RecordedAction[];
  scenarioTitle: string;
  firstUrl:      string;
};

// ── XPath helpers ─────────────────────────────────────────────────────────────

/** Wrap a string in an XPath literal (handles embedded quotes). */
function xlit(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  // Both quote types: use XPath concat()
  return `concat(${s.split("'").map(p => `"${p}"`).join(`,"'",`)})`;
}

function xpathByRole(role: string, name: string): string {
  switch (role) {
    case 'button':   return `//button[normalize-space(.)=${xlit(name)}]`;
    case 'link':     return `//a[normalize-space(.)=${xlit(name)}]`;
    case 'textbox':  return `//*[self::input or self::textarea][@aria-label=${xlit(name)} or @placeholder=${xlit(name)} or @id=//label[normalize-space(.)=${xlit(name)}]/@for]`;
    case 'checkbox': return `//input[@type='checkbox' and (@aria-label=${xlit(name)} or @id=//label[normalize-space(.)=${xlit(name)}]/@for)]`;
    case 'radio':    return `//input[@type='radio' and (@aria-label=${xlit(name)} or @id=//label[normalize-space(.)=${xlit(name)}]/@for)]`;
    case 'combobox': return `//select[@aria-label=${xlit(name)} or @name=${xlit(name)}]`;
    default:         return `//*[@role=${xlit(role)} and (normalize-space(.)=${xlit(name)} or @aria-label=${xlit(name)})]`;
  }
}

function xpathByLabel(label: string): string {
  return `//*[self::input or self::textarea or self::select][@id=//label[normalize-space(.)=${xlit(label)}]/@for or @aria-label=${xlit(label)}]`;
}

function xpathByPlaceholder(ph: string): string {
  return `//input[@placeholder=${xlit(ph)}]`;
}

function xpathByText(text: string): string {
  return `//*[normalize-space(.)=${xlit(text)}]`;
}

function xpathBySelector(sel: string): string {
  // #id
  const idHash = sel.match(/^#([a-zA-Z0-9_-]+)$/);
  if (idHash) return `//*[@id=${xlit(idHash[1])}]`;

  // [name="x"] or input[name="x"]
  const nameAttr = sel.match(/\[name=['"]([^'"]+)['"]\]/);
  if (nameAttr) {
    const tag = sel.split('[')[0].trim() || '*';
    return `//${tag}[@name=${xlit(nameAttr[1])}]`;
  }

  // [id="x"]
  const idAttr = sel.match(/\[id=['"]([^'"]+)['"]\]/);
  if (idAttr) return `//*[@id=${xlit(idAttr[1])}]`;

  // input[type="x"]
  const typeAttr = sel.match(/^input\[type=['"]([^'"]+)['"]\]$/);
  if (typeAttr) return `//input[@type=${xlit(typeAttr[1])}]`;

  // Already looks like XPath
  if (sel.startsWith('/') || sel.startsWith('(')) return sel;

  // .className → contains(@class)
  const clsName = sel.match(/^\.([a-zA-Z0-9_-]+)$/);
  if (clsName) return `//*[contains(@class,${xlit(clsName[1])})]`;

  return `//*[@id=${xlit(sel)} or normalize-space(.)=${xlit(sel)}]`;
}

/** Derive a readable name from a CSS selector string. */
function nameFromSelector(sel: string): string {
  const nameAttr = sel.match(/\[name=['"]([^'"]+)['"]\]/);
  if (nameAttr) return nameAttr[1];
  const idHash = sel.match(/#([a-zA-Z0-9_-]+)/);
  if (idHash) return idHash[1];
  const idAttr = sel.match(/\[id=['"]([^'"]+)['"]\]/);
  if (idAttr) return idAttr[1];
  return sel.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || 'Element';
}

// ── Line-level parser ─────────────────────────────────────────────────────────

interface LineResult {
  action:   RecordedAction | null;
  navigate: string | null;
}

function parseLine(raw: string, currentHref: string): LineResult {
  const t = raw.trim();
  const none: LineResult = { action: null, navigate: null };

  // Only process awaited Playwright calls
  if (!t.startsWith('await ')) return none;

  // ── Navigation ──────────────────────────────────────────────────────────────
  const gotoM = t.match(/await page\.goto\(['"`]([^'"`]+)['"`]/);
  if (gotoM) return { action: null, navigate: gotoM[1] };

  // page.waitForURL() — codegen adds this after clicks that trigger SPA navigation
  const waitUrlM = t.match(/await page\.waitForURL\(['"`]([^'"`]+)['"`]/);
  if (waitUrlM) return { action: null, navigate: waitUrlM[1] };

  // await expect(page).toHaveURL('url') — another codegen pattern for navigation
  const expectUrlM = t.match(/await expect\(page\)\.toHaveURL\(['"`]([^'"`]+)['"`]/);
  if (expectUrlM) return { action: null, navigate: expectUrlM[1] };

  // ── Assertions ──────────────────────────────────────────────────────────────

  // expect(page.getByText('X')).toBeVisible()
  const assertTextM = t.match(/await expect\(page\.getByText\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*\})?\)\)\.toBeVisible\(\)/);
  if (assertTextM) return {
    navigate: null,
    action: { type: 'assert_text', element: assertTextM[1], value: assertTextM[1], controlKind: 'button', href: currentHref, locator: ['xpath', ''] }
  };

  // expect(page.getByRole('...', { name: 'X' })).toBeVisible()
  const assertRoleM = t.match(/await expect\(page\.getByRole\(['"`][^'"`]+['"`],\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`][^}]*\}\)\)\.toBeVisible\(\)/);
  if (assertRoleM) return {
    navigate: null,
    action: { type: 'assert_text', element: assertRoleM[1], value: assertRoleM[1], controlKind: 'button', href: currentHref, locator: ['xpath', ''] }
  };

  // expect(page.locator('...')).toBeVisible()
  const assertLocM = t.match(/await expect\(page\.locator\(['"`]([^'"`]+)['"`]\)\)\.toBeVisible\(\)/);
  if (assertLocM) return {
    navigate: null,
    action: { type: 'assert_text', element: nameFromSelector(assertLocM[1]), value: nameFromSelector(assertLocM[1]), controlKind: 'button', href: currentHref, locator: ['xpath', ''] }
  };

  // ── Extract method chain ─────────────────────────────────────────────────────
  // action   = last method call  e.g. .click() / .fill('v') / .check() / .selectOption('v')
  // locator  = everything after  page.  up to the last chained call

  const fillM       = t.match(/\.fill\(['"`]([^'"`]*?)['"`]\)\s*;?\s*$/);
  const selectOptM  = t.match(/\.selectOption\(['"`]([^'"`]+)['"`](?:,\s*['"`][^'"`]*['"`])?\)\s*;?\s*$/);
  const isClick     = /\.click\(\)\s*;?\s*$/.test(t);
  const isCheck     = /\.check\(\)\s*;?\s*$/.test(t);
  const isUncheck   = /\.uncheck\(\)\s*;?\s*$/.test(t);

  // ── getByRole ──────────────────────────────────────────────────────────────
  const roleM = t.match(/await page\.getByRole\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`][^}]*\})?\)/);
  if (roleM) {
    const role = roleM[1];
    const name = roleM[2] || role;

    if (isClick) {
      if (role === 'link')                            return { navigate: null, action: { type: 'click',    element: name, controlKind: 'link',     href: currentHref, locator: ['xpath', xpathByRole('link', name)] } };
      if (role === 'radio')                           return { navigate: null, action: { type: 'radio',    element: name, controlKind: 'radio',    href: currentHref, locator: ['xpath', xpathByRole('radio', name)] } };
      if (role === 'checkbox')                        return { navigate: null, action: { type: 'checkbox', element: name, controlKind: 'checkbox', href: currentHref, locator: ['xpath', xpathByRole('checkbox', name)] } };
      if (role === 'textbox' || role === 'searchbox') return { navigate: null, action: { type: 'click',    element: name, controlKind: 'textbox',  href: currentHref, locator: ['xpath', xpathByRole(role, name)] } };
      if (role === 'combobox')                        return { navigate: null, action: { type: 'click',    element: name, controlKind: 'select',   href: currentHref, locator: ['xpath', xpathByRole(role, name)] } };
      return { navigate: null, action: { type: 'click', element: name, controlKind: 'button', href: currentHref, locator: ['xpath', xpathByRole(role, name)] } };
    }
    if (isCheck || isUncheck) return { navigate: null, action: { type: 'checkbox', element: name, controlKind: 'checkbox', href: currentHref, locator: ['xpath', xpathByRole('checkbox', name)] } };
    if (fillM)     return { navigate: null, action: { type: 'input',  element: name, value: fillM[1],    controlKind: 'textbox', href: currentHref, locator: ['xpath', xpathByRole(role, name)] } };
    if (selectOptM) return { navigate: null, action: { type: 'select', element: name, value: selectOptM[1], controlKind: 'select',  href: currentHref, locator: ['xpath', xpathByRole('combobox', name)] } };
  }

  // ── getByLabel ────────────────────────────────────────────────────────────
  const labelM = t.match(/await page\.getByLabel\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*\})?\)/);
  if (labelM) {
    const label = labelM[1];
    if (isClick)    return { navigate: null, action: { type: 'click',    element: label,                 controlKind: 'textbox',  href: currentHref, locator: ['xpath', xpathByLabel(label)] } };
    if (isCheck)    return { navigate: null, action: { type: 'checkbox', element: label,                 controlKind: 'checkbox', href: currentHref, locator: ['xpath', xpathByLabel(label)] } };
    if (fillM)      return { navigate: null, action: { type: 'input',    element: label, value: fillM[1], controlKind: 'textbox',  href: currentHref, locator: ['xpath', xpathByLabel(label)] } };
    if (selectOptM) return { navigate: null, action: { type: 'select',   element: label, value: selectOptM[1], controlKind: 'select', href: currentHref, locator: ['xpath', xpathByLabel(label)] } };
  }

  // ── getByPlaceholder ──────────────────────────────────────────────────────
  const phM = t.match(/await page\.getByPlaceholder\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*\})?\)/);
  if (phM) {
    const ph = phM[1];
    if (isClick) return { navigate: null, action: { type: 'click', element: ph, controlKind: 'textbox', href: currentHref, locator: ['xpath', xpathByPlaceholder(ph)] } };
    if (fillM)   return { navigate: null, action: { type: 'input', element: ph, value: fillM[1], controlKind: 'textbox', href: currentHref, locator: ['xpath', xpathByPlaceholder(ph)] } };
  }

  // ── getByText ─────────────────────────────────────────────────────────────
  const textM = t.match(/await page\.getByText\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*\})?\)/);
  if (textM) {
    const txt = textM[1];
    if (isClick) return { navigate: null, action: { type: 'click', element: txt, controlKind: 'link', href: currentHref, locator: ['xpath', xpathByText(txt)] } };
  }

  // ── page.locator('selector') ───────────────────────────────────────────────
  const locM = t.match(/await page\.locator\(['"`]([^'"`]+)['"`]\)/);
  if (locM) {
    const sel  = locM[1];
    const name = nameFromSelector(sel);
    const xpath = xpathBySelector(sel);
    if (isClick)    return { navigate: null, action: { type: 'click',    element: name,              controlKind: 'button',   href: currentHref, locator: ['xpath', xpath] } };
    if (isCheck)    return { navigate: null, action: { type: 'checkbox', element: name,              controlKind: 'checkbox', href: currentHref, locator: ['xpath', xpath] } };
    if (fillM)      return { navigate: null, action: { type: 'input',    element: name, value: fillM[1], controlKind: 'textbox', href: currentHref, locator: ['xpath', xpath] } };
    if (selectOptM) return { navigate: null, action: { type: 'select',   element: name, value: selectOptM[1], controlKind: 'select', href: currentHref, locator: ['xpath', xpath] } };
  }

  // ── page.selectOption('selector', 'value') ────────────────────────────────
  const pageSelM = t.match(/await page\.selectOption\(['"`]([^'"`]+)['"`],\s*['"`]([^'"`]+)['"`]\)/);
  if (pageSelM) {
    const sel  = pageSelM[1];
    const val  = pageSelM[2];
    return { navigate: null, action: { type: 'select', element: nameFromSelector(sel), value: val, controlKind: 'select', href: currentHref, locator: ['xpath', xpathBySelector(sel)] } };
  }

  return none;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parsePlaywrightSpec(content: string): ParsedSpec {
  const actions: RecordedAction[] = [];
  let firstUrl      = '';
  let currentHref   = '';
  let scenarioTitle = 'User flow';

  // Pull test name for scenario title  e.g.  test('my login flow', ...)
  const titleM = content.match(/test\(['"`]([^'"`]+)['"`]/);
  if (titleM && titleM[1] !== 'test') scenarioTitle = titleM[1];

  for (const line of content.split('\n')) {
    const { action, navigate } = parseLine(line, currentHref);

    if (navigate) {
      currentHref = navigate;
      if (!firstUrl) firstUrl = navigate;
      continue;
    }

    if (action) actions.push(action);
  }

  return { actions, scenarioTitle, firstUrl };
}
