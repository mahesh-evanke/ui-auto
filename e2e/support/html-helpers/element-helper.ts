import type { ChainablePromiseElement } from 'webdriverio';
import { WaitHelper } from './wait-helper';
import { PageHelper } from './page-helper';
import { PageConfigHelper } from '../misc-utils/PageHelper';
import * as ExpectedConditions from 'wdio-wait-for';

export type ElementLike = WebdriverIO.Element | ChainablePromiseElement;

export class ElementHelper {

    static async getBrowser() {
        return global.browserName;
    }

    static async actionMouseMove(item: ElementLike) {
        await WaitHelper.getInstance().waitForElementToBeDisplayed(item);
        return await browser.touchAction({
            action: 'moveTo',
            element: item as any
        });
    }

    static async actionMouseDown(item: ElementLike) {
        await WaitHelper.getInstance().waitForElementToBeDisplayed(item);
        return await browser.touchAction({
            action: 'press',
            element: item as any
        });
    }

    static async actionDragAndDrop(source: ElementLike, destination: ElementLike) {
        return await (source as any).dragAndDrop(destination);
    }

    static async actionDoubleClick(optElementOrButton?: ElementLike, optButton?: ElementLike) {
        if (optElementOrButton) {
            return await (optElementOrButton as any).doubleClick();
        }
        if (optButton) {
            return await (optButton as any).doubleClick();
        }
    }

    static async actionClick(optElementOrButton?: ElementLike, optButton?: ElementLike) {
        if (optElementOrButton) {
            return await browser.touchAction({
                action: 'tap',
                element: optElementOrButton as any
            });
        }
        if (optButton) {
            return await browser.touchAction({ action: 'tap', element: optButton } as any);
        }
    }

    static async actionHoverOver(locator: ElementLike) {
        return await browser.touchAction({
            action: 'moveTo',
            element: locator as any
        });
    }

    static async actionHoverOverAndClick(hoverOverLocator: ElementLike, clickLocator: ElementLike) {
        return await browser.touchAction([
            { action: 'moveTo', element: hoverOverLocator as any },
            { action: 'press', element: clickLocator as any },
            'release'
        ]);
    }

    static async hasOption(select: ElementLike, option: string) {
        return await (select as any).$('option=' + option).isDisplayed();
    }

    static async getFocusedElement() {
        return await browser.getActiveElement();
    }

    static async currentSelectedOptionByText(text: string) {
        const selector = `//option[@selected="selected" and normalize-space(.)="${text}"]`;
        return await $(selector);
    }

    static async getSelectedOption(select: ElementLike) {
        return await (select as any).$("option[selected]");
    }

    static async isVisible(locator) {
        return ExpectedConditions.visibilityOf(locator);
    }

    static async isNotVisible(locator) {
        return ExpectedConditions.invisibilityOf(locator);
    }

    static async inDom(locator) {
        return ExpectedConditions.presenceOf(locator);
    }

    static async notInDom(locator) {
        return ExpectedConditions.stalenessOf(locator);
    }

    static async isClickable(locator) {
        return ExpectedConditions.elementToBeClickable(locator);
    }

    static async hasText(locator, text: string) {
        return ExpectedConditions.textToBePresentInElement(locator, text);
    }

    static async titleIs(title: string) {
        return ExpectedConditions.titleIs(title);
    }

    static async hasClass(locator: ElementLike, klass: string) {
        const classes = await (locator as any).getAttribute('class');
        return classes && classes.split(' ').indexOf(klass) !== -1;
    }

    static async hasClassRegex(locator: ElementLike, klass: string) {
        const classAttribute = await (locator as any).getAttribute('class');
        const pattern = new RegExp('(^|\\s)' + klass + '(\\s|$)');
        return pattern.test(classAttribute);
    }

    static async clickwithElementName(targetElement: string) {
        const elementObj: ElementLike = await PageConfigHelper.findElement(targetElement, false);
        return this.click(elementObj);
    }

    static async click(targetElement: ElementLike) {
        await WaitHelper.getInstance().waitForElementToBeClickable(targetElement);
        return (targetElement as any).click();
    }

    static async clickIfPresent(targetElement: ElementLike) {
        const isPresent = await (targetElement as any).isDisplayed();
        if (isPresent) {
            return this.click(targetElement);
        }
        return;
    }

    static async clickUsingJs(targetElement: ElementLike) {
        await WaitHelper.getInstance().waitForElementToBeClickable(targetElement);
        return this.clickUsingJsNoWait(targetElement);
    }

    static async clickUsingJsNoWait(targetElement: ElementLike) {
        return browser.execute('arguments[0].click();', targetElement);
    }

    static async waitForElementToHaveClass(targetElement: ElementLike,
        kClass: string,
        timeout = PageHelper.DEFAULT_TIMEOUT,
        message = '') {
        return WaitHelper.getInstance().waitForElementToResolve(
            () => this.hasClass(targetElement, kClass),
            (result: any) => result, timeout, message);
    }

    static async selectDropdownByIndex(elementt: ElementLike, optionNum: number) {
        if (optionNum) {
            const options = await (elementt as any).$$('<option />');
            const el = await options[optionNum];
            if (el) await el.click();
        }
    }

    static async scrollToElement(elementt: ElementLike) {
       await browser.execute('arguments[0].scrollIntoView();', elementt);
    }

    static async scrollElementToMiddle(elementt: ElementLike) {
        await browser.execute("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", elementt);
     }

    static async getAttributeValue(elem: ElementLike, attribute: string) {
        return (elem as any).getAttribute(attribute)
            .then(function (text: string) {
                return text.trim();
            });
    }

    static async getText(elem: ElementLike) {
        const text = await (elem as any).getText();
        return text.trim();
    }

    static async isElementPresent(webElement: ElementLike): Promise<boolean> {
        return webElement != null && await (webElement as any).isDisplayed();
    }

    static async isElementEnabled(webElement: ElementLike): Promise<boolean> {
        return webElement != null && await (webElement as any).isEnabled();
    }
    static async isElementTextPresent(webElement: ElementLike, attributeType: string, attribute: string): Promise<boolean> {
        if (webElement == null) {
            return false;
        }
        const attributes = await (webElement as any).getAttribute(attributeType);
        return await attributes.indexOf(attribute) !== -1;
    }
    static async countElements(elements: ElementLike[]): Promise<number> {
        return await elements.length;
    }

    static async isAnyElementPresent(webElements: ElementLike[]): Promise<boolean> {
        let presencePromises = webElements.map(element => this.isElementPresent(element));
        let presences: boolean[] = await Promise.all(presencePromises);
        return presences.some(presence => presence === true);
    }

    static async areAllElementPresent(webElements: ElementLike[]): Promise<boolean> {
        let presencePromises = webElements.map(element => this.isElementPresent(element));
        let presences: boolean[] = await Promise.all(presencePromises);
        return presences.every(presence => presence === true);
    }

    static async isElementDisplayed(webElement: ElementLike): Promise<boolean> {
        return webElement != null && await (webElement as any).isDisplayed();
    }

    static async areNElementDisplayed(webElements: ElementLike[], expectedCount: number, exactCount: boolean = false): Promise<boolean> {
        let displayPromises = webElements.map(element => this.isElementDisplayed(element));
        let displays: boolean[] = await Promise.all(displayPromises);
        const visibleElements = displays.filter(display => display === true);
        return exactCount ? visibleElements.length >= expectedCount : visibleElements.length === expectedCount;
    }

    static async areAllElementDisplayed(webElements: ElementLike[]): Promise<boolean> {
        let displayPromises = webElements.map(element => this.isElementDisplayed(element));
        let displays: boolean[] = await Promise.all(displayPromises);
        return displays.every(display => display === true);
    }

    static async isElementSelected(webElement: ElementLike): Promise<boolean> {
        return webElement != null && await (webElement as any).isSelected();
    }

    static async getAttribute(webElement: ElementLike, attributeName: string): Promise<string> {
        return webElement != null && await (webElement as any).getAttribute(attributeName);
    }

    static async clearElement(webElement: ElementLike): Promise<void> {
        await (webElement as any).clearValue();
    }
    //https://stackoverflow.com/questions/39399477/protractor-scroll-into-view-not-working
    static async scrollElementToView(element: ElementLike): Promise<void> {
        await (element as any).scrollIntoView();
    }
    static async getElementText(webElement: ElementLike): Promise<string> {
        return await (webElement as any).getText();
    }
}
