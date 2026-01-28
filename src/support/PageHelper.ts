/**
 * SDK-owned page helper.
 *
 * Resolves locators from the consumer project via locatorProvider.
 */
import * as EC from 'wdio-wait-for';
import { getElementLocator } from '../locators/locatorProvider';
import { PageContext } from './PageContext';

type LocatorTuple = [string, string];

function toSelector(locator: LocatorTuple): string {
  const [kind, value] = locator;
  const t = String(kind ?? '').toLowerCase();
  if (t === 'xpath') return value;
  if (t === 'id') return `#${value}`;
  if (t === 'name') return `[name="${value}"]`;
  if (t === 'tagname') return `<${value} />`;
  if (t === 'linktext') return `=${value}`;
  if (t === 'buttontext') return `=${value}`;
  if (t === 'classname') return `.${value}`;
  return `[${kind}="${value}"]`;
}

export class SdkPageHelper {
  static async locator(elementName: string, common: boolean): Promise<LocatorTuple> {
    const raw = getElementLocator(elementName, {
      common,
      pageName: PageContext.getCurrentPage(),
    });
    if (!raw) throw new Error(`Element with name '${elementName}' not found in JSON`);
    return raw;
  }

  static async selector(elementName: string, common: boolean): Promise<string> {
    const loc = await this.locator(elementName, common);
    return toSelector(loc);
  }

  static async findElement(
    elementName: string,
    common: boolean,
    waitFormat: string = 'non'
  ): Promise<WebdriverIO.Element> {
    const selector = await this.selector(elementName, common);
    if (waitFormat.toLowerCase().includes('click')) {
      await browser.waitUntil(EC.elementToBeClickable(selector), {
        timeout: 20000,
        timeoutMsg: 'time out when wait to clickable: SdkPageHelper',
      });
    }
    return (await $(selector)) as unknown as WebdriverIO.Element;
  }
}
