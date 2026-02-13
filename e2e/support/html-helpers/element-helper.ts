import { WaitHelper } from './wait-helper';
import { PageHelper } from './page-helper';
import { PageConfigHelper } from '../misc-utils/PageHelper';
import * as EC from 'wdio-wait-for';

export class ElementHelper {
    private static readonly EC = EC;

    static async getBrowser() {
        return global.browserName;
    }

    static async actionMouseMove(item: WebdriverIO.Element) {
        await WaitHelper.getInstance().waitForElementToBeDisplayed(item);
        return await browser.touchAction({
            action: 'moveTo',
            element: item
        });
    }

    static async actionMouseDown(item: WebdriverIO.Element) {
        await WaitHelper.getInstance().waitForElementToBeDisplayed(item);
        return await browser.touchAction({
            action: 'press',
            element: item
        });
    }

    static async actionDragAndDrop(source: WebdriverIO.Element, destination: WebdriverIO.Element) {
        return await source.dragAndDrop(destination);
    }

    static async actionDoubleClick(optElementOrButton?: WebdriverIO.Element, optButton?: WebdriverIO.Element) {
        if (optElementOrButton) {
            return await optElementOrButton.doubleClick()
        }
        if (optButton) {
            return await optButton.doubleClick()
        }
    }

    static async actionClick(optElementOrButton?: WebdriverIO.Element, optButton?: WebdriverIO.Element) {
        if (optElementOrButton) {
            return await browser.touchAction({
                action: 'tap',
                element: optElementOrButton
            });
        }
        if (optButton) {
            return await browser.touchAction({
                action: 'tap',
                element: optButton
            });
        }
    }

    static async actionHoverOver(locator: WebdriverIO.Element) {
        return await browser.touchAction({
            action: 'moveTo',
            element: locator
        });
    }

    static async actionHoverOverAndClick(hoverOverLocator: WebdriverIO.Element, clickLocator: WebdriverIO.Element) {
        return await browser.touchAction([
            { action: 'moveTo', element: hoverOverLocator },
            { action: 'press', element: clickLocator },
            'release'
        ]);
    }

    static async hasOption(select: WebdriverIO.Element, option: string) {
        return await select.$('option=' + option).isDisplayed();
    }

    static async getFocusedElement() {
        return await browser.getActiveElement();
    }

    static async currentSelectedOptionByText(text: string) {
        const selector = `//option[@selected="selected" and normalize-space(.)="${text}"]`;
        return await $(selector);
    }

    static async getSelectedOption(select: WebdriverIO.Element) {
        return await select.$("option[selected]");
    }

    static async isVisible(locator) {
        return this.EC.visibilityOf(locator);
    }

    static async isNotVisible(locator) {
        return this.EC.invisibilityOf(locator);
    }

    static async inDom(locator) {
        return this.EC.presenceOf(locator);
    }

    static async notInDom(locator) {
        return this.EC.stalenessOf(locator);
    }

    static async isClickable(locator) {
        return this.EC.elementToBeClickable(locator);
    }

    static async hasText(locator, text: string) {
        return this.EC.textToBePresentInElement(locator, text);
    }

    static async titleIs(title: string) {
        return this.EC.titleIs(title);
    }

    static async hasClass(locator: WebdriverIO.Element, klass: string) {
        return locator.getAttribute('class').then((classes: string) => {
            return classes && classes.split(' ').indexOf(klass) !== -1;
        });
    }

    static async hasClassRegex(locator: WebdriverIO.Element, klass: string) {
        const classAttribute = await locator.getAttribute('class');
        const pattern = new RegExp('(^|\\s)' + klass + '(\\s|$)');
        return pattern.test(classAttribute);
    }

    static async clickwithElementName(targetElement: string) {
        const elementObj: WebdriverIO.Element = await PageConfigHelper.findElement(targetElement, false);
        return this.click(elementObj);
    }

    static async click(targetElement: WebdriverIO.Element) {
        await WaitHelper.getInstance().waitForElementToBeClickable(targetElement);
        return targetElement.click();
    }

    /**
     * For hidden radio/checkbox inputs, returns the clickable target (label[for=id] or parent).
     * Otherwise returns the same element so other behavior is unchanged.
     */
    static async getClickableTargetForRadioOrCheckbox(element: WebdriverIO.Element): Promise<WebdriverIO.Element> {
        const tag = await element.getTagName();
        if (tag.toLowerCase() !== 'input') return element as WebdriverIO.Element;
        const type = (await element.getAttribute('type') || '').toLowerCase();
        if (type !== 'radio' && type !== 'checkbox') return element as WebdriverIO.Element;
        const id = await element.getAttribute('id');
        if (id) {
            const escapedId = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            try {
                const label = await browser.$(`label[for="${escapedId}"]`);
                if (label && await label.isDisplayed()) return label as unknown as WebdriverIO.Element;
            } catch (_) {}
        }
        try {
            const parent = await element.$('..');
            if (parent) return parent as unknown as WebdriverIO.Element;
        } catch (_) {}
        return element as WebdriverIO.Element;
    }

    /**
     * Clicks radio or checkbox: uses label or parent when the input is hidden (e.g. PrimeReact).
     * Other elements are clicked as usual.
     */
    static async clickRadioOrCheckbox(element: WebdriverIO.Element) {
        const clickable = await this.getClickableTargetForRadioOrCheckbox(element) as WebdriverIO.Element;
        await WaitHelper.getInstance().waitForElementToBeClickable(clickable);
        return clickable.click();
    }

    static async clickIfPresent(targetElement: WebdriverIO.Element) {
        const isPresent = await targetElement.isDisplayed();
        if (isPresent) {
            return this.click(targetElement);
        }
        return;
    }

    static async clickUsingJs(targetElement: WebdriverIO.Element) {
        await WaitHelper.getInstance().waitForElementToBeClickable(targetElement);
        return this.clickUsingJsNoWait(targetElement);
    }

    static async clickUsingJsNoWait(targetElement: WebdriverIO.Element) {
        return browser.execute('arguments[0].click();', targetElement);
    }

    static async waitForElementToHaveClass(targetElement: WebdriverIO.Element,
        kClass: string,
        timeout = PageHelper.DEFAULT_TIMEOUT,
        message = '') {
        return WaitHelper.getInstance().waitForElementToResolve(
            () => this.hasClass(targetElement, kClass),
            (result: any) => result, timeout, message);
    }

    static async selectDropdownByIndex(elementt: WebdriverIO.Element, optionNum: number) {
        if (optionNum) {
            await elementt.$('< option />').then(function (options) {
                options[optionNum].click();
            });
        }
    }

    static async scrollToElement(elementt: WebdriverIO.Element) {
       await browser.execute('arguments[0].scrollIntoView();', elementt);
    }

    static async scrollElementToMiddle(elementt: WebdriverIO.Element) {
        await browser.execute("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", elementt);
     }

    static async getAttributeValue(elem: WebdriverIO.Element, attribute: string) {
        return elem.getAttribute(attribute)
            .then(function (text) {
                return text.trim();
            });
    }

    static async getText(elem: WebdriverIO.Element) {
        return elem.getText()
            .then(function (text) {
                return text.trim();
            });
    }

    static async isElementPresent(webElement: WebdriverIO.Element): Promise<boolean> {
        return webElement != null && await webElement.isDisplayed();
    }

    static async isElementEnabled(webElement: WebdriverIO.Element): Promise<boolean> {
        return webElement != null && await webElement.isEnabled();
    }
    static async isElementTextPresent(webElement: WebdriverIO.Element, attributeType: string, attribute: string): Promise<boolean> {
        if (webElement == null) {
            return false;
        }
        const attributes = await webElement.getAttribute(attributeType);
        return await attributes.indexOf(attribute) !== -1;
    }
    static async countElements(elements: WebdriverIO.Element[]): Promise<number> {
        return await elements.length;
    }

    static async isAnyElementPresent(webElements: WebdriverIO.Element[]): Promise<boolean> {
        let presencePromises = webElements.map(element => this.isElementPresent(element));
        let presences: boolean[] = await Promise.all(presencePromises);
        return presences.some(presence => presence === true);
    }

    static async areAllElementPresent(webElements: WebdriverIO.Element[]): Promise<boolean> {
        let presencePromises = webElements.map(element => this.isElementPresent(element));
        let presences: boolean[] = await Promise.all(presencePromises);
        return presences.every(presence => presence === true);
    }

    static async isElementDisplayed(webElement: WebdriverIO.Element): Promise<boolean> {
        return webElement != null && await webElement.isDisplayed();
    }

    static async areNElementDisplayed(webElements: WebdriverIO.Element[], expectedCount: number, exactCount: boolean = false): Promise<boolean> {
        let displayPromises = webElements.map(element => this.isElementDisplayed(element));
        let displays: boolean[] = await Promise.all(displayPromises);
        const visibleElements = displays.filter(display => display === true);
        return exactCount ? visibleElements.length >= expectedCount : visibleElements.length === expectedCount;
    }

    static async areAllElementDisplayed(webElements: WebdriverIO.Element[]): Promise<boolean> {
        let displayPromises = webElements.map(element => this.isElementDisplayed(element));
        let displays: boolean[] = await Promise.all(displayPromises);
        return displays.every(display => display === true);
    }

    static async isElementSelected(webElement: WebdriverIO.Element): Promise<boolean> {
        return webElement != null && await webElement.isSelected();
    }

    static async getAttribute(webElement: WebdriverIO.Element, attributeName: string): Promise<string> {
        return webElement != null && await webElement.getAttribute(attributeName);
    }

    static async clearElement(webElement: WebdriverIO.Element): Promise<void> {
        await webElement.clearValue();
    }
    //https://stackoverflow.com/questions/39399477/protractor-scroll-into-view-not-working
    static async scrollElementToView(element: WebdriverIO.Element): Promise<void> {
        await element.scrollIntoView();
    }
    static async getElementText(webElement: WebdriverIO.Element): Promise<string> {
        //await this.browserWait.waitElementToBeVisible(webElement);
        return await webElement.getText();
    }
}
