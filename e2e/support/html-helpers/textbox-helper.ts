import type { ElementLike } from './element-helper';
import { WaitHelper } from './wait-helper';
import { PageConfigHelper } from "../misc-utils/PageHelper";

export class TextboxHelper {

    /**
  * get input value
  * @param {ElementFinder} locator
  */
    public static async getValue(locator: ElementLike): Promise<string> {
        await WaitHelper.getInstance().waitForElementToBeDisplayed(locator);
        return await locator.getValue();
    }

    /**
     * Clears the existing text from an input elements
     * @param {ElementFinder} locator
     */
    public static async clearText(locator: ElementLike) {
        await locator.clearValue();
    }

    public static async sendKeyswithElementName(locatorName: string, value: string, sendEnter = false) {
        const textElement: WebdriverIO.Element = await PageConfigHelper.findElement(locatorName, false);
        await TextboxHelper.sendKeys(textElement, value, false);
    }

    /**
     * Send Keys to an input elements once it becomes available
     * @param {ElementFinder} locator for element
     * @param {string} value to be sent
     * @param {boolean} sendEnter for sending an enter key
     */
    public static async sendKeys(locator: ElementLike,
        value: string,
        sendEnter = false) {
        await WaitHelper.getInstance().waitForElementToBeDisplayed(locator);
        await this.clearText(locator);
        await locator.setValue(value);
        if (sendEnter) {
            await locator.sendKeys(['ENTER']);
        }
    }

    /**
     * Checks whether an input box has particular value or not
     * @param {ElementFinder} locator
     * @param {string} text
     * @returns {PromiseLike<boolean> | Promise<boolean> | Q.Promise<any> | promise.Promise<any> | Q.IPromise<any>}
     */
    /*
    public static async hasValue(locator: ElementFinder, text: string) {
        const val = await PageHelper.getAttributeValue(
            locator,
            HtmlHelper.attributes.value
        );
        return val === text;
    }
    */

}
