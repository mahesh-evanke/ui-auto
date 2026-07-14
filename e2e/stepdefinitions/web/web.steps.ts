import { PageConfigHelper } from "../../support/misc-utils/PageHelper";
import { DropDownHelper } from "../../support/html-helpers/dropdown-helper";
import { ElementHelper } from "../../support/html-helpers/element-helper";
import { TextboxHelper } from '../../support/html-helpers/textbox-helper';
import { CheckboxHelper } from '../../support/html-helpers/checkbox-helper';
import { WaitHelper } from '../../support/html-helpers/wait-helper';
import { Given, Then, When, DataTable } from '@wdio/cucumber-framework';
import { TimeChanger } from '../../support/misc-utils/TimeChanger';
import { StringManipulationHelper } from "../../support/misc-utils/string-manipulation-helper";
import { ScenarioContext } from "../../support/misc-utils/ScenarioContext";
import { invokeScreenLoadHandlers } from "../../support/misc-utils/ScreenLoadHandlers";
import { CSVReader } from '../../support/misc-utils/csv-reader';
import { EnrollResultsCalc } from '../appSpecific/EnrollResultsCalc';
import { PDFManager } from '../../support/misc-utils/PDFManager';
import { PSCHelper } from '../../support/misc-utils/PSCHelper';
import { loadFrameworkConfig } from '../../../src/config/loadConfig';
import { startNetworkCapture } from '../../support/networkCapture';
import * as fs from 'fs';
import moment = require("moment");
import { enrollCalc, pageVariables, enrollCalcOutput, setEnrollCalcOutput, syncDobToScenarioContext, resetEnrollCalc } from '../appSpecific/CCE_context';

const e2eConfig = loadFrameworkConfig();
const chai = require('chai').use(require('chai-as-promised'));
const expect = chai.expect;
const assert = chai.assert;


When('User are on scenare title {string}', async (title: string) => {
    console.log(title)
});

When('Verify field {string} text is {string}', async (fieldName: string, expectedText: string) => {
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(fieldName, false) as unknown as WebdriverIO.Element;
    let actualText: string = await element.getText();
    actualText = StringManipulationHelper.removeSepecial(actualText);
    expectedText = StringManipulationHelper.removeSepecial(expectedText);
    assert.equal(actualText, expectedText, "Field " + fieldName + " is not expected.");
    await PageConfigHelper.safeSwitchToParentFrame();
});

Given('enters {string} text in {string} textbox', async (txtInput: string, elementName: string) => {
    if (txtInput == "500 characters") {
        txtInput = StringManipulationHelper.createRandomString(500);
    } else if (txtInput == "501 characters") {
        txtInput = StringManipulationHelper.createRandomString(501);
    } else if (txtInput.includes("<CURRENT_DATE")) {
        txtInput = TimeChanger.getActualTime(txtInput, new Date());
    } else if (txtInput.includes("<DOB")) {
        const dob = ScenarioContext.getDob() || new Date();
        txtInput = TimeChanger.getActualTime(txtInput, dob);
    }
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(elementName, false) as unknown as WebdriverIO.Element;
    if (txtInput != "<blank>")
        await TextboxHelper.sendKeys(element, txtInput, false);
    else if (txtInput == "<blank>")
        await TextboxHelper.clearText(element);
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('click More Info link, and verfiy popup text', async (table: DataTable) => {
    const tableHash = table.hashes();
    await PageConfigHelper.changeFrame();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        const xpath = "(//a[contains(.,'More on order of priority')])[" + tableHash[rowNum].linkNumber + "]" + " | " + "(//a[contains(.,'More Info')])[" + tableHash[rowNum].linkNumber + "]" + " | " + "(//a[contains(.,'More info')])[" + tableHash[rowNum].linkNumber + "]";
        await ElementHelper.click(await $(xpath) as unknown as WebdriverIO.Element);
        let titles = (await $$("//*[contains(@id,'More_Info')]//uef-modal-header | //*[contains(@id,'MoreInfo')]//uef-modal-header | //*[contains(@id,'help-modal')]//uef-modal-header")) as unknown as WebdriverIO.ElementArray;
        let texts = (await $$("//*[contains(@id,'More_Info')]//uef-modal-body  | //*[contains(@id,'MoreInfo')]//uef-modal-body | //*[contains(@id,'help-modal')]//uef-modal-body")) as unknown as WebdriverIO.ElementArray;
        let actualTitle = ""
        for (let i = 0; i < titles.length; i++) {
            if (await titles[i].isDisplayed()) {
                actualTitle = await titles[i].getText();
                break;
            }
        }

        let actualText = ""
        for (let i = 0; i < texts.length; i++) {
            if (await texts[i].isDisplayed()) {
                actualText = await texts[i].getText();
                break;
            }
        }
        await assert.isTrue(StringManipulationHelper.verifyTwoStringIncluded(actualTitle, tableHash[rowNum].expectedTitle), "actual is: " + actualTitle + ", expected is: " + tableHash[rowNum].expectedTitle);
        await assert.isTrue(StringManipulationHelper.verifyTwoStringIncluded(actualText, tableHash[rowNum].expectedText), "actual is: " + actualText + ", expected is: " + tableHash[rowNum].expectedText);

        let closeButtons = (await $$("//button[.='Close']")) as unknown as WebdriverIO.ElementArray;
        for (let i = 0; i < closeButtons.length; i++) {
            if (await closeButtons[i].isDisplayed() && await closeButtons[i].isClickable()) {
                await ElementHelper.click(closeButtons[i] as unknown as WebdriverIO.Element);
                break;
            }
        }
        await PageConfigHelper.safeSwitchToParentFrame();
    }
});

When('click page link and verify new pages opens with title', async (table: DataTable) => {
    const tableHash = table.hashes();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        const xpath = '//a[.="' + tableHash[rowNum].LinkText + '"]';
        await ElementHelper.click(await $(xpath) as unknown as WebdriverIO.Element);
        const tabs = await browser.getWindowHandles();
        await browser.switchToWindow(tabs[1]);
        const actualTitle = await browser.getTitle();
        await assert.isTrue(StringManipulationHelper.verifyTwoStringIncluded(actualTitle, tableHash[rowNum].ExpectedTitle), "actual is: " + actualTitle + ", expected is: " + tableHash[rowNum].ExpectedTitle);
        await browser.closeWindow();
        await browser.switchToWindow(tabs[0]);
    }
});

When('User selects {string} link on Person Status screen', async (objName: string) => {
    const element = await $("//a[contains(.,'" + objName + "')]") as unknown as WebdriverIO.Element;
    await ElementHelper.click(element);
});

When('User inputs information on the {string} screen if exist', async (objName: string, table: DataTable) => {
    const tableHash = table.hashes();
    await PageConfigHelper.changeFrame();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        for (let [key, value] of Object.entries(tableHash[rowNum])) {
            await PageConfigHelper.answerQuestions(key, value.toString(), ScenarioContext.getDob() || new Date());
        }
    }
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('User inputs information on the {string} screen', async (objName: string, table: DataTable) => {
    const tableHash = table.hashes();
    await PageConfigHelper.changeFrame();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        for (let [key, value] of Object.entries(tableHash[rowNum])) {
            await PageConfigHelper.answerQuestions(key, value.toString(), ScenarioContext.getDob() || new Date());
        }
    }
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('User verify information on {string} screen with following params', async (screenName: string, table: DataTable) => {
    PageConfigHelper.setCurrentPage(screenName);
    for (var row = 1; row < table.raw().length; row++) {
        for (var column = 0; column < table.raw()[0].length; column++) {
            const objName = table.raw()[0][column];
            let objValue = table.raw()[row][column];
            if (objValue == "<blank>") continue;
            if (objName.toLocaleLowerCase().startsWith("radio_") && (objValue.toLowerCase() == "yes" || objValue.toLowerCase() == "no")) {
                let locator = await PageConfigHelper.locator(objName, false);
                if (locator[0] == 'id') {
                    let id = locator[1] + '-option-'
                    if (objValue.toLowerCase() == "yes") {
                        id += 'true';
                    } else {
                        id += 'false';
                    }
                    const actual: boolean = await $("//input[@id='" + id + "']").isSelected();
                    assert.equal(actual, true);
                }

            } else {
                let pgelement = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
                var objType = await pgelement.getAttribute('type');
                var objTagName = await pgelement.getTagName();
                if (objType == "text" && objTagName == "input") {
                    if (objValue.includes("<CURRENT_DATE")) {
                        objValue = TimeChanger.getActualTime(objValue, new Date());
                    } else if (objValue.includes("<DOB")) {
                        const d = ScenarioContext.getDob() || enrollCalc?.dob || new Date();
                        const time = d instanceof Date ? d : new Date(d as string);
                        objValue = TimeChanger.getActualTime(objValue, time);
                    }
                    const inputValue = await TextboxHelper.getValue(pgelement);
                    assert.equal(inputValue, objValue);
                }
                else if (objType == "checkbox" && objTagName == "input") {
                    const actual: boolean = await pgelement.isSelected();
                    const expected: boolean = objValue.toLowerCase() == "on";
                    assert.equal(actual, expected);
                }
                else if (objType == "radio" && objTagName == "input") {
                    if (objValue.toLowerCase() == "yes" || objValue.toLowerCase() == "no") {
                        objValue = objValue[0].toUpperCase() + objValue.substring(1).toLowerCase();
                        const actual: boolean = await (await PageConfigHelper.findElement(objName + objValue, false)).isSelected();
                        assert.equal(actual, true);
                    } else {
                        const actual: boolean = await pgelement.isSelected();
                        const expected: boolean = objValue.toLowerCase() == "on";
                        assert.equal(actual, expected);
                    }
                }
                else if (objType == "button" && objTagName == "input") {
                    await ElementHelper.click(pgelement);
                }
                else if (objTagName == "select") {
                    const id = await (await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element).getValue();
                    const actual = await (await $("//option[@value='" + id + "']")).getText();
                    assert.equal(actual, objValue);
                }
            }


        }
    }
});

When('User verifies field entries on the Payment Method', async (table: DataTable) => {
    var tableHash = table.hashes();
    let tables = {};
    let paymentMethodType = "";
    for (let row in tableHash) {
        if (tableHash[row].Field == 'Payment Method Type') {
            paymentMethodType = tableHash[row].Value;
        } else
            if (tableHash[row].Field == 'Account Type' || tableHash[row].Field == 'Routing Number' || tableHash[row].Field == 'Account Number') {
                tables[tableHash[row].Field] = (tableHash[row].Value == '<blank>') ? "Unknown" : tableHash[row].Value;
            }
    }

    if (paymentMethodType !== "Direct Deposit") {
        await browser.pause(1000);
        const id = await (await PageConfigHelper.findElement("PaymentMethodType", false) as unknown as WebdriverIO.Element).getValue();
        const actual = await (await $("//option[@value='" + id + "']")).getText();
        assert.equal(actual, paymentMethodType);
    } else {
        for (const key in tables) {
            let actual = await (await $("//div[@class='uef-grid_unit_inner']/div//strong[.='" + key + "']/../div") as unknown as WebdriverIO.Element).getText();
            assert.equal(actual, tables[key]);
        }
    }
});

When('User verifies field entries on the {string} screen in query mode', async (objName: string, table: DataTable) => {
    var tableHash = table.hashes();
    var len = tableHash.length;
    await PageConfigHelper.changeFrame();
    for (var fieldNum = 0; fieldNum < len; fieldNum++) {
        let expected = tableHash[fieldNum].Value;
        if (expected.includes("<CURRENT_DATE")) {
            expected = TimeChanger.getActualTime(expected, new Date());
        } else if (expected.includes("<DOB")) {
            const d = ScenarioContext.getDob() || enrollCalc?.dob || new Date();
            const time = d instanceof Date ? d : new Date(d as string);
            expected = TimeChanger.getActualTime(expected, time);
        }

        if ((tableHash[fieldNum].Value).toLowerCase() == "<blank>") continue;
        let locator = "//*[contains(text() , '" + tableHash[fieldNum].Field + "')]/..";
        let divs = (await $$(locator)) as unknown as WebdriverIO.ElementArray;
        if (divs.length == 0) {
            locator = "//*[text()[contains(., '" + tableHash[fieldNum].Field + "')]]/../..";
            divs = (await $$(locator)) as unknown as WebdriverIO.ElementArray;
        }
        let uiText: string | null = null;
        for (let elemNum = 0; elemNum < divs.length; elemNum++) {
            if ((await divs[elemNum].getText()).startsWith("Hide ")) {
                continue;
            } else {
                let div = divs[elemNum] as unknown as WebdriverIO.Element;
                while ((await div.getTagName()) != "div") {
                    div = await div.$("./..") as unknown as WebdriverIO.Element;
                }
                let texttElem: WebdriverIO.Element;
                const spanEls = await div.$$(".//span[last()]");
                const emEls = await div.$$("./..//em[last()]");
                const inputEls = await div.$$("./..//input");
                if ((spanEls as unknown as any[]).length > 0) {
                    texttElem = await div.$(".//span[last()]") as unknown as WebdriverIO.Element;
                } else if ((emEls as unknown as any[]).length > 0) {
                    texttElem = await div.$("./..//em[last()]") as unknown as WebdriverIO.Element;
                } else {
                    texttElem = div;
                }
                uiText = (await texttElem.getText()).trim().replace(tableHash[fieldNum].Field, "").trim();
                if (uiText.length == 0) {
                    uiText = await (await div.$("(.//*)[last()]")).getText();
                }
                if (uiText.length == 0 && (inputEls as unknown as any[]).length > 0) {
                    uiText = await (await div.$("./..//input")).getValue();
                }
                if (uiText == expected) {
                    break;
                }
            }
        }
        assert.equal(uiText, expected);
    }
    await PageConfigHelper.safeSwitchToParentFrame();
});
When('enters SSN with criteria {string} in {string} textbox', async (criteriaName: string, ObjName: string) => {
    const element = await PageConfigHelper.findElement(ObjName, false) as unknown as WebdriverIO.Element;
    let ssn = CSVReader.getData(criteriaName);
    await TextboxHelper.sendKeys(element, ssn, false);
    resetEnrollCalc();
});

When('User clicks on {string} button', async (btnName: string) => {
    await PageConfigHelper.changeFrame();
    if (PageConfigHelper.getCurrentPage() == "Filing Date") {
        if (await $('#priorProtectiveFilingDate-option-false').isDisplayed()) {
            let flgDtTxt = await $$(".uef-container_row")[3].getText();
            enrollCalc.filingDate = flgDtTxt.split("Filing Date")[1];
        }
        else {
            const element = await PageConfigHelper.findElement("ProtectiveFilingDate", false) as unknown as WebdriverIO.Element;
            enrollCalc.filingDate = await element.getAttribute("value");
        }
    } else if (PageConfigHelper.getCurrentPage() == "Health Insurance" && btnName == "Next") {
        await enrollCalc.setVariableValues();
    }
    const elementRef = await PageConfigHelper.findElement(btnName, true) as unknown as WebdriverIO.Element;
    await ElementHelper.click(elementRef);
    await PageConfigHelper.safeSwitchToParentFrame();

});

Given('User is on {string} screen', async (screenName: string) => {
    await browser.pause(1000);
    const screensNeedingExtraWait = (e2eConfig as any)?.screensNeedingExtraWait as Record<string, number> | undefined;
    const extraWait = screensNeedingExtraWait?.[screenName];
    if (typeof extraWait === 'number' && extraWait > 0) {
        await browser.pause(extraWait);
    }
    await WaitHelper.getInstance().waitForPageTitle(screenName);
    PageConfigHelper.setCurrentPage(screenName);
    await invokeScreenLoadHandlers(screenName);
});

When('clicks on {string} button', async (objName: string) => {
    if (objName == "<blank>")
        return;
    await PageConfigHelper.changeFrame();
    const elementRef = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await ElementHelper.click(elementRef);
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('selects {string} text from {string} Drop-down list', async (optionVal: string, objName: string) => {
    await browser.pause(500);
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    if (optionVal != "<Skip>") {
        await DropDownHelper.selectOptionByText(element, optionVal);
        await PageConfigHelper.safeSwitchToParentFrame();
    } else {
        const today: Date = new Date();
        if (optionVal.search("0Y") > 0) {
            optionVal = TimeChanger.getActualTime(optionVal, today, "mm/yyyy");
        }
        await element.setValue(optionVal);
        await PageConfigHelper.safeSwitchToParentFrame();
    }
});

When('selects {string} from {string} Drop-down list', async (optionVal: string, objName: string) => {
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    if (optionVal != "<Skip>") {
        await DropDownHelper.selectOptionByText(element, optionVal);
    }
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('verify {string} text is present on the screen', async (txtName: string) => {
    await PageConfigHelper.changeFrame();
    if (txtName == "<CURRENT_DATE>") {
        var today = new Date();
        var dd = String(today.getDate()).padStart(2, '0');
        var mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
        var yyyy = today.getFullYear();

        txtName = mm + '/' + dd + '/' + yyyy;
    }
    await WaitHelper.getInstance().waitForPageLabel(txtName);
    const escaped = (txtName ?? '').replace(/'/g, "''");
    const elem = await $("//body//*[contains(normalize-space(.), '" + escaped + "')]");
    await WaitHelper.getInstance().waitForElement(elem as unknown as WebdriverIO.Element);
    assert.equal(await elem.isDisplayed(), true);
    await PageConfigHelper.safeSwitchToParentFrame();
});

Given('select {string} Checkbox', async (objName: string) => {
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await CheckboxHelper.markCheckbox(element, true);
});

Given('select {string} Checkbox with Wait', async (objName: string) => {
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await CheckboxHelper.markCheckboxWithWaitDisplay(element, true);
});

When('clicks on {string} Radio button', async (objName: string) => {
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await ElementHelper.clickRadioOrCheckbox(element);
    await PageConfigHelper.safeSwitchToParentFrame();
});

// ── Presence/state verification steps ──────────────────────────────────────────
// findElement() throws if the name has no registered locator at all (not just "0
// matches on the page") - the "not present" steps below treat that as confirmed
// absence too, since there's nothing that could be on screen.

When('verify {string} is present on the screen', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementDisplayed(element), true, `Expected "${name}" to be present on the screen`);
});

When('verify {string} is not present on the screen', async (name: string) => {
    try {
        const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
        const displayed = await element.isDisplayed().catch(() => false);
        assert.equal(displayed, false, `Expected "${name}" to NOT be present, but it is displayed`);
    } catch {
        // Name not registered in the locator JSON -> confirmed absent.
    }
});

When('verify {string} link is present on the screen', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementDisplayed(element), true, `Expected "${name}" link to be present on the screen`);
});

When('verify {string} link is not present on the screen', async (name: string) => {
    try {
        const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
        const displayed = await element.isDisplayed().catch(() => false);
        assert.equal(displayed, false, `Expected "${name}" link to NOT be present, but it is displayed`);
    } catch {
        // Name not registered in the locator JSON -> confirmed absent.
    }
});

// Fast, side-effect-free check: does the link's href attribute point at the
// expected URL? Does NOT navigate - use "redirects to" below to actually click
// through and verify the browser lands on the expected page.
When('verify {string} link points to {string}', async (name: string, expectedUrl: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    await element.waitForDisplayed({ timeout: 15000 });
    const href = await ElementHelper.getAttribute(element, 'href');
    assert.include(href || '', expectedUrl, `Expected "${name}" link's href to contain "${expectedUrl}"`);
});

// Behavioral check: clicks the link and verifies where the browser actually ends
// up - handles both same-tab navigation and target="_blank" popups/new windows.
When('verify {string} link redirects to {string}', async (name: string, expectedUrl: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    await element.waitForDisplayed({ timeout: 15000 });

    const originalHandles = await browser.getWindowHandles();
    await ElementHelper.click(element);
    await browser.pause(500);
    const newHandles = await browser.getWindowHandles();
    const openedHandle = newHandles.find((h) => !originalHandles.includes(h));

    if (openedHandle) {
        await browser.switchToWindow(openedHandle);
        await browser.waitUntil(async () => (await browser.getUrl()).includes(expectedUrl), {
            timeout: 15000,
            timeoutMsg: `Expected new window opened by "${name}" link to navigate to "${expectedUrl}"`,
        });
        assert.include(await browser.getUrl(), expectedUrl);
        await browser.closeWindow();
        await browser.switchToWindow(originalHandles[0]);
    } else {
        await browser.waitUntil(async () => (await browser.getUrl()).includes(expectedUrl), {
            timeout: 15000,
            timeoutMsg: `Expected "${name}" link to redirect to "${expectedUrl}"`,
        });
        assert.include(await browser.getUrl(), expectedUrl);
    }
});

When('verify {string} is present in {string} Drop-down list', async (value: string, name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    const has = await DropDownHelper.hasOption(element, value);
    assert.equal(has, true, `Expected "${value}" to be present in "${name}" Drop-down list`);
});

When('verify {string} is not present in {string} Drop-down list', async (value: string, name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    const has = await DropDownHelper.hasOption(element, value);
    assert.equal(has, false, `Expected "${value}" to NOT be present in "${name}" Drop-down list`);
});

When('verify {string} Checkbox is checked', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementSelected(element), true, `Expected "${name}" Checkbox to be checked`);
});

When('verify {string} Checkbox is not checked', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementSelected(element), false, `Expected "${name}" Checkbox to NOT be checked`);
});

When('verify {string} is enabled', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementEnabled(element), true, `Expected "${name}" to be enabled`);
});

When('verify {string} is disabled', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementEnabled(element), false, `Expected "${name}" to be disabled`);
});

When('verify {string} button is present on the screen', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementDisplayed(element), true, `Expected "${name}" button to be present on the screen`);
});

When('verify {string} button is not present on the screen', async (name: string) => {
    try {
        const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
        const displayed = await element.isDisplayed().catch(() => false);
        assert.equal(displayed, false, `Expected "${name}" button to NOT be present, but it is displayed`);
    } catch {
        // Name not registered in the locator JSON -> confirmed absent.
    }
});

When('verify {string} Radio button is present on the screen', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementDisplayed(element), true, `Expected "${name}" Radio button to be present on the screen`);
});

When('verify {string} Radio button is not present on the screen', async (name: string) => {
    try {
        const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
        const displayed = await element.isDisplayed().catch(() => false);
        assert.equal(displayed, false, `Expected "${name}" Radio button to NOT be present, but it is displayed`);
    } catch {
        // Name not registered in the locator JSON -> confirmed absent.
    }
});

When('verify {string} Radio button is selected', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementSelected(element), true, `Expected "${name}" Radio button to be selected`);
});

When('verify {string} Radio button is not selected', async (name: string) => {
    const element = await PageConfigHelper.findElement(name, false) as unknown as WebdriverIO.Element;
    assert.equal(await ElementHelper.isElementSelected(element), false, `Expected "${name}" Radio button to NOT be selected`);
});

When('verify data from {string} web table', async (objName: string, table: DataTable) => {
    await browser.pause(250);

    // Resolve table root:
    // 1) try locator by name under current page
    // 2) try locator by name under common locators
    // 3) fallback to element id (legacy behavior)
    let root: WebdriverIO.Element | null = null;
    try {
        root = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    } catch { /* ignore */ }
    if (!root) {
        try {
            root = await PageConfigHelper.findElement(objName, true) as unknown as WebdriverIO.Element;
        } catch { /* ignore */ }
    }
    if (!root) {
        root = await $(`//*[@id='${objName}']`) as unknown as WebdriverIO.Element;
    }

    const tag = await root.getTagName();
    const tableEl = tag.toLowerCase() === 'table' ? root : (await root.$('table') as unknown as WebdriverIO.Element);
    if (!tableEl) {
        throw new Error(`Table not found for "${objName}". Ensure locator points to a <table> or a container that contains a <table>.`);
    }

    const expected = table.raw();
    if (!expected || expected.length === 0) {
        throw new Error(`Expected DataTable must have at least a header row.`);
    }

    // Read actual header row as displayed in the DOM (first <tr> under table).
    const trEls = (await tableEl.$$('tr')) as unknown as WebdriverIO.Element[];
    if (!trEls || (trEls as any[]).length === 0) {
        throw new Error(`No <tr> rows found under table for "${objName}".`);
    }
    await ElementHelper.scrollElementToMiddle(trEls[0] as unknown as WebdriverIO.Element);

    const headerCells = (await trEls[0].$$('th,td')) as unknown as WebdriverIO.Element[];
    // WebdriverIO's ElementArray#map already returns a Promise when the callback is async,
    // so we just await the map result instead of wrapping again in Promise.all.
    const actualHeaders = await (headerCells as any[]).map((c) => (c as any).getText());

    const normalize = (s: string) => StringManipulationHelper.removeSepecial(String(s ?? '')) ?? '';
    const actualHeadersN = actualHeaders.map(normalize);
    const expectedHeadersN = expected[0].map(normalize);

    // Determine which columns were selected by matching expected header texts against actual header texts.
    const selectedColIdx: number[] = [];
    for (const h of expectedHeadersN) {
        const idx = actualHeadersN.indexOf(h);
        if (idx < 0) {
            throw new Error(`Header "${h}" not found in actual table headers: ${JSON.stringify(actualHeaders)}`);
        }
        selectedColIdx.push(idx);
    }

    // Build actual body rows (skip header row). Use <td> cells; if none exist, fall back to th/td.
    const bodyRows: string[][] = [];
    for (let r = 1; r < (trEls as any[]).length; r++) {
        const row = trEls[r] as unknown as WebdriverIO.Element;
        const tds = (await row.$$('td')) as unknown as WebdriverIO.Element[];
        const cells = (tds && (tds as any[]).length > 0) ? tds : ((await row.$$('th,td')) as unknown as WebdriverIO.Element[]);
        const texts = await (cells as any[]).map((c) => (c as any).getText());
        bodyRows.push(texts.map(normalize));
    }

    // Validate each expected row exists in order in the actual table, comparing only selected columns.
    let searchStart = 0;
    for (let i = 1; i < expected.length; i++) {
        const resolveExpectedCell = (rawCell: string): string => {
            const raw = String(rawCell ?? '');
            if (raw.includes('<CURRENT_DATE+15>')) {
                const d = new Date();
                d.setDate(d.getDate() + 15);
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                return raw.replace(/<CURRENT_DATE\+15>/g, `${mm}/${dd}/${yyyy}`);
            }
            if (raw.includes('<CURRENT_DATE>')) {
                const d = new Date();
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                return raw.replace(/<CURRENT_DATE>/g, `${mm}/${dd}/${yyyy}`);
            }
            return raw;
        };

        const expectedRowResolved = expected[i].map(resolveExpectedCell).map(normalize);

        let foundAt = -1;
        for (let r = searchStart; r < bodyRows.length; r++) {
            const actualRow = bodyRows[r];
            const picked = selectedColIdx.map((c) => actualRow[c] ?? '');
            if (JSON.stringify(picked) === JSON.stringify(expectedRowResolved)) {
                foundAt = r;
                break;
            }
        }
        if (foundAt < 0) {
            throw new Error(
                `row data is different with actual [] and expected ${JSON.stringify(expected[i])} (matching columns: ${JSON.stringify(expected[0])})`
            );
        }
        searchStart = foundAt + 1;
    }
});

When('User verifies information on {string} screen header with following parameters', async (objName: string, table: DataTable) => {
    table = TimeChanger.changeToAcutalTime(table, "Filing Date", 4, 1, <Date>enrollCalc.dob);
    table = TimeChanger.changeToAcutalTime(table, "Enrollment Period End Date", 5, 1, <Date>enrollCalc.dob, "mm/yyyy");
    table = TimeChanger.changeToAcutalTime(table, "Attainment of Age 65", 6, 1, <Date>enrollCalc.dob);
    table = TimeChanger.changeToAcutalTime(table, "Birth Date", 7, 1, <Date>enrollCalc.dob);
    table = TimeChanger.changeToAcutalTime(table, "Full Retirement Age", 7, 1, <Date>enrollCalc.dob);

    for (var i = 0; i < table.raw().length; i++) {
        for (let j: number = 0; j < table.raw()[i].length; j++) {
            if (table.raw()[i][j] == "<SMI_ENRLPD_TYP_CD>") {
                let type: string = enrollCalcOutput[2];
                if (type != "") {
                    table.raw()[i][j] = type + "EP (" + type + ")";
                }
                else {
                    table.raw()[i][j] = "";
                }
            }
            if (table.raw()[i][j] == "<PSC>") {
                let psc = PSCHelper.getHelper(pageVariables.getSSN)
                table.raw()[i][j] = psc.toFixed(0);
            }
        }
    }
    PageConfigHelper.setCurrentPage(objName);
    var data = table.hashes();
    var strtRow, endRow: number;
    if (PageConfigHelper.getCurrentPage() == 'Health Insurance') {
        strtRow = 7;
        endRow = strtRow + data.length;
    }
    else {
        strtRow = 8;
        endRow = strtRow + data.length;
    }
    for (var i = 0; i < data.length; i++) {
        var objValue = data[i].Value;
        if (objValue == "<CURRENT_DATE>") {
            objValue = TimeChanger.getActualTime(objValue, new Date());
        }

        for (var j = strtRow; j < endRow; j++) {
            await ElementHelper.scrollElementToMiddle(await $(".uef-grid_unit_inner") as unknown as WebdriverIO.Element);
            let gridObjTxt = await browser.execute("return document.getElementsByClassName('uef-grid_unit_inner').item(" + j + ").innerText") as unknown as string;
            let txtSplit = gridObjTxt.split('\n');
            if (txtSplit[0] == objName) {
                assert.equal(txtSplit[1], objValue);
                break;
            }
        }
    }
});

When('User verify information on {string} screen header with following parameters', async (objName: string, table: DataTable) => {
    PageConfigHelper.setCurrentPage(objName);
    var data = table.hashes();
    //await browser.pause(2000);
    var strtRow, endRow: number;
    let gridUnitsRef = (await $$(".uef-grid_unit_inner")) as unknown as WebdriverIO.ElementArray;
    if (PageConfigHelper.getCurrentPage() == 'Health Insurance') {
        strtRow = 7;
        endRow = strtRow + data.length;
    }
    else {
        strtRow = 8;
        endRow = strtRow + data.length;
    }
    for (var i = 0; i < data.length; i++) {
        //var objName = data[i].Field;
        var objValue = data[i].Value;
        if (objValue == "<CURRENT_DATE>") {
            var today = new Date();
            var dd = String(today.getDate()).padStart(2, '0');
            var mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
            var yyyy = today.getFullYear();

            objValue = mm + '/' + dd + '/' + yyyy;
        }

        for (var j = strtRow; j < endRow; j++) {
            let gridObjRef = gridUnitsRef[j] as unknown as WebdriverIO.Element;
            await ElementHelper.scrollElementToMiddle(gridObjRef);
            let testTxt = await gridObjRef.getText();
            let txtSplit = testTxt.split('\n');
            //let gridHdrTxt=await gridObjRef.$('span[1]')).getText();
            //let gridVal=await gridObjRef.$('span[2]')).getText();
            if (txtSplit[0] == objName) {
                //assert.equal(gridVal,objValue);
                assert.equal(txtSplit[1], objValue);
                break;
            }
        }
    }
});

Then('verify alerts displayed on the screen', async (table: DataTable) => {
    const element = await PageConfigHelper.findElement("Alerts and Edits", false) as unknown as WebdriverIO.Element;
    let actualtext = await element.getText();
    await ElementHelper.scrollElementToMiddle(element);
    let actTextArr = actualtext.split("Alerts");
    let alertsTxtArr = actTextArr[1].split("\n");
    let actualAlertsArr = [];
    actualAlertsArr.push("Alerts");
    for (var i = 0; i < alertsTxtArr.length; i++) {
        if (alertsTxtArr[i].trim() != "NextPreviousExit" && alertsTxtArr[i].trim() != "")
            actualAlertsArr.push(alertsTxtArr[i].trim());
    }
    //alertsTxtArr.forEach(function (expAlertTxt) {
    //    if(expAlertTxt.trim()!="NextPreviousExit" || "")
    //        actualAlertsArr.push(expAlertTxt.trim());
    //  });
    assert.equal(actualAlertsArr.toString(), table.raw().toString());
});

When('verify information from {string} webtable', async (objName: string, table: DataTable) => {
    if (PageConfigHelper.getCurrentPage() == "Attestation and Printing")
        await browser.pause(5000);
    else
        await browser.pause(2000);
    let colhdrs = (await $$("//*[@id='" + objName + "']//table//th")) as unknown as WebdriverIO.ElementArray;
    let colhdrtext = await $$("//*[@id='" + objName + "']//table//th").map((result) => {
        return result.getText();
    });


    let rows = (await $$("//*[@id='" + objName + "']//table//tr")) as unknown as WebdriverIO.ElementArray;

    let expRows = table.raw().length;
    if (rows.length == expRows) {
        for (var i = 1; i < table.raw().length; i++) {
            let actArray = await $$("//*[@id='" + objName + "']//table//tr[" + i + "]/td").map((result) => {
                return result.getText();
            });

            let expTableColCount = 0;
            for (var j = 1; j < colhdrs.length; j++) {
                let cellText = colhdrtext[j];
                let k = j + 1;
                if (cellText == table.raw()[0][expTableColCount]) {
                    let cell = await $("//*[@id='" + objName + "']//table//tr[" + i + "]/td[" + k + "]") as unknown as WebdriverIO.Element;
                    await ElementHelper.scrollElementToMiddle(cell);
                    let cellTextVal = await cell.getText();
                    if (cellTextVal != table.raw()[i][expTableColCount])
                        throw new Error("columns values do nto match. actual: " + cellTextVal + " , expected: " + table.raw()[i][expTableColCount]);
                    expTableColCount = expTableColCount + 1;
                }
            }
        }
    }
});

Then('User switches to SSIWeb application', async () => {
    await browser.pause(10000);
    let windowHandles = await browser.getWindowHandles();
    let parentHandle, childHandle;

    console.log("Total Handles :- " + windowHandles.length);
    await browser.switchToWindow(windowHandles[1]);
    let title = await browser.getTitle();
    console.log("Child browser title :- " + title);
    //await browser.close();

});

When('clicks on {string} link', async (objName: string) => {
    var element: WebdriverIO.Element;
    if (objName == "Claims Summary" || objName == "Sign Out")
        element = await PageConfigHelper.findElement(objName, true) as unknown as WebdriverIO.Element;
    else
        element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await ElementHelper.click(element);

});

//can be removed
Given('User inputs information on {string} screen with following params', async (screenName: string, table: DataTable) => {
    PageConfigHelper.setCurrentPage(screenName);
    for (var row = 1; row < table.raw().length; row++) {
        for (var column = 0; column < table.raw()[0].length; column++) {
            const objName = table.raw()[0][column];
            let objValue = table.raw()[row][column];
            if (objValue.toLowerCase() == "blank") {
                continue;
            }
            if (objName.toLocaleLowerCase().startsWith("radio_") && (objValue.toLowerCase() == "yes" || objValue.toLowerCase() == "no")) {
                let locator = await PageConfigHelper.locator(objName, false);
                if (locator[0] == 'id') {
                    let id = locator[1] + '-option-'
                    if (objValue.toLowerCase() == "yes") {
                        id += 'true';
                    } else {
                        id += 'false';
                    }
                    await $("//input[@id='" + id + "']/../..").click();
                }

            } else {
                let pgelement = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
                var objType = await pgelement.getAttribute('type');
                var objTagName = await pgelement.getTagName();
                if ((objType == "text" || objType == "password" || objType == "email") && objTagName == "input") {
                    if (objValue.includes("<CURRENT_DATE")) {
                        objValue = TimeChanger.getActualTime(objValue, new Date());
                    } else if (objValue.includes("<DOB")) {
                        const d = ScenarioContext.getDob() || enrollCalc?.dob || new Date();
                        const time = d instanceof Date ? d : new Date(d as string);
                        objValue = TimeChanger.getActualTime(objValue, time);
                    }
                    await TextboxHelper.sendKeys(pgelement, objValue, false);
                } else if (objType == "checkbox" && objTagName == "input") {
                    if (objValue.toLowerCase() == "on") {
                        await CheckboxHelper.markCheckbox(pgelement, true);
                    } else if (objValue.toLowerCase() == "off") {
                        //do nothing
                    }
                }
                else if (objType == "radio" && objTagName == "input") {
                    if (objValue.toLowerCase() == "yes" || objValue.toLowerCase() == "no") {
                        objValue = objValue[0].toUpperCase() + objValue.substring(1).toLowerCase();
                        pgelement = await PageConfigHelper.findElement(objName + objValue, false) as unknown as WebdriverIO.Element;
                        await ElementHelper.clickRadioOrCheckbox(pgelement);
                    } else if (objValue.toLowerCase() == "on") {
                        await ElementHelper.clickRadioOrCheckbox(pgelement);
                    } else if (objValue.toLowerCase() == "off") {
                        //do nothing
                    }
                }
                else if (objType == "button" && objTagName == "input") {
                    await ElementHelper.click(pgelement);
                }
                else if (objTagName == "select")
                    await DropDownHelper.selectOptionByText(pgelement, objValue);
            }

        }
    }
});
Given('User inputs information on {string} screen with following parameters', async (screenName: string, table: DataTable) => {
    PageConfigHelper.setCurrentPage(screenName);
    var data = table.hashes();
    for (var i = 0; i < data.length; i++) {
        var objName = data[i].Field;
        var objValue = data[i].Value;
        const pgelement = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
        var objType = await pgelement.getAttribute('type');
        var objTagName = await pgelement.getTagName();
        if ((objType == "text" || objType == "password" || objType == "email") && objTagName == "input")
            await TextboxHelper.sendKeys(pgelement, objValue, false);
        else if (objType == "checkbox" && objTagName == "input")
            await CheckboxHelper.markCheckbox(pgelement, true);
        else if (objType == "radio" && objTagName == "input") {
            await ElementHelper.clickRadioOrCheckbox(pgelement);
        }
        else if (objType == "button" && objTagName == "input") {
            await ElementHelper.click(pgelement);
        }
        else if (objTagName == "select")
            await DropDownHelper.selectOptionByText(pgelement, objValue);
    }
});

Given('User navigates to {string} URL', async (url: string) => {
    const caps = (browser as any).capabilities as { platformName?: string } | undefined;
    const isMobile = caps?.platformName === 'Android' || caps?.platformName === 'iOS';
    const mobileBaseUrl = (e2eConfig as any)?.mobile?.baseUrl as string | undefined;
    if (isMobile && mobileBaseUrl && (url.includes('localhost') || url.includes('127.0.0.1'))) {
        url = mobileBaseUrl;
    } else if (caps?.platformName === 'Android' && (url.includes('localhost') || url.includes('127.0.0.1'))) {
        // Android emulator: localhost/127.0.0.1 is the device itself. Use 10.0.2.2 to reach the host machine.
        url = url.replace(/localhost|127\.0\.0\.1/g, '10.0.2.2');
    }
    // Start network capture so @webui-api "User sends ... request" can use browser-triggered responses (avoids 401 on duplicate request)
    await startNetworkCapture();
    // On mobile, enforce a client-side timeout so we fail in ~30s (Appium may not honour setTimeout pageLoad)
    const navTimeoutMs = isMobile ? 30000 : undefined;
    if (navTimeoutMs != null) {
        try {
            await browser.setTimeout({ pageLoad: navTimeoutMs });
        } catch {
            // ignore if driver does not support it
        }
    }
    const navPromise = browser.url(url);
    const timeoutPromise =
        navTimeoutMs != null
            ? new Promise<never>((_, reject) =>
                  setTimeout(
                      () => reject(new Error(`Navigation timed out after ${navTimeoutMs / 1000}s`)),
                      navTimeoutMs
                  )
              )
            : null;
    try {
        if (timeoutPromise != null) {
            await Promise.race([navPromise, timeoutPromise]);
        } else {
            await navPromise;
        }
    } catch (e: any) {
        if (isMobile && (e?.message?.includes('timeout') || e?.message?.includes('Timeout'))) {
            throw new Error(
                `Navigation to ${url} timed out. Check: (1) App is running on the host (e.g. npm run dev). (2) App listens on all interfaces (Vite: use --host or server.host: true). (3) From Android emulator the URL must use 10.0.2.2 (e.g. http://10.0.2.2:3000/). Original: ${e?.message ?? e}`
            );
        }
        throw e;
    } finally {
        if (navTimeoutMs != null) {
            try {
                await browser.setTimeout({ pageLoad: 60000 });
            } catch {
                /* ignore */
            }
        }
    }
    await browser.pause(1000);
    // Wait for URL to reflect navigation so next step (User is on screen) can assert title
    const urlCheckTimeout = isMobile ? 5000 : 15000;
    try {
        const hostname = new URL(url).hostname;
        await browser.waitUntil(async () => (await browser.getUrl()).includes(hostname), { timeout: urlCheckTimeout });
        await browser.pause(isMobile ? 1000 : 2000);
    } catch (e) { /* ignore */ }
    // Set page context for SauceDemo login page
    if (url.includes('saucedemo.com')) {
        PageConfigHelper.setCurrentPage('Login Page');
    }
});

When('user refreshes {string} page', async (screenName: string) => {
    //await browser.navigate().refresh();
    //let pageNotLoadedText= await element(By.cssContainingText('*', 'Please correct the following information:')).isDisplayed();
    let noInfoText = await $('*=No information found.').isDisplayed();
    if (noInfoText == true)
        await browser.refresh();
    await PageConfigHelper.setCurrentPage(screenName);
});

When('user refreshes page', async () => {
    await browser.refresh();
});

Given('select Claims Summary Checkbox', async () => {
    await browser.pause(3000);
    //await $("//label[contains(@id ,'uef-generated-id')]")).click();
    await $("//label[@class = 'uef-checkbox_label']").click();
});

When('user enters {string} in Employee Job Title field on T2T18 Determinations screen', async (text: string) => {
    await browser.pause(2000);
    const elements = await $("//input[@id = 'employeeJobTitle']");
    await elements.clearValue();
    await elements.setValue(text);
});

When('delete Lawful Presence status row data', async () => {
    await $("//button[contains(@id ,'deleteButn')]").click();
    await browser.pause(500);
    await $("//uef-button[@id = 'okBtnDeleteId']").click();
});

When('save New Lawful Presence Status row data', async () => {
    const items = await $$('[name="okBtn"]');
    await items[4].click();
});

When('User clicks on {string} link on Person Status screen', async (pageName: string) => {
    const lnksArray = await $$(".uef-link");
    let lnks = lnksArray[2];
    if (pageName == "Applicant Information")
        await lnks.click();
});

Given('clicks on Claims Summary button', async function () {
    await browser.pause(1000);
    const items = await $$("//a[contains(@class,'uef-pro-nav-main_link')]");
    await items[1].click();
});

When('clicks on {string} link with {string} instance', async (objName: string, instStr: string) => {
    const eleLst = await $$('.uef-icon-dropdown-btn.uef-dropdown-toggle');
    if (instStr == "Second")
        await ElementHelper.click(eleLst[1] as unknown as WebdriverIO.Element);
});

Given('closes the application', async function () {
    await browser.pause(1000);
    await browser.closeApp();
});

When('user fills in birth proof and citizenship information', async function () {
    await browser.switchToFrame(await $('<iframe />'));

    let birthProofCodeText = await $('*=Birth Date Proof is required').isDisplayed();
    let citizenProofCodeText = await $('*=Citizenship details are required').isDisplayed();
    console.log(birthProofCodeText);
    await PageConfigHelper.safeSwitchToParentFrame();
});

//Page Chevron Control
When('clicks on {string} Chevron link', async (objName: string) => {
    const chevronLinks = (await $$("//span[@class='uef-toggle_control-text']")) as unknown as WebdriverIO.ElementArray;
    for (let i = 0; i < chevronLinks.length; i++) {
        if ((await chevronLinks[i].getText()).includes(objName)) {
            await chevronLinks[i].click();
            break;
        }
    }
});

When('verifies status of {string} chevron link and {string} text in textbox', async (elementName: string, text: string) => {
    await browser.pause(1000);
    const element = await PageConfigHelper.findElement(elementName, false) as unknown as WebdriverIO.Element;
    const actualShow: boolean = await element.isDisplayed();
    assert.equal(actualShow, true);
    const actual = await element.getValue();
    assert.equal(actual, text);
});

When('User clicks on {string} link in Claim Development path', async (pageName: string) => {
    var lnks: WebdriverIO.Element;
    if (pageName == "Development Notes")
        lnks = await $("(//a[@class='uef-menu_link'])[3]") as unknown as WebdriverIO.Element;
    else if (pageName == "Person Statement")
        lnks = await $("(//a[@class='uef-menu_link'])[4]") as unknown as WebdriverIO.Element;
    else if (pageName == "Report of Contact")
        lnks = await $("(//a[@class='uef-menu_link'])[5]") as unknown as WebdriverIO.Element;
    else if (pageName == "Adjudicative Results")
        lnks = await $("(//a[@class='uef-link'])[19]") as unknown as WebdriverIO.Element;
    else if (pageName == "Person Info")
        lnks = await $("(//a[@class='uef-menu_link'])[2]") as unknown as WebdriverIO.Element;
    await lnks.click();
});

When('Select from Person Providing Statement', async () => {
    await $("//select[@id = 'newRelationToClientTypeCode']").selectByAttribute("value", '02')
});

When('click on save button on Person Statement screen', async () => {
    const loc = await $$("//button[@id = 'uef-button-1']");
    await loc[1].click();
});

When('Select Person Contacted on Report of Contact screen', async () => {
    let loc = await $("//select[@id = 'prsnContacted']");
    await loc.click();
    await loc.$("//option[contains(@value ,' Claimant')]").click();
});

When('clicks on the Report of Contact OK button', async () => {
    let loc = await $$("//button[@id = 'okBtn']");
    await loc[1].click();
    await browser.pause(1000);
});

When('selects {string}', async (value: string) => {
    let buttonValue: string = value;
    switch (buttonValue) {
        case "Add Signature and Attestation":
            await $("//button[@id = 'addSignatureAndAttestation']").click();
            break;
        case "Oral Signature Type":
            await $("//label[@id = 'signatureTypeRadioStr-option-ORAL-label']").click();
            break;
        case "Understand Affirmation":
            const understand = await $("//input[@id = 'affirmationOralStatementYesChkBox1']").click();
            break;
        case "Declare Affirmation":
            await $("//input[@id = 'affirmationOralStatementYesChkBox2']").click();
            break;
        case "Employee Attestation":
            await $("//input[contains(@id , 'declareChkBox')]").click();
            break;
        case "Save":
            await $("//button[@id = 'saveBtn']").click();
            for (let i = 0; i < 10; ++i) {
                const spinnerCtr = await browser.execute("return document.getElementsByName('spinner').length") as unknown as number;
                if (spinnerCtr === 0)
                    break;
                else
                    await browser.pause(1000);
            }
            break;
        case "Cancel":
            await $("//button[@id = 'cancelBtn']").click();
            break;
        case "Next":
            await $("//button[@id = 'nextBtn']").click();
            await browser.pause(2000);
            break;
        case "Ink Signature Type":
            await $("//label[@id = 'signatureTypeRadioStr-option-INK-label']").click();
            break;
        case "Edit Signature and Attestation":
            await $("//button[@id = 'editSignatureAndAttestation']").click();
            await browser.pause(2000);
            break;
        case "Close button":
            await $("//button[@id = 'btnClose']").click();
            break;
    }
});

Then('enters {string} text into textfield', async (inputValue: string) => {
    const element = await $("(//input[contains(@id, 'socialSecurityNumber')])[last()]") as unknown as WebdriverIO.Element;
    element.click();
    await TextboxHelper.sendKeys(element, inputValue, false);
    await browser.keys(['Tab'])
});

When('select Annuity from Civil Service Annuity Type Drop-down List', async () => {
    const loc = await $("//select[@id = 'civilServiceAnnuityType']") as unknown as WebdriverIO.Element;
    await loc.click();
    await loc.$("//option[@value = 'CSA']").click();

});

Then('system generates notice messages with description {string}', async (errMsg: string) => {
    //await browser.pause(2000);
    //const element: WebdriverIO.Element = await PageConfigHelper.findElement("Notice Message", true);
    let errorMsgs = errMsg.split(';');
    let expText = '';
    const Objs = (await $$('<uef-notice />')) as unknown as WebdriverIO.ElementArray;
    for (var i = 0; i < errorMsgs.length; i++) {
        await ElementHelper.scrollElementToMiddle(Objs[i]);
        var tmpText = await Objs[i].getText();
        if (i == 0)
            expText = tmpText;
        else
            expText = expText + '; ' + tmpText
    }
    //expect(expText).to.eventually.equal(errMsg);
    assert.equal(expText, errMsg);
});

Then('User waits for {string} seconds', async (waitTime: string) => {
    await browser.pause(Number(waitTime) * 1000);
});


Then('verify data from {string} webtable dates', async (objName: string, table: DataTable) => {
    if (objName == "periodinsuredstatus") {
        let timeFormula: string = table.raw()[1][1];
        timeFormula = timeFormula.substring(timeFormula.lastIndexOf("<") + 1, timeFormula.lastIndexOf(">"));
        const timeChanger = new TimeChanger(<Date>enrollCalc.dob, timeFormula);
        table.raw()[1][1] = timeChanger.getDateString("mm/dd/yyyy");
    }
    const rows = await browser.execute("return document.getElementById('" + objName + "').getElementsByTagName('tr').length") as unknown as number;
    const expRows = table.raw().length;
    let actArray: any[] = [];
    if (rows == expRows) {
        for (var i = 1; i < rows; i++) {
            actArray = (await browser.execute("tableref = document.getElementById('" + objName + "').getElementsByTagName('tr').item(" + i + ").getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {hdrRow[i]=tableref[i].innerText.trim();} return hdrRow;")) as unknown as any[];
        }
    }
    console.log(JSON.stringify(table.raw()[1]));
    console.log(JSON.stringify(actArray));

    if (JSON.stringify(table.raw()[1]) == JSON.stringify(actArray)) {
    } else {
        throw new Error('row data is different with actual ' + JSON.stringify(actArray) + 'and expected ' + table);
    }

});

//added - 6/9 - need to be reviewed
When('Select Spouse enrolled in SMI Check Box on HI screen', async () => {
    await $("//input[@name = 'spouseSmiCb']").isSelected().then(function (value) {
        if (value == false) $("//label[contains(@id,'spouseSmiCb')]").click();
    })
});

When('Select Consent obtained from spouse Check Box on HI screen', async () => {
    await $("//input[@name = 'spouseConsentCb']").isSelected().then(function (value) {
        if (value == false) $("//label[contains(@id,'spouseConsentCb')]").click();
    })
});

When('verify data from {string} webtable', async (objName: string, table: DataTable) => {
    if (objName == "attestationTblId")
        await browser.pause(2000);
    else if (objName == "claimsTbl")
        await browser.pause(1000);
    else if (objName == "issueTable")
        await browser.pause(1000);

    table = TimeChanger.changeToAcutalTime(table, "Retirement", 1, 1, <Date>enrollCalc.dob);
    table = TimeChanger.changeToAcutalTime(table, "Attainment Age", 2, 1, <Date>enrollCalc.dob);
    await PageConfigHelper.changeFrame();
    await ElementHelper.scrollElementToMiddle(await $("#" + objName) as unknown as WebdriverIO.Element);
    let colhdrtext = await browser.execute("tableref = document.getElementById('" + objName + "').getElementsByTagName('th');var hdrArr=[];for (i = 0; i < tableref.length; i++) {hdrArr[i]=tableref[i].innerText.trim();} return hdrArr;");

    if (JSON.stringify(table.raw()[0]) != JSON.stringify(colhdrtext))
        throw new Error('col headers data is different with actual ' + JSON.stringify(colhdrtext) + 'and expected ' + JSON.stringify(table.raw()[0]));

    const rows = await browser.execute("return document.getElementById('" + objName + "').getElementsByTagName('tr').length") as unknown as number;
    const expRows = table.raw().length;
    if (rows == expRows) {
        for (var i = 1; i < rows; i++) {
            let actArray: any[];
            if (objName == 'issueTable')
                actArray = (await browser.execute("tableref = document.getElementById('" + objName + "').getElementsByTagName('tr').item(" + i + ").getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {var cellTxt=tableref[i].innerText.trim(); if(cellTxt=='') {cellTxt=tableref[i].getAttribute('value'); if(cellTxt==null) cellTxt=''} hdrRow[i]=cellTxt} return hdrRow;")) as unknown as any[];
            else
                actArray = (await browser.execute("tableref = document.getElementById('" + objName + "').getElementsByTagName('tr').item(" + i + ").getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {hdrRow[i]=tableref[i].innerText.trim();} return hdrRow;")) as unknown as any[];

            let expArray = JSON.stringify(table.raw()[i]);
            if (expArray.search("<HI_TYPE>") > 0) {
                let basis = (enrollCalcOutput[1] == 'F') ? "Age 65" : "";
                expArray = expArray.replace("<HI_TYPE>", basis);
            }
            if (expArray.search("<CURRENT_DATE>") > 0) {
                var today = new Date();
                var dd = String(today.getDate()).padStart(2, '0');
                var mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
                var yyyy = today.getFullYear();

                var objValue = mm + '/' + dd + '/' + yyyy;
                expArray = expArray.replace(/<CURRENT_DATE>/g, objValue);

                if (expArray.search("<CURRENT_DATE+") > 0) {
                    var today = new Date();
                    today.setDate(today.getDate() + 15);
                    var dd = String(today.getDate()).padStart(2, '0');
                    var mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
                    var yyyy = today.getFullYear();
                    var objValue = mm + '/' + dd + '/' + yyyy;
                    expArray = expArray.replace("<CURRENT_DATE+15>", objValue);
                }
            }
            else if (expArray.search("<HI_Start_Date>") > 0) {
                expArray = expArray.replace("<HI_Start_Date>", enrollCalcOutput[0]);
            }
            else if (expArray.search("<SMI_Start_Date>") > 0) {
                expArray = expArray.replace("<SMI_Start_Date>", enrollCalcOutput[3]);
                expArray = expArray.replace("<SMI_NCVRG_RTP_CD>", enrollCalcOutput[5]);
                expArray = expArray.replace("<SMI_DLAYD_ENRLT_RTP_CD>", enrollCalcOutput[6]);
            }
            else if (expArray.search("<Surcharge_Percentage>") > 0 && expArray.search("<Surcharge_Amount>") > 0 && expArray.search("<SMI_Base_Rate>") > 0) {
                let percentage: number = Number.parseFloat(enrollCalcOutput[4]);
                let SurchargePercentage: number = (percentage > 1) ? (percentage - 1) * 100 : 0;
                let totalAmount: number = Number.parseFloat(e2eConfig.SMIBaseRate);
                expArray = expArray.replace("<SMI_Base_Rate>", e2eConfig.SMIBaseRate);
                expArray = expArray.replace("<Surcharge_Percentage>", Math.round(SurchargePercentage).toFixed(0));
                expArray = expArray.replace("<Surcharge_Amount>", (Math.round(totalAmount * SurchargePercentage) / 100).toFixed(2));
                expArray = expArray.replace("<Payment_Method>", enrollCalcOutput[7]);
            }
            else if (expArray.search("<Third_Party>") > 0) {
                expArray = expArray.replace("<Third_Party>", enrollCalcOutput[11]);
            }
            else if (expArray.search("<CSA_Annuity>") > 0) {
                expArray = expArray.replace("<CSA_Annuity>", enrollCalcOutput[8]);
            }
            else if (expArray.search("<Medicaid>") > 0) {
                expArray = expArray.replace("<Medicaid>", enrollCalcOutput[9]);
            }
            else if (expArray.search("<Crime_Type>") > 0) {
                expArray = expArray.replace("<Crime_Type>", enrollCalcOutput[10]);
            }
            else if (objName == "grphealthplan" && enrollCalcOutput[14] != "") {
                expArray = ('["' + enrollCalcOutput[12] + '","' + enrollCalcOutput[13] + '","' + enrollCalcOutput[14] + '","' + enrollCalcOutput[13] + '","' + enrollCalcOutput[14] + '"]');
            }
            else if (objName == "grphealthplan" && enrollCalcOutput[12] == 'No information found.') {
                expArray = '["No information found."]';
            }
            if (expArray != JSON.stringify(actArray))
                throw new Error('row data is different with actual ' + JSON.stringify(actArray) + 'and expected ' + expArray);
        }
    }
    await PageConfigHelper.safeSwitchToParentFrame();
});

Then('Verify {string} PDF data generated from CCM', async (fileName: string) => {
    //id check
    await browser.pause(2000);
    let pdfManager = new PDFManager();

    const currentTime = TimeChanger.getActualTime("<CURRENT_DATE>", null, "MMMM D,yyyy");
    pdfManager.setDate(currentTime);
    pdfManager.setDob(TimeChanger.formatDateTime(<Date>enrollCalc.dob, "MMMM D,yyyy"));
    pdfManager.setName(pageVariables.getName);
    pdfManager.setSSN(pageVariables.getSSN);
    pdfManager.setResidentAddress(pageVariables.getResidentAddress);
    pdfManager.setMailAddres(pageVariables.getMailAddress);
    pdfManager.setPhoneNumber(pageVariables.getPhoneNumber);
    pdfManager.setBirthPlace(pageVariables.getBirthPlace);
    let addArr = pageVariables.getResidentAddress.split(",");
    pdfManager.setStreet(addArr[0]);
    pdfManager.setCity(addArr[1] + " " + addArr[2]);
    pdfManager.setMedicalEnrolment(enrollCalc.smiRefusalInd);
    pdfManager.setEnrolledinGHP(enrollCalc.enrolledinGHP);
    pdfManager.setMedicadeS(enrollCalc.medicadeStDate);
    let USCitizen = (pageVariables.citizenship && pageVariables.citizenship == "United States") ? "Yes" : "No";
    pdfManager.setUSCitizen(USCitizen);

    const downloadedPDFPath = pdfManager.getMostRecentDownloadedFile();
    const expectedTextFilePath = pdfManager.getTextFilePath(fileName);
    let isTwoFileSame: boolean = await pdfManager.compareTwoFile(expectedTextFilePath, downloadedPDFPath);
    expect(isTwoFileSame).to.equal(true);

});

//----------------------------------------------------------------------------------------------------------------------------------------------------------
//Changes added 05212021 for page tests
//----------------------------------------------------------------------------------------------------------------------------------------------------------
Then('system generates notice warning message with description {string}', async (errMsg: string) => {
    await browser.pause(2000);
    const element = await PageConfigHelper.findElement("Notice Warning Message", true) as unknown as WebdriverIO.Element;
    var expText = await ElementHelper.getText(element);
    expText = expText.replace("\n", "");
    assert.equal(expText, errMsg);
});

Then('system generates edit message with description {string}', async (errMsg: string) => {
    await browser.pause(2000);
    await PageConfigHelper.changeFrame();
    let errorMsgs = errMsg.split(';');
    let expText = '';
    const errorElems = await $$("//li[starts-with(@id,'uef-input-error-')]");
    const len = (errorElems as unknown as any[]).length;
    for (var i = 1; i <= len; i++) {
        var tmpText = await $("(//li[starts-with(@id,'uef-input-error-')])[" + i + "]").getText();
        if (i == 1)
            expText = tmpText;
        else
            expText = expText + '; ' + tmpText
    }
    PageConfigHelper.setCurrentPage("err");
    assert.equal(errMsg, expText);
    await PageConfigHelper.safeSwitchToParentFrame();
});

Then('system generates edit message with description {string} on {string} model', async (errMsg: string, modelId: string) => {
    await browser.pause(2000);
    let errorMsgs = errMsg.split(';');
    let expText = '';
    for (var i = 0; i < errorMsgs.length; i++) {
        var tmpText = await $("//*[@id='" + modelId + "']//*[@id='uef-input-error-" + i + "']").getText();
        if (i == 0)
            expText = tmpText;
        else
            expText = expText + '; ' + tmpText
    }
    assert.equal(errMsg, expText);
});

Then('system generates error message with description {string} in a frame', async (errMsg: string) => {
    await browser.pause(3000);
    await PageConfigHelper.changeFrame();
    let actualText = "";
    while (actualText == "") {
        const errorMessageElem = (await $$("//a[contains(@id, 'uef-error')]")) as unknown as WebdriverIO.ElementArray;
        for (let i = 0; i < errorMessageElem.length; i++) {
            actualText = actualText + await errorMessageElem[i].getText() + "; ";

        }
    }

    if (errMsg.trim() != actualText.trim()) {
        console.log(errMsg.trim())
        console.log(actualText.trim())
        let reportFolder = "./e2e/report/";
        await browser.takeScreenshot().then(function (png) {
            var dir = reportFolder + '/screenshot';
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const time = moment(new Date()).format("yyyy_MM_DD__HH_mm_ss_SSS");
            dir = dir + "/failure_" + time + ".png"
            var stream = fs.createWriteStream(dir);
            stream.write(Buffer.from(png, 'base64'));
            stream.end();
        });
    }
    assert.equal(errMsg.trim(), actualText.trim());
    await PageConfigHelper.safeSwitchToParentFrame();
});

Then('system generates error message with description {string} on Contact Info Manage Addresses screen', async (errMsg: string) => {
    const errorMsgsArray = errMsg.split(';');
    if ((PageConfigHelper.getCurrentPage() == "Person Info") || (PageConfigHelper.getCurrentPage() == "Contact Info")) {
        await browser.switchToFrame(await $('<iframe />'));
        await browser.switchToFrame(await $('<iframe />'));
        const screenErrorsArray = (await $$("//*[contains(@id, 'uef-error')]")) as unknown as WebdriverIO.ElementArray;
        for (let i = 1; i < screenErrorsArray.length; i++) {
            assert.equal(await screenErrorsArray[i].getText(), errorMsgsArray[i - 1].trim());

        }
    }
});

When('clicks on {string} button from {string} popup window', async (objName: string, popupWindowObj: string) => {
    const popupWinRef = await PageConfigHelper.findElement(popupWindowObj, false) as unknown as WebdriverIO.Element;
    //const buttonObj: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    await WaitHelper.getInstance().waitForElementToBeDisplayed(popupWinRef);
    const buttonref = await popupWinRef.$('*=' + objName) as unknown as WebdriverIO.Element;
    await buttonref.click();
});

When('verify {string} text is present in {string} popup window', async (txtName: string, popupWindowObj: string) => {
    const popupWinRef = await PageConfigHelper.findElement(popupWindowObj, false) as unknown as WebdriverIO.Element;
    await WaitHelper.getInstance().waitForElementToBeDisplayed(popupWinRef);
    //console.log(await popupWinRef.element(By.cssContainingText('*', txtName)).isDisplayed());
    assert.equal(await popupWinRef.$('*=' + txtName).isDisplayed(), true);
});


When('Click OK in popup window', async () => {
    await browser.acceptAlert();
});

When('verify {string} text is present in popup window', async (txtName: string) => {
    await browser.pause(1000)
    let alertText = await browser.getAlertText();
    assert.equal(alertText, txtName);
});


When('navigate to GN 00204.010 Protective Filing link on Filing Date screen', async () => {
    await $('=GN 00204.010 Protective Filing').click().then(async function () {

        const handles = await browser.getWindowHandles();
        await browser.switchToWindow(handles[1]);
        const title = await browser.getTitle();
        expect(title).to.equal('GN 00204.010 - Protective Filing');
        await browser.switchToWindow(handles[0]);
    });
});

Given('enters {string} text in {string} textbox in a frame', async (txtInput: string, elementName: string) => {
    if (txtInput.includes("<CURRENT_DATE")) {
        txtInput = TimeChanger.getActualTime(txtInput, new Date());
    } else if (txtInput.includes("<DOB")) {
        let time: Date = <Date>enrollCalc.dob;
        txtInput = TimeChanger.getActualTime(txtInput, time);
    }
    if (txtInput == "<blank>")
        return;
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(elementName, false) as unknown as WebdriverIO.Element;
    await TextboxHelper.sendKeys(element, txtInput, false);
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('click on {string} button in a frame', async (objName: string) => {
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await ElementHelper.click(element);
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('click on {string} Radio button in a frame', async (objName: string) => {
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await ElementHelper.clickRadioOrCheckbox(element);
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('click on {string} Checkbox in a frame', async (objName: string) => {
    if (objName == "<blank>")
        return;
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await CheckboxHelper.markCheckbox(element, true);
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('selects {string} from {string} Drop-down list in a frame', async (optionVal: string, objName: string) => {
    if (optionVal == "<blank>" || optionVal == "<Skip>")
        return;
    await PageConfigHelper.changeFrame();
    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    await DropDownHelper.selectOptionByText(element, optionVal);
    await PageConfigHelper.safeSwitchToParentFrame();
});

When('save Lawful Presence record', async () => {
    const saveLawfulStatus = await $$("//button[@id = 'okBtn']");
    await saveLawfulStatus[2].click();

});

Then('delete current Citizen Information entry', async function () {
    await browser.switchToFrame(await $('<iframe />'));
    const buttons = await $$("//input[contains(@id , 'delete')]");
    await buttons[1].click();
    await PageConfigHelper.safeSwitchToParentFrame();
});

Then('verify {string} label is displayed below date field', async (elementName: string) => {
    const element = await PageConfigHelper.findElement(elementName, false) as unknown as WebdriverIO.Element;
    await ElementHelper.scrollElementToMiddle(element);
    element.getText().then(function (text) {
        let today = new Date();
        let month = today.getMonth().toString();
        let str_month;
        if (month.length < 2)
            str_month = '0' + month
        else
            str_month = month

        let date = (month + 1) + '/' + today.getDate() + '/' + today.getFullYear();
        expect(text).to.equal(date);
    })
});

When('check if {string} text is present on the screen', async (txtName: string) => {
    const checkText: boolean = await $('*=' + txtName).isDisplayed();
    await assert.equal(checkText, true);
});

When('select {string} from Report of Contact Relationship to Claimant Drop-down', async (optionVal: string) => {
    const locator = await $("//select[@id = 'relationshipToClientType']") as unknown as WebdriverIO.Element;
    await locator.click();
    (await locator.$$('<option />')).forEach(function (item) {
        item.getText().then(function (values) {
            if (values == optionVal) item.click();
        })
    })
    await browser.pause(1000);
});

Given('User is on {string} CCE screen', async (screenName: string) => {
    await browser.pause(1500);
    if (screenName == "Claim Actions" || screenName == "Person Status" || screenName == "Claim Summary")
        await browser.pause(2000);
    else if (screenName == "Development Worksheet")
        await browser.pause(2000);
    else if (screenName == "Attestation and Printing")
        await browser.pause(2500);
    else if (screenName == "Determination") {
        //await browser.pause(3500);
        await WaitHelper.getInstance().waitForPageTitle(screenName);
    }

    else if (screenName == "Home Page")
        await WaitHelper.getInstance().waitForTitle('Claims Home - Consolidated Claims Experience');
    //else if(screenName=="Claim Summary")
    //    await WaitHelper.getInstance().waitForTitle('Claims Summary - Consolidated Claims Experience');
    //else if(screenName=="Claim Actions")
    //    await WaitHelper.getInstance().waitForTitle('Claim Actions - Consolidated Claims Experience');
    else if (screenName == "Applicant Information")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    //else if(screenName=="Person Status")
    //    await WaitHelper.getInstance().waitForTitle('Person Status - Consolidated Claims Experience');
    else if (screenName == "Person Info")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    else if (screenName == "Filing Date")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    else if (screenName == "Contact Info") {
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    }
    else if (screenName == "Earnings")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    else if (screenName == "Insured Status")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    else if (screenName == "Lawful Presence")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    else if (screenName == "Health Insurance")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    else if (screenName == "Individual Edits and Alert Messages")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Determination - Consolidated Claims Experience');
    else if (screenName == "Pre-Adjudicative Results")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
    //else if(screenName=="Attestation and Printing")
    //    await WaitHelper.getInstance().waitForTitle('Development - Consolidated Claims Experience');
    //else if(screenName=="Development Worksheet")
    //    await WaitHelper.getInstance().waitForTitle('Development - Consolidated Claims Experience');
    else if (screenName == "Development Notes")
        await WaitHelper.getInstance().waitForTitle('Development - Consolidated Claims Experience');
    else if (screenName == "Person Statement")
        await WaitHelper.getInstance().waitForTitle('Development - Consolidated Claims Experience');
    else if (screenName == "Report of Contact")
        await WaitHelper.getInstance().waitForTitle('Development - Consolidated Claims Experience');
    //else if(screenName=="Determinations")
    //    await WaitHelper.getInstance().waitForTitle('T2/T18 Determination - Consolidated Claims Experience');
    else if (screenName == "Adjudicative Overrides")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Determination - Consolidated Claims Experience');
    else if (screenName == "Adjudicative Results")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Determination - Consolidated Claims Experience');
    else if (screenName == "Determination Confirmation")
        await WaitHelper.getInstance().waitForTitle('T2/T18 Determination - Consolidated Claims Experience');

    PageConfigHelper.setCurrentPage(screenName);
});

When('clicks on Select All Address Types Checkbox', async () => {
    await browser.switchToFrame(await $('<iframe />'));
    await browser.switchToFrame(await $('<iframe />'));
    const alladdress = await $("//label[@id = 'uef-checklist0-selectAllLabel']");
    await alladdress.click();
    await PageConfigHelper.safeSwitchToParentFrame();
});

Then('system generates notice message with description {string}', async (errMsg: string) => {
    const errMsgs = errMsg.split(';');
    await PageConfigHelper.changeFrame();
    const screenMessage = (await $$("//*[contains(@class,'uef-notice ')]")) as unknown as WebdriverIO.ElementArray;
    for (let i = 0; i < screenMessage.length; i++) {
        const uiText = (await screenMessage[i].getText()).replace("\n", "").replace("\r", "").trim();
        assert.equal(errMsgs[i].trim(), uiText);
    }
    await PageConfigHelper.safeSwitchToParentFrame();
});

Then('system generates exclusion message with description {string}', async (errMsg: string) => {
    await browser.pause(1000);
    const element = await PageConfigHelper.findElement("Notice Message", true) as unknown as WebdriverIO.Element;
    var expText = await ElementHelper.getText(element);
    //expect(expText).to.eventually.equal(errMsg);
    assert.equal(expText, errMsg);
});
//-----------------------------------------------------------------------------------------------------------------------------------------------------------
//Values that the date function below will accept are below:
// where x and y are integers
// days and months can be small letters or CAPS
// "CURRENT_DATE"
// "CURRENT_DATE + x months and y days"
// "CURRENT_DATE + x DAYS"
// "CURRENT_DATE + x months"
// it returns date values in format below:
// mm/dd/yyyy
// mm/yyyy
//------------------------------------------------------------------------------------------------------------------------------------------------------------
Then('enters {string} date in {string} textbox', async (textVal: string, objName: string) => {
    let textValueArray: any;
    let arrayLength: Number;
    let dt: any;
    let dateVal: any;
    let currentPage: any;

    textValueArray = textVal.toUpperCase().split(" ");
    arrayLength = textValueArray.length;
    const currentDate = textValueArray[0];
    const opr = textValueArray[1];
    const opvalue = textValueArray[2];
    const dateParam = textValueArray[3];
    const andVal = textValueArray[4];
    const daysIntVal = textValueArray[5];
    const daysVal = textValueArray[6];

    const element = await PageConfigHelper.findElement(objName, false) as unknown as WebdriverIO.Element;
    let currDate: Date = new Date();
    const opts = { day: "2-digit", month: "2-digit", year: "numeric" };
    const opts_short = { month: "2-digit", year: "numeric" };
    if (arrayLength === 1) {
        dt = currDate;

    } else if (arrayLength === 4) {
        if (opr !== " " && opvalue !== " " && dateParam !== " ") {
            if (dateParam.toUpperCase() === "DAY>" || dateParam.toUpperCase() === "DAYS>") {
                if (opr === "+")
                    dt = currDate.setDate(currDate.getDate() + Number(opvalue));
                else if (opr === "-")
                    dt = currDate.setDate(currDate.getDate() - Number(opvalue));
            }
            else if (dateParam.toUpperCase() === "MONTH>" || dateParam.toUpperCase() === "MONTHS>") {
                if (opr === "+")
                    dt = currDate.setMonth(currDate.getMonth() + Number(opvalue));
                else if (opr === "-")
                    dt = currDate.setMonth(currDate.getMonth() - Number(opvalue));
            }
        }
    } else if (arrayLength === 7) {
        if (opr !== " " && opvalue !== " " && dateParam !== " " && andVal !== " " && daysIntVal !== " " && daysVal !== " ") {
            if (opr === "+") {
                dt = currDate.setMonth(currDate.getMonth() + Number(opvalue), currDate.getDay() + Number(daysIntVal));
            }
            else if (opr === "-") {
                dt = currDate.setMonth(currDate.getMonth() - Number(opvalue), currDate.getDay() - Number(daysIntVal));
            }
        }
    }
    // if (textVal == '<CURR_DATE>')
    //     dateVal = Intl.DateTimeFormat("en-US", opts_short).format(dt);
    // else if (textVal == '<CURRENT_DATE>')
    //     dateVal = Intl.DateTimeFormat("en-US", opts).format(dt);
    await TextboxHelper.sendKeys(element as WebdriverIO.Element, dateVal, false);
});

//-----------------------------------------------------------------------------------------------------------------------------------------------------------
//---Narasimha updates-------
When('input {string} text in {string} textbox', async (txtInput: string, elementName: string) => {
    const element = await PageConfigHelper.findElement(elementName, false) as unknown as WebdriverIO.Element;
    const today: Date = new Date();
    if (txtInput.search("CURRENT_DATE") > 0) {
        if (txtInput.search("0Y") > 0) {
            txtInput = TimeChanger.getActualTime(txtInput, today, "mm/yyyy");
        }
        else if (txtInput == "<CURRENT_DATE>" && elementName == "ProtectiveFilingDate") {
            txtInput = "";
        }
        else {
            txtInput = TimeChanger.getActualTime(txtInput, today, "mm/dd/yyyy");
        }

        if (txtInput != "") {
            await TextboxHelper.sendKeys(element, txtInput, false);
        }
    }
    else if (txtInput.search("DOB") > 0) {
        if (txtInput.search("0D") > 0) {
            txtInput = TimeChanger.getActualTime(txtInput, <Date>enrollCalc.dob, "mm/dd/yyyy");
        }
        else {
            txtInput = TimeChanger.getActualTime(txtInput, <Date>enrollCalc.dob, "mm/yyyy");
        }
        await TextboxHelper.sendKeys(element, txtInput, false);
    }
    else if (txtInput != "Continuing") {
        await TextboxHelper.sendKeys(element, txtInput, false);
    }
});
///Narasimha Enrollment CheckBox Element and Value
When('enters {string} for {string}', async (value: string, elementName: string) => {
    const element = await PageConfigHelper.findElement(elementName, false) as unknown as WebdriverIO.Element;
    if (value == "Yes") await CheckboxHelper.markCheckbox(element as WebdriverIO.Element, true);
});
//-----end of Narsimha updates--------


When('switch to {string} tab', async (tab1: string) => {
    let windowHandles = await browser.getWindowHandles();
    let num = windowHandles.length;
    console.log(num);
    await browser.switchToWindow(windowHandles[0]);

});

Then('User switches to SSIWeb application', async () => {
    await browser.pause(10000);
    let windowHandles = await browser.getWindowHandles();
    console.log("Total Handles :- " + windowHandles.length);
    let num = windowHandles.length > 1 ? 1 : 0;
    await browser.switchToWindow(windowHandles[num]);
    let title = await browser.getTitle();
    console.log("Child browser title :- " + title);
});

When('click on {string} button on {string} screen', async (value: string, screenName: string) => {
    if (screenName === "Report of Contact" && value === "Cancel") {
        const val = await $$("//button[@id = 'cancelBtn']");
        val[2].click();
    }
    else if (screenName === "Report of Contact" && value === "Close") {
        const val = await $$("//button[@id = 'okBtn']");
        val[3].click();
    }

});

When('User clicks on T2 {string} screen link', async (value: string) => {
    let linkVal: any;
    const elementArray: any = await $$("//a[@class = 'uef-menu_link']");
    if (value == "Disability")
        elementArray[5].click();
    else if (value == "Children")
        elementArray[5].click();
    else if (value == "Foreign Coverage")
        elementArray[8].click();
    else if (value == "Voluntary Tax Withholding")
        elementArray[15].click();
    else if (value == "Protective Filing Date")
        elementArray[1].click();
    else if (value == "Earnings")
        elementArray[6].click();
    else if (value == "SSI Status")
        elementArray[18].click();
    else if (value == "Applicant")
        elementArray[0].click();
});

//--------------------------------------------------------------------------------------------------------------------------------
//
//---------------------------------------------------------------------------------------------------------------------------------
When('check if Uninsured', async () => {
    const chktxt = "Worked last year or any time this year";
        const txtVal = (await $$("//*[text()[contains(.,'" + chktxt + "')]]")) as unknown as WebdriverIO.ElementArray;
        let checkText = false;
        for (let i = 0; i < txtVal.length; i++) {
            if (await txtVal[i].isDisplayed()) {
                checkText = true;
                break;
            }
        }
        if (checkText) await ElementHelper.clickwithElementName('radio_EarnsWorkdLastThisyrNo');
        else return;
});

When('click More Info link, and verify popup text', async (table: DataTable) => {
    const tableHash = table.hashes();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        const xpath = "(//a[contains(.,'More Info')])[" + tableHash[rowNum].linkNumber + "]" + " | " + "(//a[contains(.,'More info')])[" + tableHash[rowNum].linkNumber + "]";
        await ElementHelper.click(await $(xpath) as unknown as WebdriverIO.Element);
        const titles = (await $$("//*[contains(@id,'More_Info')]//uef-modal-header | //*[contains(@id,'help-modal')]//uef-modal-header")) as unknown as WebdriverIO.ElementArray;
        let actualTitle = ""
        for (let i = 0; i < titles.length; i++) {
            if (await titles[i].isDisplayed()) {
                actualTitle = await titles[i].getText();
                break;
            }
        }

        const texts = (await $$("//*[contains(@id,'More_Info')]//uef-modal-body | //*[contains(@id,'help-modal')]//uef-modal-body")) as unknown as WebdriverIO.ElementArray;
        let actualText = ""
        for (let i = 0; i < texts.length; i++) {
            if (await texts[i].isDisplayed()) {
                actualText = await texts[i].getText();
                break;
            }
        }
        await assert.isTrue(StringManipulationHelper.verifyTwoStringIncluded(actualTitle, tableHash[rowNum].expectedTitle), "actual is: " + actualTitle + ", expected is: " + tableHash[rowNum].expectedTitle);
        await assert.isTrue(StringManipulationHelper.verifyTwoStringIncluded(actualText, tableHash[rowNum].expectedText), "actual is: " + actualText + ", expected is: " + tableHash[rowNum].expectedText);

        const closeButtons = (await $$("//button[.='Close']")) as unknown as WebdriverIO.ElementArray;
        for (let i = 0; i < closeButtons.length; i++) {
            if (await closeButtons[i].isDisplayed() && await closeButtons[i].isClickable()) {
                await ElementHelper.click(closeButtons[i] as unknown as WebdriverIO.Element);
                break;
            }
        }
    }
});

When('verify {string} is not on {string} screen', async (value: string, screenName: string) => {
    if((value == "Add Tax Withholding Rate button") && (screenName == "Voluntary Tax Withholding")){
        const AddTaxRate = await PageConfigHelper.findElement("Add Tax Withholding Rate button", false) as unknown as WebdriverIO.Element;
        const val = await AddTaxRate.isExisting();
        await assert.isFalse(val);
    }
});
