/**
 * Page helper for general utility
 */
import { WaitHelper } from './wait-helper';

export class PageHelper {
    static MAX_RETRY_ATTEMPTS = 3;
    static WAIT_POLL_ATTEMPTS = 40;
    // noinspection JSValidateJSDoc
    /**
     * Timeout collection to meet various needs
     * @type {{xs: number; s: number; m: number; l: number; xl: number; xxl: number; xxxl: number}}
     */
    public static timeout = {
        xxs: 1000,
        xs: 2000,
        s: 5000,
        m: 10000,
        l: 25000,
        xl: 50000,
        xxl: 75000,
        xxxl: 200000
    };
    static DEFAULT_TIMEOUT = PageHelper.timeout.xxl;

    static get isFullScreen() {
        const fullScreenScript = 'if (!window.screenTop && !window.screenY){return true;}'
            + 'else{return false;}';
        return browser.execute(fullScreenScript);
    }

    static async actionKeyDown(key: string) {
        return await browser.keys(key);
    }

    static async executeInIframe(index: number | WebdriverIO.Element, fn: Function) {
        await browser.switchToFrame(index);
        fn();
        await browser.switchToParentFrame();
    }

    static async actionSendKeys(key: string) {
        return await browser.keys(key);
    }

    static sendKeysToInputField(elem: WebdriverIO.Element, key: string) {
        elem.sendKeys([key]);
    }

    static actionKeyUp(key: string) {
        //return browser.actions().keyUp(key).perform();
    }

    static keyPressForBrowser(key: string) {
        //return browser.actions().sendKeys(key).perform();
    }

    static actionMouseUp(location: WebdriverIO.Element) {
        // return browser.actions().mouseUp(location).perform();
    }

    // Known issue for chrome, direct maximize window doesn't work
    /**
     * To maximize the browser window
     */
    public static async maximizeWindow() {
        class Size {
            width: number;
            height: number;
        }

        const windowSize = await this.executeScript(function () {
            return {
                width: window.screen.availWidth,
                height: window.screen.availHeight
            };
        });

        const result = windowSize as Size;

        return this.setWindowSize(result.width, result.height);
    }

    /**
     * Sets window size
     * @param {number} width
     * @param {number} height
     */
    public static async setWindowSize(width: number, height: number) {
        return await browser.setWindowSize(width, height);
    }

    /**
     * Wrapper for executing javascript code
     * @param {string | Function} script
     * @param varAargs
     * @returns {promise.Promise<any>}
     */
    public static async executeScript(script: string | any,
        ...varAargs: any[]) {
        return browser.execute(script, varAargs);
    }

    /**
     * Wrapper to return an active element
     * @returns {WebElementPromise}

     public static async getFocusedElement() {
    return browser.driver.switchTo().activeElement()
  } */

    /**
     * Switch to a new tab if browser has availability
     * @returns {PromiseLike<boolean> | Promise<boolean> | Q.Promise<any> | promise.Promise<any> | Q.IPromise<any>}
     */
    public static async switchToNewTabIfAvailable() {
        const handles = await browser.getWindowHandles();
        const newWindowHandle = handles[1]; // this is your new window
        if (newWindowHandle) {
            await browser.switchToWindow(newWindowHandle);
        }
        const url = await browser.getUrl();

        // Avoiding bootstraping issue, Known issue
        // Error: Error while waiting for Protractor to sync with the page:
        // "window.angular is undefined. This could be either because this is a non-angular page or
        // because your test involves client-side navigation, which can interfere with Protractor's bootstrapping.
        // See http://git.io/v4gXM for details
        return browser.url(url);
    }

    /**
     * Gets html attribute value
     * @param {WebElementPromise} elem
     * @param {string} attribute
     * @returns {string} attribute value
     */
    public static async getAttributeValue(elem: WebdriverIO.Element,
        attribute: string) {
        const attributeValue = await elem.getAttribute(attribute);
        return attributeValue.trim();
    }

    /**
     * Click on element
     * @param {WebdriverIO.Element} targetElement
     * @returns {any}
     */
    public static async click(targetElement: WebdriverIO.Element) {

        await WaitHelper.getInstance().waitForElementToBeClickable(targetElement);

        return targetElement.click();
    }

    public static async clickInFrame(targetElement: WebdriverIO.Element, frame: WebdriverIO.Element) {

        await WaitHelper.getInstance().waitForFrameElementToBeClickable(targetElement, frame);

        return this.executeInIframe(frame, async () => {
            return targetElement.click();
        });
    }

    /**
     * Click on the element and wait for it to get hidden
     * @param {WebdriverIO.Element} targetElement
     * @returns {PromiseLike<boolean> | Promise<boolean> | Q.Promise<any> | promise.Promise<any> | Q.IPromise<any>}
     */
    public static async clickAndWaitForElementToHide(targetElement: WebdriverIO.Element) {
        await WaitHelper.getInstance().waitForElementToBeClickable(targetElement);
        await targetElement.click();
        return WaitHelper.getInstance().waitForElementToBeHidden(targetElement);
    }

    /**
     * Gets promise for current url
     * @returns {any}
     */
    public static async currentUrl() {
        return browser.getUrl();
    }

    static async getAllTexts(elements: WebdriverIO.Element[]) {
        let text: string[] = [];
        elements.forEach(async element => {
            text.push((await element.getText()).trim());
        }
        )
    }

    static copyArray(oldArray: any[]) {
        const newArray: any = [];
        oldArray.forEach((item) => {
            newArray.push(item);
        });
        return newArray;
    }

    static compareTwoArrays(firstArray: any[], secondArray: any[]) {
        let flag = true;
        for (let i = 0; i < firstArray.length; i++) {
            if (firstArray[i] !== secondArray[i]) {
                flag = false;
                break;
            }
        }
        return flag;
    }

    static sortStringArrayInAscendingOrder(list: string[]) {
        return list.sort((as, bs) => {
            var a: any, b: any, a1: number, b1: number, i = 0, n: number, L,
                rx = /(\.\d+)|(\d+(\.\d+)?)|([^\d.]+)|(\.\D+)|(\.$)/g;
            if (as === bs) return 0;
            a = as.toLowerCase().match(rx);
            b = bs.toLowerCase().match(rx);
            L = a.length;
            while (i < L) {
                if (!b[i]) return 1;
                a1 = a[i],
                    b1 = b[i++];
                if (a1 !== b1) {
                    n = a1 - b1;
                    if (!isNaN(n)) return n;
                    return a1 > b1 ? 1 : -1;
                }
            }
            return b[i] ? -1 : 0;
        });
    }

    static sortStringArrayInDescendingOrder(list: string[]) {
        return list.sort(function (a, b) {
            if (a > b) {
                return -1;
            } else if (a < b) {
                return 1;
            } else {
                return 0;
            }
        });
    }
}
