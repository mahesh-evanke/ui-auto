/**
 * Reconstructs the actual Playwright locator a [kind, value, xpathFallback]
 * tuple describes. Plain strings only, no embedded JSON - kind carries the
 * strategy (with the ARIA role folded into it for role:<ariaRole>, so "role"
 * never appears twice), value is the plain accessible name/label/text/etc.
 * An XPath fallback (tuple[2]) is OR'd in for resilience if the semantic
 * match ever breaks.
 *
 * Same format used across every branch of this toolkit - locator YAML
 * authored for the BDD/WDIO branches works here unmodified.
 */
import type { Frame, FrameLocator, Locator, Page } from 'playwright';

export type LocatorTuple = [string, string] | [string, string, string];

const SEMANTIC_KINDS = new Set(['label', 'placeholder', 'text', 'testid', 'alttext', 'title']);

export function buildLocatorFromTuple(scope: Page | Frame | FrameLocator, tuple: LocatorTuple): Locator {
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
  // equivalent. id/name/tagName/className are all just CSS under the hood;
  // linkText/buttonText use getByRole with an exact accessible-name match.
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
  // as the attribute name (e.g. kind="data-testid" -> [data-testid="value"]).
  return scope.locator(`[${kind}="${expr}"]`);
}
