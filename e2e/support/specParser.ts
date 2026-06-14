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
    case 'option':   return `//*[@role='option' and normalize-space(.)=${xlit(name)}] | //li[normalize-space(.)=${xlit(name)}] | //option[normalize-space(.)=${xlit(name)}]`;
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

  // [data-testid="x"] / [data-test="x"] / [data-cy="x"] etc.
  const dataAttr = sel.match(/^([a-zA-Z*]*)?\[data-([a-z-]+)=['"]([^'"]+)['"]\]$/);
  if (dataAttr) {
    const tag = dataAttr[1] || '*';
    return `//${tag}[@data-${dataAttr[2]}=${xlit(dataAttr[3])}]`;
  }

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
  // data-* attributes e.g. [data-test="submit-btn"] → "submit-btn"
  const dataAttr = sel.match(/\[data-[a-z-]+=['"]([^'"]+)['"]\]/);
  if (dataAttr) return dataAttr[1];
  return sel.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || 'Element';
}

/**
 * Matches a single quoted-string argument allowing the OTHER quote char inside.
 * e.g. '[data-test="x"]' (single-quoted, contains "), "it's here" (double-quoted, contains ').
 * Returns three capture groups (single|double|backtick) — pick whichever matched.
 */
const QUOTED = `(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`)`;

/** Pull the matched quoted value from a RegExpMatchArray given the first group index. */
function pickQuoted(m: RegExpMatchArray, i: number): string {
  return m[i] ?? m[i + 1] ?? m[i + 2] ?? '';
}

// ── Line-level parser ─────────────────────────────────────────────────────────

interface LineResult {
  action:   RecordedAction | null;
  navigate: string | null;
}

function parseLine(raw: string, currentHref: string): LineResult {
  let t = raw.trim();
  const none: LineResult = { action: null, navigate: null };

  // Only process awaited Playwright calls
  if (!t.startsWith('await ')) return none;

  // ── Normalize frame / page-variable prefixes ────────────────────────────────
  // Codegen records actions inside iframes or secondary tabs/popups as:
  //   page1.locator('iframe[...]').contentFrame().getByLabel('x').selectOption('y')
  //   page.frameLocator('iframe').getByRole('button', { name: 'x' }).click()
  //   popup.getByText('x').click()
  // Strip the frame navigation and normalize the root variable to "page" so the
  // element matchers below work uniformly. (The element still resolves at runtime
  // via the generated xpath; frame scoping is handled by the step definitions.)
  t = t.replace(/\.locator\((?:'[^']*'|"[^"]*"|`[^`]*`)\)\.contentFrame\(\)/g, '');
  t = t.replace(/\.frameLocator\((?:'[^']*'|"[^"]*"|`[^`]*`)\)/g, '');
  t = t.replace(/\.contentFrame\(\)/g, '');
  // Normalize root variable (page1, page2, popup, frame, etc.) → page
  t = t.replace(/^await\s+[A-Za-z_$][\w$]*\.(?=getBy|locator|goto|waitForURL|selectOption)/, 'await page.');

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

  // ── Verify TEXT patterns (Inspector "Assert text" button) ──────────────────
  // expect(page.getByText('X')).toBeVisible()
  const assertTextM = t.match(/await expect\(page\.getByText\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*\})?\)\)\.toBeVisible\(\)/);
  if (assertTextM) return {
    navigate: null,
    action: { type: 'assert_text', element: assertTextM[1], value: assertTextM[1], controlKind: 'button', href: currentHref, locator: ['xpath', ''] }
  };

  // expect(page.getByRole('...', { name: 'X' })).toBeVisible()  — non-table roles
  const assertRoleM = t.match(/await expect\(page\.getByRole\(['"`](?!table)([^'"`]+)['"`],\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`][^}]*\}\)\)\.toBeVisible\(\)/);
  if (assertRoleM) return {
    navigate: null,
    action: { type: 'assert_text', element: assertRoleM[2], value: assertRoleM[2], controlKind: 'button', href: currentHref, locator: ['xpath', ''] }
  };

  // expect(page.locator('...')).toBeVisible()
  const assertLocM = t.match(/await expect\(page\.locator\(['"`]([^'"`]+)['"`]\)\)\.toBeVisible\(\)/);
  if (assertLocM) return {
    navigate: null,
    action: { type: 'assert_text', element: nameFromSelector(assertLocM[1]), value: nameFromSelector(assertLocM[1]), controlKind: 'button', href: currentHref, locator: ['xpath', ''] }
  };

  // expect(locator).toContainText('X')  — Inspector "Assert text" generates this
  // (?:[^)(]+|\([^)]*\))+ handles nested parens like page.getByRole('heading')
  const containTextM = t.match(/await expect\((?:[^)(]+|\([^)]*\))+\)\.toContainText\(['"`]([^'"`]+)['"`]\)/);
  if (containTextM) return {
    navigate: null,
    action: { type: 'assert_text', element: containTextM[1], value: containTextM[1], controlKind: 'button', href: currentHref, locator: ['xpath', ''] }
  };

  // expect(locator).toHaveText('X')
  const haveTextM = t.match(/await expect\((?:[^)(]+|\([^)]*\))+\)\.toHaveText\(['"`]([^'"`]+)['"`]\)/);
  if (haveTextM) return {
    navigate: null,
    action: { type: 'assert_text', element: haveTextM[1], value: haveTextM[1], controlKind: 'button', href: currentHref, locator: ['xpath', ''] }
  };

  // ── Verify WEB TABLE patterns (Inspector click on table role) ──────────────
  // expect(page.getByRole('table', { name: 'X' })).toBeVisible()
  const assertTableRoleM = t.match(/await expect\(page\.getByRole\(['"`]table['"`],\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`][^}]*\}\)\)\.toBeVisible\(\)/);
  if (assertTableRoleM) return {
    navigate: null,
    action: { type: 'assert_web_table', element: assertTableRoleM[1], value: '', controlKind: 'table', href: currentHref, locator: ['xpath', ''] }
  };

  // expect(page.locator('table')).toBeVisible()  or  expect(page.locator('table#id')).toBeVisible()
  const assertTableLocM = t.match(/await expect\(page\.locator\(['"`]((?:table|[^'"`]*\btable\b)[^'"`]*)['"`]\)\)\.toBeVisible\(\)/);
  if (assertTableLocM) return {
    navigate: null,
    action: { type: 'assert_web_table', element: nameFromSelector(assertTableLocM[1]), value: '', controlKind: 'table', href: currentHref, locator: ['xpath', ''] }
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
  // Skip the role handler when the chain ends with .locator(...) — e.g.
  // page.getByRole('group', { name: '...' }).locator('[data-test="..."]').click()
  // The real target is the inner locator, handled in the page.locator() block below.
  const roleM = t.includes('.locator(')
    ? null
    : t.match(/await page\.getByRole\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`][^}]*\})?\)/);
  if (roleM) {
    const role = roleM[1];
    const name = roleM[2] || role;

    if (isClick) {
      // group/region/main/etc are layout containers — codegen records them when
      // the user clicks near (but not on) a real control; skip to avoid noise
      if (role === 'group' || role === 'region' || role === 'main' || role === 'article' || role === 'section') return none;
      // Custom-dropdown option pick (React/PrimeReact/MUI/Ant render these as
      // role=option/menuitem). Marked fromOption so the main loop can pair it with
      // the preceding trigger click into a single "select X from Y" step.
      if (role === 'option' || role === 'menuitem' || role === 'menuitemradio' || role === 'menuitemcheckbox') {
        return { navigate: null, action: { type: 'select', element: name, value: name, controlKind: 'select', href: currentHref, locator: ['xpath', xpathByRole('option', name)], fromOption: true } };
      }
      if (role === 'link')                            return { navigate: null, action: { type: 'click',    element: name, controlKind: 'link',     href: currentHref, locator: ['xpath', xpathByRole('link', name)] } };
      if (role === 'radio')                           return { navigate: null, action: { type: 'radio',    element: name, controlKind: 'radio',    href: currentHref, locator: ['xpath', xpathByRole('radio', name)] } };
      if (role === 'checkbox')                        return { navigate: null, action: { type: 'checkbox', element: name, controlKind: 'checkbox', href: currentHref, locator: ['xpath', xpathByRole('checkbox', name)] } };
      if (role === 'textbox' || role === 'searchbox') return { navigate: null, action: { type: 'click',    element: name, controlKind: 'textbox',  href: currentHref, locator: ['xpath', xpathByRole(role, name)] } };
      if (role === 'combobox')                        return { navigate: null, action: { type: 'click',    element: name, controlKind: 'select',   href: currentHref, locator: ['xpath', xpathByRole(role, name)] } };
      return { navigate: null, action: { type: 'click', element: name, controlKind: 'button', href: currentHref, locator: ['xpath', xpathByRole(role, name)] } };
    }
    if (isCheck || isUncheck) {
      // .check() works on both radio and checkbox — honor the actual role
      if (role === 'radio') return { navigate: null, action: { type: 'radio', element: name, controlKind: 'radio', href: currentHref, locator: ['xpath', xpathByRole('radio', name)] } };
      return { navigate: null, action: { type: 'checkbox', element: name, controlKind: 'checkbox', href: currentHref, locator: ['xpath', xpathByRole('checkbox', name)] } };
    }
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
  // Grab the LAST .locator(...) before the terminal action so chained calls work:
  //   page.locator('sel').click()
  //   page.getByRole('group', { name }).locator('sel').click()
  // QUOTED handles selectors that embed the other quote char, e.g. '[data-test="x"]'.
  const locM = t.match(new RegExp(`\\.locator\\(${QUOTED}\\)\\s*\\.\\s*(?:click|check|uncheck|fill|selectOption)\\(`));
  if (locM) {
    const sel   = pickQuoted(locM, 1);
    const name  = nameFromSelector(sel);
    const xpath = xpathBySelector(sel);

    if (isClick) {
      // Heuristic: selector targets an input type directly
      if (/input\[type=['"]radio['"]\]/i.test(sel))    return { navigate: null, action: { type: 'radio',    element: name, controlKind: 'radio',    href: currentHref, locator: ['xpath', xpath] } };
      if (/input\[type=['"]checkbox['"]\]/i.test(sel)) return { navigate: null, action: { type: 'checkbox', element: name, controlKind: 'checkbox', href: currentHref, locator: ['xpath', xpath] } };
      // Heuristic: name derived from data-test / id / class contains "radio" or "check"
      if (/radio/i.test(name))    return { navigate: null, action: { type: 'radio',    element: name, controlKind: 'radio',    href: currentHref, locator: ['xpath', xpath] } };
      if (/check/i.test(name))    return { navigate: null, action: { type: 'checkbox', element: name, controlKind: 'checkbox', href: currentHref, locator: ['xpath', xpath] } };
      return { navigate: null, action: { type: 'click', element: name, controlKind: 'button', href: currentHref, locator: ['xpath', xpath] } };
    }
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

    if (!action) continue;

    // ── Custom-dropdown / autocomplete / multiselect pairing ─────────────────
    // Custom dropdowns are recorded as a sequence of clicks:
    //   Dropdown:    [trigger click]  + [option pick]
    //   AutoComplete:[field fill]      + [option pick]
    //   MultiSelect: [trigger click]  + [option pick] + [option pick] ...
    // When we hit an option pick, fold it into the preceding step.
    if (action.fromOption) {
      const prev = actions[actions.length - 1];
      const optValue = String(action.value ?? action.element);

      // MultiSelect: an option pick following an already-built select → append value
      if (prev && prev.type === 'select') {
        const existing = String(prev.value ?? '').trim();
        const parts = existing ? existing.split(',').map((s) => s.trim()) : [];
        if (!parts.includes(optValue)) parts.push(optValue);
        prev.value = parts.join(', ');
        continue;
      }

      // Dropdown (trigger click) or AutoComplete (field fill) → build a select step
      const triggerOk = prev && (prev.type === 'click' || prev.type === 'input') &&
        (prev.controlKind === 'select' || prev.controlKind === 'button' || prev.controlKind === 'textbox');
      if (triggerOk) {
        actions[actions.length - 1] = {
          type: 'select',
          element: prev.element,
          value: optValue,
          controlKind: 'select',
          href: prev.href,
          locator: prev.locator && prev.locator[1] ? prev.locator : action.locator,
        };
        continue;
      }

      // No identifiable trigger — emit a standalone select using the option name.
      delete action.fromOption;
      actions.push(action);
      continue;
    }

    actions.push(action);
  }

  return { actions, scenarioTitle, firstUrl };
}
