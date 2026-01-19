import { PageHelper } from './page-helper';
import { CommonPageValidations } from "../misc-utils/common-page.validations";
import { PageConfigHelper } from '../misc-utils/PageHelper';
import * as EC from 'wdio-wait-for';
import { fail } from 'assert';

const chai = require('chai').use(require('chai-as-promised'));
const assert = chai.assert;


export class WaitHelper {
    private static instance: WaitHelper;
    private readonly EC = EC;

    private constructor() {
    }

    static getInstance() {
        if (!WaitHelper.instance) {
            WaitHelper.instance = new WaitHelper();
        }
        return WaitHelper.instance;
    }

    /**
     * Default timeout for promises
     * @type {number}
     */
    /**
     * Wait for an element to exist
     * @param {Element} targetElement
     * @param {number} timeout
     * @param {string} message
     */
    public async waitForElement(targetElement,
        timeout = PageHelper.DEFAULT_TIMEOUT,
        message = 'Element should exist') {
        let mess: string = targetElement.toString() + message;

        return await browser.waitUntil(EC.presenceOf(targetElement), {
            timeout: timeout,
            timeoutMsg: mess
        });
    }

    /**
     * Wait for an element to display
     * @param {Element} targetElement
     * @param {number} timeout
     * @param {string} message
     */
    public async waitForElementToBeDisplayed(targetElement,
        timeout = PageHelper.DEFAULT_TIMEOUT,
        message = CommonPageValidations.shouldBeVisible) {
        let mess: string = targetElement.toString() + message;

        return await browser.waitUntil(EC.visibilityOf(targetElement), {
            timeout: timeout,
            timeoutMsg: mess
        });
    }


    public async waitForFrameElementToBeDisplayed(targetElement,
        frame,
        timeout = PageHelper.timeout.xxs,
        attempts = PageHelper.WAIT_POLL_ATTEMPTS,
        message = CommonPageValidations.shouldBeVisible) {
        for (var i = 0; i < attempts; ++i) {
            try {
                await WaitHelper.getInstance().waitForElement(frame);
                await browser.switchToFrame(await frame);
                let isDisplayed = browser.waitUntil(EC.visibilityOf(targetElement), {
                    timeout: timeout
                }).then(() => true, () => false);

                await browser.switchToParentFrame();

                if (isDisplayed) {
                    return true;
                } else {
                    continue;
                }
            } catch (error) {

            }
        }
        // fail(`${targetElement.toString()}, ${frame.toString()} ${message}`);
    }

    /**
     * Wait for an element to hide
     * @param {ElementFinder} targetElement
     * @param {number} timeout
     * @param {string} message
     * @returns {any}
     */
    public async waitForElementToBeHidden(targetElement,
        timeout = PageHelper.DEFAULT_TIMEOUT,
        message = 'Element should not be visible') {
        let mess: string = targetElement.toString() + message;
        return await browser.waitUntil(EC.invisibilityOf(targetElement), {
            timeout: timeout,
            timeoutMsg: mess
        });
    }

    /**
     * Wait for an element to become clickable
     * @param {ElementFinder} targetElement
     * @param {number} timeout
     * @param {string} message
     */
    public async waitForElementToBeClickable(targetElement,
        timeout = PageHelper.DEFAULT_TIMEOUT,
        message = CommonPageValidations.shouldBeClickable) {
        let mess: string = targetElement.toString() + message;
        return await browser.waitUntil(EC.elementToBeClickable(targetElement), {
            timeout: timeout,
            timeoutMsg: mess
        });
    }

    public async waitForPageLoad(screenName) {
        await browser.pause(1000);
        if (screenName == "Claim Actions" || screenName == "Claim Summary"
            || screenName == "Pre-Adjudicative Results" || screenName == "Adjudicative Results"
            || screenName == "Contact Info") {
            await browser.pause(1000);
        }
        await WaitHelper.getInstance().waitForPageTitle(screenName);
    }

    public async waitForFrameElementToBeClickable(targetElement,
        frame: WebdriverIO.Element,
        timeout = PageHelper.timeout.xxs,
        attempts = PageHelper.WAIT_POLL_ATTEMPTS,
        message = CommonPageValidations.shouldBeClickable) {
        for (var i = 0; i < attempts; ++i) {
            await WaitHelper.getInstance().waitForElement(frame);
            await browser.switchToFrame(frame);

            let isClickable = await browser.waitUntil(EC.elementToBeClickable(targetElement), {
                timeout: timeout
            }).then(() => true, () => false);
            await browser.switchToParentFrame();

            if (isClickable) {
                return true;
            } else {
                continue;
            }
        }
        fail(`${targetElement.toString()}, ${frame.toString()} ${message}`);
    }


    public async waitForElementToResolve(promiseCall: Function,
        resolver: Function,
        timeout = PageHelper.DEFAULT_TIMEOUT,
        message = '') {
        let result = false;

        return await browser.waitUntil(() => {
            promiseCall().then((value: any) => (result = resolver(value)));
            return result;
        }, {
            timeout: timeout,
            timeoutMsg: message
        });
    }

    public async waitForElementToHaveText(targetElement: WebdriverIO.Element, timeout = PageHelper.DEFAULT_TIMEOUT, message = '') {
        return this.waitForElementToResolve(() => targetElement.getText(), (text: string) => text.length > 0, timeout, message);
    }

    public async waitForElementOptionallyPresent(targetElement, timeout = PageHelper.DEFAULT_TIMEOUT) {
        const isDisplayed = this.EC.presenceOf(targetElement);
        return await browser.waitUntil(isDisplayed, {
            timeout: timeout,
        }).then(function () {
            return true;
        }, function () {
            return false;
        });
    }

    // tslint:disable-next-line:member-ordering
    public async sleep(timeout = PageHelper.DEFAULT_TIMEOUT) {
        if (!(timeout === PageHelper.DEFAULT_TIMEOUT)) {
            timeout = timeout;
        } else {
            timeout = timeout * 1000;
        }
        const date = Date.now();
        let currentDate = null;
        do {
            currentDate = Date.now();
        } while (currentDate - date < timeout);
    }

    // tslint:disable-next-line:member-ordering
    public async waitForText(textWait: string, timeout = PageHelper.DEFAULT_TIMEOUT, attempts = PageHelper.WAIT_POLL_ATTEMPTS) {
        let result = false;
        let webBody;
        let htmlbodyText;
        for (let i = 0; i < attempts; ++i) {
            this.sleep(timeout);
            webBody = $('<body>');
            htmlbodyText = await webBody.getText();
            if (htmlbodyText.toString().includes(textWait)) {
                result = true;
                return result;
            } else {
                continue;
            }
        }
        return result;
    }

    public async waitForPageLabel(textWait: string, timeout = PageHelper.DEFAULT_TIMEOUT, attempts = PageHelper.WAIT_POLL_ATTEMPTS) {
        await browser.waitUntil(EC.visibilityOf("//*[text()[contains(.,'" + textWait + "')]]"), { timeout: timeout, timeoutMsg: 'Failed, after waiting for element: ' + textWait });
        return true;
    }

    // tslint:disable-next-line:member-ordering
    public async waitForTitle(titletWait: string, timeout = PageHelper.DEFAULT_TIMEOUT, attempts = PageHelper.MAX_RETRY_ATTEMPTS) {
        await browser.waitUntil(EC.titleContains(titletWait), { timeout: timeout, timeoutMsg: 'Failed, after waiting for title: ' + titletWait });
        return true;
    }

    public async waitForFrameElementToBeVisible(targetElementText: string,
        frame: string,
        timeout = PageHelper.timeout.xl,
        attempts = PageHelper.WAIT_POLL_ATTEMPTS,
        message = CommonPageValidations.shouldBeVisible) {
        for (var i = 0; i < attempts; ++i) {
            try {
                await browser.switchToParentFrame();
                await WaitHelper.getInstance().waitForElement($(frame));
                await browser.switchToFrame(await $(frame));
                let isDisplayed = browser.waitUntil(EC.visibilityOf($("//*[text()[contains(.,'" + targetElementText + "')]]")), {
                    timeout: timeout
                }).then(() => true, () => false);
                await browser.switchToParentFrame();
                if (isDisplayed) {
                    return true;
                } else {
                    continue;
                }
            } catch (error) {
                await browser.pause(2000);
            }
        }
    }

    public async waitForPageTitle(screenName: string) {
        let title = await PageConfigHelper.findTitle(screenName);
        if (title != 'Element not found in JSON') {
            await browser.switchToParentFrame();
            await this.waitForTitle(Object.values(title)[0]);
            if (Object.keys(title).length == 2) {
                if (screenName == "Person Info" || screenName == "Contact Info" || screenName == "Marriage" || screenName == "Add Marriage"|| screenName == "Advance Designation") {
                    await WaitHelper.getInstance().waitForFrameElementToBeVisible(Object.values(title)[1], '<iframe />');
                    await browser.switchToParentFrame();
                    await browser.switchToFrame(await $('<iframe />'));
                }
                await this.waitForPageLabel(Object.values(title)[1]);
                await browser.switchToParentFrame();
            }
            assert.equal(await browser.getTitle(), Object.values(title)[0]);
            PageConfigHelper.setCurrentPage(screenName);
        }
        else {
            fail('Please check the title for ' + screenName);
        }
    }

    public async waitForElementAttributeChange(elementXpath: string, attributeName: string, display: boolean) {
        for (let i: number = 0; i < 100; i++) {
            let elem = await $(elementXpath);
            let att: string = await elem.getAttribute(attributeName);
            if (display == (att == "true")) {
                break;
            }

            await browser.pause(300);
        }

    }

    // tslint:disable-next-line:member-ordering
    public async waitForAlert(timeout = PageHelper.DEFAULT_TIMEOUT, attempts = PageHelper.MAX_RETRY_ATTEMPTS) {
        let result = false;
        if (!(timeout === PageHelper.DEFAULT_TIMEOUT)) {
            timeout = timeout;
        } else {
            timeout = timeout * 1000;
        }
        for (let i = 0; i < attempts; ++i) {
            const isAlertPresent = await browser.waitUntil(EC.alertIsPresent(), {
                timeout: timeout
            }).then(() => true, () => false);
            if (isAlertPresent) {
                result = true;
                return result;
            } else {
                continue;
            };
        }
        return result;
    }
}
