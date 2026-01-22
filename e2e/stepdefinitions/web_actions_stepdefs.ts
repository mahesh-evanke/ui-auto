import { PageConfigHelper } from "../support/misc-utils/PageHelper";
import { DropDownHelper } from "../support/html-helpers/dropdown-helper";
import { ElementHelper } from "../support/html-helpers/element-helper";
import { TextboxHelper } from '../support/html-helpers/textbox-helper';
import { CheckboxHelper } from '../support/html-helpers/checkbox-helper';
import { WaitHelper } from '../support/html-helpers/wait-helper';
import { Given, Then, When, DataTable } from '@cucumber/cucumber';
import { CSVReader } from '../support/misc-utils/csv-reader';
import { EnrollCalcInput } from './appSpecific/EnrollCalcInput'
import { EnrollResultsCalc } from './appSpecific/EnrollResultsCalc'
import { PDFManager } from '../support/misc-utils/PDFManager';
import { TimeChanger } from '../support/misc-utils/TimeChanger';
import { PageVariables } from "../support/misc-utils/PageVariables";
import { PSCHelper } from '../support/misc-utils/PSCHelper';
import * as  fs from 'fs';
import { StringManipulationHelper } from "../support/misc-utils/string-manipulation-helper";
import moment = require("moment");

const e2eConfig = require('js-yaml').load(fs.readFileSync('e2e/config/config.yaml', 'utf8'));
const chai = require('chai').use(require('chai-as-promised'));
const expect = chai.expect;
const assert = chai.assert;
var enrollCalc: EnrollCalcInput = new EnrollCalcInput();
var pageVariables: PageVariables = new PageVariables();
var timeChanger: TimeChanger;
var enrollCalcOutput;

When('User are on scenare title {string}', async (title: string) => {
    console.log(title)
});

When('Verify field {string} text is {string}', async (filedName: string, expectedText: string) => {
    await PageConfigHelper.changeFrame();
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(filedName, false);
    let actualText: string = await element.getText();
    actualText = StringManipulationHelper.removeSepecial(actualText);
    expectedText = StringManipulationHelper.removeSepecial(expectedText);
    assert.equal(actualText, expectedText, "Filed " + filedName + " is not expected.");
    await browser.switchToParentFrame();
});

Given('enters {string} text in {string} textbox', async (txtInput: string, elementName: string) => {
    if (txtInput == "500 characters") {
        txtInput = StringManipulationHelper.createRandomString(500);
    } else if (txtInput == "501 characters") {
        txtInput = StringManipulationHelper.createRandomString(501);
    } else if (txtInput.includes("<CURRENT_DATE")) {
        txtInput = TimeChanger.getActualTime(txtInput, new Date());
    } else if (txtInput.includes("<DOB")) {
        let time: Date = <Date>enrollCalc.dob;
        txtInput = TimeChanger.getActualTime(txtInput, time);
    }
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(elementName, false);

    if ((PageConfigHelper.getCurrentPage() == "Person Info") || (PageConfigHelper.getCurrentPage() == "Contact Info")) {
        await browser.switchToFrame(await $('<iframe />'));
        if (txtInput != "<blank>")
            await TextboxHelper.sendKeys(element, txtInput, false);
        else if (txtInput == "<blank>")
            await TextboxHelper.clearText(element);
        await browser.switchToParentFrame();
    }
    else {
        if (txtInput != "<blank>")
            await TextboxHelper.sendKeys(element, txtInput, false);
        else if (txtInput == "<blank>")
            await TextboxHelper.clearText(element);
    }
});

When('User updates following information to pup up using {string}', async (buttonName: string, table: DataTable) => {
    var tableHash = table.hashes();
    for (var rowNum = 0; rowNum < tableHash.length; rowNum++) {
        for (let [key, value] of Object.entries(tableHash[rowNum])) {
            await PageConfigHelper.answerQuestions(key, value.toString(), <Date>enrollCalc.dob);
        }
        await PageConfigHelper.clickSaveButton();
    }
});

When('User adds following information to pup up using {string}', async (buttonName: string, table: DataTable) => {
    const tableHash = table.hashes();
    await PageConfigHelper.changeFrame();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        await ElementHelper.click(await PageConfigHelper.findElement(buttonName, false));
        for (let [key, value] of Object.entries(tableHash[rowNum])) {
            console.log(key + " ___:___ "+value)
            await PageConfigHelper.answerQuestions(key, value.toString(), <Date>enrollCalc.dob);
        }
        await PageConfigHelper.clickSaveButton();
    }
    await browser.switchToParentFrame();
});
When('click More Info link, and verfiy popup text', async (table: DataTable) => {
    const tableHash = table.hashes();
    await PageConfigHelper.changeFrame();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        const xpath = "(//a[contains(.,'More on order of priority')])[" + tableHash[rowNum].linkNumber + "]" + " | " + "(//a[contains(.,'More Info')])[" + tableHash[rowNum].linkNumber + "]" + " | " + "(//a[contains(.,'More info')])[" + tableHash[rowNum].linkNumber + "]";
        await ElementHelper.click(await $(xpath));
        let titles: WebdriverIO.ElementArray = await $$("//*[contains(@id,'More_Info')]//uef-modal-header | //*[contains(@id,'MoreInfo')]//uef-modal-header");
        let texts: WebdriverIO.ElementArray = await $$("//*[contains(@id,'More_Info')]//uef-modal-body  | //*[contains(@id,'MoreInfo')]//uef-modal-body");

        if (PageConfigHelper.getCurrentPage() == "Marriage") {
            await browser.switchToFrame(await $('<iframe />'));
            titles = await $$(".uef-container-row.hd.uef-container-separator");
            texts = await $$("//*[@class='uef-container-row']/div");
        }
        if (PageConfigHelper.getCurrentPage() == "Railroad" || PageConfigHelper.getCurrentPage() == "Spouse Railroad") {
            titles = await $$("//uef-modal-header");
            texts = await $$("//uef-modal-body");
        }
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

        let closeButtons: WebdriverIO.ElementArray = await $$("//button[.='Close']");
        if (PageConfigHelper.getCurrentPage() == "Marriage") {
            closeButtons = await $$("//body/a");
        }
        for (let i = 0; i < closeButtons.length; i++) {
            if (await closeButtons[i].isDisplayed() && await closeButtons[i].isClickable()) {
                await ElementHelper.click(closeButtons[i]);
                break;
            }
        }
        await browser.switchToParentFrame();
    }
});

When('click page link and verify new pages opens with title', async (table: DataTable) => {
    const tableHash = table.hashes();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        const xpath = '//a[.="' + tableHash[rowNum].LinkText + '"]';
        await ElementHelper.click(await $(xpath));
        const tabs = await browser.getWindowHandles();
        await browser.switchToWindow(tabs[1]);
        const actualTitle = await browser.getTitle();
        await assert.isTrue(StringManipulationHelper.verifyTwoStringIncluded(actualTitle, tableHash[rowNum].ExpectedTitle), "actual is: " + actualTitle + ", expected is: " + tableHash[rowNum].ExpectedTitle);
        await browser.closeWindow();
        await browser.switchToWindow(tabs[0]);
    }
});

When('User selects {string} link on Person Status screen', async (objName: string) => {
    const element: WebdriverIO.Element = await $("//a[contains(.,'" + objName + "')]");
    await ElementHelper.click(element);
});

When('User inputs information on the {string} screen if exist', async (objName: string, table: DataTable) => {
    const tableHash = table.hashes();
    await PageConfigHelper.changeFrame();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        for (let [key, value] of Object.entries(tableHash[rowNum])) {
            await PageConfigHelper.answerQuestions(key, value.toString(), <Date>enrollCalc.dob);
        }
    }
    await browser.switchToParentFrame();
});

When('User inputs information on the {string} screen', async (objName: string, table: DataTable) => {
    const tableHash = table.hashes();
    await PageConfigHelper.changeFrame();
    for (let rowNum = 0; rowNum < tableHash.length; rowNum++) {
        for (let [key, value] of Object.entries(tableHash[rowNum])) {
            await PageConfigHelper.answerQuestions(key, value.toString(), <Date>enrollCalc.dob);
        }
    }
    await browser.switchToParentFrame();
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
                let pgelement: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
                var objType = await pgelement.getAttribute('type');
                var objTagName = await pgelement.getTagName();
                if (objType == "text" && objTagName == "input") {
                    if (objValue.includes("<CURRENT_DATE")) {
                        objValue = TimeChanger.getActualTime(objValue, new Date());
                    } else if (objValue.includes("<DOB")) {
                        let time: Date = <Date>enrollCalc.dob;
                        if (time == null) {
                            time = new Date("5/10/1995");
                        }
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
                    const id = await (await PageConfigHelper.findElement(objName, false)).getValue();
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
        const id = await (await PageConfigHelper.findElement("PaymentMethodType", false)).getValue();
        const actual = await (await $("//option[@value='" + id + "']")).getText();
        assert.equal(actual, paymentMethodType);
    } else {
        for (const key in tables) {
            let actual = await (await $("//div[@class='uef-grid_unit_inner']/div//strong[.='" + key + "']/../div")).getText();
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
            let time: Date = <Date>enrollCalc.dob;
            if (time == null) {
                time = new Date("5/10/1995");
            }
            expected = TimeChanger.getActualTime(expected, time);
        }

        if ((tableHash[fieldNum].Value).toLowerCase() == "<blank>") continue;
        let locator = "//*[contains(text() , '" + tableHash[fieldNum].Field + "')]/..";
        let divs: WebdriverIO.ElementArray = await $$(locator);
        if (divs.length == 0) {
            let locator = "//*[text()[contains(., '" + tableHash[fieldNum].Field + "')]]/../..";
            divs = await $$(locator);
        }
        let uiText = null;
        for (let elemNum = 0; elemNum < divs.length; elemNum++) {
            if ((await divs[elemNum].getText()).startsWith("Hide ")) {
                continue;
            } else {
                let div: WebdriverIO.Element = divs[elemNum];
                while ((await div.getTagName()) != "div") {
                    div = await div.$("./..");
                }
                let texttElem: WebdriverIO.Element;
                if ((await div.$$(".//span[last()]")).length > 0) {
                    texttElem = await div.$(".//span[last()]");
                } else if ((await div.$$("./..//em[last()]")).length > 0) {
                    texttElem = await div.$("./..//em[last()]");
                } else {
                    texttElem = div;
                }
                uiText = (await texttElem.getText()).trim().replace(tableHash[fieldNum].Field, "").trim();
                if (uiText.length == 0) {
                    uiText = await (await div.$("(.//*)[last()]")).getText();
                }
                if (uiText.length == 0 && await (await div.$$("./..//input")).length > 0) {
                    uiText = await (await div.$("./..//input")).getValue();
                }
                if (uiText == expect) {
                    break;
                }
            }
        }
        assert.equal(uiText, expected);
    }
    await browser.switchToParentFrame();
});
When('enters SSN with criteria {string} in {string} textbox', async (criteriaName: string, ObjName: string) => {
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(ObjName, false);
    let ssn = CSVReader.getData(criteriaName);
    await TextboxHelper.sendKeys(element, ssn, false);
    enrollCalc = new EnrollCalcInput();
});

When('User clicks on {string} button', async (btnName: string) => {
    await PageConfigHelper.changeFrame();
    if (PageConfigHelper.getCurrentPage() == "Filing Date") {
        if (await $('#priorProtectiveFilingDate-option-false').isDisplayed()) {
            let flgDtTxt = await $$(".uef-container_row")[3].getText();
            enrollCalc.filingDate = flgDtTxt.split("Filing Date")[1];
        }
        else {
            const element: WebdriverIO.Element = await PageConfigHelper.findElement("ProtectiveFilingDate", false);
            enrollCalc.filingDate = await element.getAttribute("value");
        }
    } else if (PageConfigHelper.getCurrentPage() == "Health Insurance" && btnName == "Next") {
        await enrollCalc.setVariableValues();
    }
    const elementRef: WebdriverIO.Element = await PageConfigHelper.findElement(btnName, true);
    await ElementHelper.click(elementRef);
    await browser.switchToParentFrame();

});

Given('User is on {string} screen', async (screenName: string) => {
    await browser.pause(1000);
    if (screenName == "Claim Actions" || screenName == "Claim Summary" || screenName == "Pre-Adjudicative Results"
        || screenName == "Adjudicative Results" || screenName == "Advance Designation")
        await browser.pause(1000);
    console.log("currenScreenScrrenNanme " + screenName);
    if (screenName == 'Determination Confirmation') {
        await browser.pause(10);
    }
    await WaitHelper.getInstance().waitForPageTitle(screenName);
    if (screenName == "Person Info") {

        await browser.switchToFrame(await $('<iframe />'));
        const dobElem = $("//div[label[@for='dateofbirth']]/following-sibling::div");
        enrollCalc.dob = (await (await dobElem).getText()).trim();

        let ssn = await $("//div[@id='piwa-ssn']//div[@class='uef-pattern-content']").getText();
        pageVariables.setSSN = ssn.trim();
        let name = await $("//div[@id='piwa-name']//div[@class='uef-pattern-content']").getText();
        pageVariables.setName = name.trim();
        let birthPlace = await $("//label[@id='uef-place1PatternLabel']/../..//div[@class='uef-pattern-content']").getText();
        pageVariables.setBirthPlace = birthPlace.trim();
        let citizenship = await $("(//table[@summary='Citizenship Details']/tbody/tr)[1]/td[2]").getText();
        pageVariables.citizenship = citizenship.trim();
        await browser.switchToParentFrame();
    } else if (screenName == "Contact Info") {
        await browser.switchToParentFrame();
        await browser.switchToFrame(await $('<iframe />'));
        let mailAddressElem = $("//table[@summary='Addresses on Record']//div[contains(.,'T2/T18 Mailing')]/../..//div[contains(@id,'addressString')]");
        let mailAddress = await mailAddressElem.getText();
        let residenceAddress = await $("//table[@summary='Addresses on Record']//div[contains(.,'T2/T18 Residence')]/../..//div[contains(@id,'addressString')]").getText();
        let phoneNumber = await $("//input[@id='phonealt.number']").getAttribute("value");
        pageVariables.setMailAddress = mailAddress.trim();
        pageVariables.setResidentAddress = residenceAddress.trim();
        if (phoneNumber) { pageVariables.setPhoneNumber = phoneNumber?.trim() };
        await browser.switchToParentFrame();
    } else if (screenName == "Insured Status") {
        let actArray = await browser.execute("tableref = document.getElementById('periodinsuredstatus').getElementsByTagName('tr').item(1).getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {hdrRow[i]=tableref[i].innerText.trim();} return hdrRow;");
        enrollCalc.firstMonthInsured = actArray[1];
    } else if (screenName == "Pre-Adjudicative Results") {
        let temfldate = new Date(enrollCalc.filingDate);
        if (String(temfldate.getFullYear()) == "NaN") {
            let dobArray = await browser.execute("tableref = document.getElementById('PersonInfo').getElementsByTagName('tr').item(3).getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {hdrRow[i]=tableref[i].innerText.trim();} return hdrRow;");
            enrollCalc.dob = dobArray[1];
            let filinfdtTxt = <String>await browser.execute("return document.getElementsByClassName('uef-grid_unit_inner').item(11).innerText");
            let txtSplit = filinfdtTxt.split('\n');
            enrollCalc.filingDate = new Date(txtSplit[1]);
        }
        enrollCalcOutput = EnrollResultsCalc.getInstance().HICalculation(enrollCalc);
    }
});

When('clicks on {string} button', async (objName: string) => {
    if (objName == "<blank>")
        return;
    await PageConfigHelper.changeFrame();
    const elementRef: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    await ElementHelper.click(elementRef);
    await browser.switchToParentFrame();
});

When('selects {string} text from {string} Drop-down list', async (optionVal: string, objName: string) => {
    await browser.pause(500);
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    if (optionVal != "<Skip>") {
        if (PageConfigHelper.getCurrentPage() == "Person Info" || PageConfigHelper.getCurrentPage() == "Contact Info") {
            await browser.switchToFrame(await $('<iframe />'));
        }
        await DropDownHelper.selectOptionByText(element, optionVal);
        await browser.switchToParentFrame();

    } else {
        const today: Date = new Date();
        if (optionVal.search("0Y") > 0) {
            optionVal = TimeChanger.getActualTime(optionVal, today, "mm/yyyy");
        }
        await element.setValue(optionVal);
    }
});

When('selects {string} from {string} Drop-down list', async (optionVal: string, objName: string) => {
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    if (optionVal != "<Skip>") {
        if ((PageConfigHelper.getCurrentPage() == "Contact Info") || (PageConfigHelper.getCurrentPage() == "Person Info")) {
            await browser.switchToFrame(await $('<iframe />'));
            await DropDownHelper.selectOptionByText(element, optionVal);
            await browser.switchToParentFrame();
        }
        else
            await DropDownHelper.selectOptionByText(element, optionVal);
    }
});

When('verify {string} text is present on the screen', async (txtName: string) => {
    if (PageConfigHelper.getCurrentPage() == "Person Info" || PageConfigHelper.getCurrentPage() == "Contact Info" || PageConfigHelper.getCurrentPage() == "Marriage") {
        await browser.switchToFrame(await $('<iframe />'));
    }
    if (txtName == "<CURRENT_DATE>") {
        var today = new Date();
        var dd = String(today.getDate()).padStart(2, '0');
        var mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
        var yyyy = today.getFullYear();

        txtName = mm + '/' + dd + '/' + yyyy;
    }
    await WaitHelper.getInstance().waitForPageLabel(txtName);
    const elem = $("//*[text()[contains(.,'" + txtName + "')]]");
    await WaitHelper.getInstance().waitForElement(elem);
    assert.equal(await elem.isDisplayed(), true);
    await browser.switchToParentFrame();
});

Given('select {string} Checkbox', async (objName: string) => {
    var element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false, 'clickable');
    element=await element.$('..');
    await CheckboxHelper.markCheckbox(element, true);
});

Given('select {string} Checkbox with Wait', async (objName: string) => {
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false, 'clickable');
    await CheckboxHelper.markCheckboxWithWaitDisplay(element, true);
});

When('clicks on {string} Radio button', async (objName: string) => {
    if (PageConfigHelper.getCurrentPage() == "Person Info" || PageConfigHelper.getCurrentPage() == "Contact Info" || PageConfigHelper.getCurrentPage() == "Marriage") {
        await browser.switchToFrame(await $('<iframe />'));
    }
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    await ElementHelper.click(element);
    await browser.switchToParentFrame();
});

When('verify data from {string} web table', async (objName: string, table: DataTable) => {
    if (objName == "attestationTblId")
        await browser.pause(5000);
    else
        await browser.pause(1000);
    let colhdrtext = $$("//*[@id='" + objName + "']//table//th").map((result) => {
        return result.getText();
    });

    if (JSON.stringify(table.raw()[0]) != JSON.stringify(colhdrtext))
        throw new Error('col headers data is different with actual ' + JSON.stringify(colhdrtext) + 'and expected ' + JSON.stringify(table.raw()[0]));

    let rows = await $$("//*[@id='" + objName + "']//table//tr");
    await ElementHelper.scrollElementToMiddle(rows[0]);

    let expRows = table.raw().length;
    if (rows.length == expRows) {
        for (var i = 1; i < rows.length; i++) {
            let actArray = $$("//*[@id='" + objName + "']//table//th").map((result) => {
                return result.getText();
            });
            let expArray = JSON.stringify(table.raw()[i]);
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
                    expArray = expArray.replace("<CURRENT_DATE+15>", "");
                }
            }
            if (expArray != JSON.stringify(actArray))
                throw new Error('row data is different with actual ' + JSON.stringify(actArray) + 'and expected ' + expArray);
        }
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
            await ElementHelper.scrollElementToMiddle(await $(".uef-grid_unit_inner"));
            let gridObjTxt = <String>await browser.execute("return document.getElementsByClassName('uef-grid_unit_inner').item(" + j + ").innerText");
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
    let gridUnitsRef = await $$(".uef-grid_unit_inner");
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
            let gridObjRef = await gridUnitsRef[j];
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
    const element: WebdriverIO.Element = await PageConfigHelper.findElement("Alerts and Edits", false);
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
    let colhdrs = await $$("//*[@id='" + objName + "']//table//th");
    let colhdrtext = await $$("//*[@id='" + objName + "']//table//th").map((result) => {
        return result.getText();
    });


    let rows = await $$("//*[@id='" + objName + "']//table//tr");

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
                    let cell = await $("//*[@id='" + objName + "']//table//tr[" + i + "]/td[" + k + "]");
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
        element = await PageConfigHelper.findElement(objName, true);
    else
        element = await PageConfigHelper.findElement(objName, false);
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
                let pgelement: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
                var objType = await pgelement.getAttribute('type');
                var objTagName = await pgelement.getTagName();
                if (objType == "text" && objTagName == "input") {
                    if (objValue.includes("<CURRENT_DATE")) {
                        objValue = TimeChanger.getActualTime(objValue, new Date());
                    } else if (objValue.includes("<DOB")) {
                        let time: Date = <Date>enrollCalc.dob;
                        if (time == null) {
                            time = new Date("5/10/1995");
                        }
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
                        pgelement = await PageConfigHelper.findElement(objName + objValue, false);
                        await pgelement.$('./../..').click();
                    } else if (objValue.toLowerCase() == "on") {
                        await pgelement.$('./../..').click();
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
        const pgelement: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
        var objType = await pgelement.getAttribute('type');
        var objTagName = await pgelement.getTagName();
        if (objType == "text" && objTagName == "input")
            await TextboxHelper.sendKeys(pgelement, objValue, false);
        else if (objType == "checkbox" && objTagName == "input")
            await CheckboxHelper.markCheckbox(pgelement, true);
        else if (objType == "radio" && objTagName == "input") {
            await pgelement.$('./../..').click();
        }
        else if (objType == "button" && objTagName == "input") {
            await ElementHelper.click(pgelement);
        }
        else if (objTagName == "select")
            await DropDownHelper.selectOptionByText(pgelement, objValue);
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
    await $$('[name="okBtn"]').then(function (items) {
        items[4].click();
    })
});

When('User clicks on {string} link on Person Status screen', async (pageName: string) => {
    let lnks = await $$(".uef-link")[2];
    if (pageName == "Applicant Information")
        await lnks.click();
});

Given('clicks on Claims Summary button', async function () {
    await browser.pause(1000);
    await $$("//a[contains(@class,'uef-pro-nav-main_link')]").then(function (items) {
        items[1].click();
    })
});

When('clicks on {string} link with {string} instance', async (objName: string, instStr: string) => {
    //var element: WebdriverIO.Element;

    let eleLst = $$('.uef-icon-dropdown-btn.uef-dropdown-toggle');

    if (instStr == "Second")
        await ElementHelper.click(await eleLst[1]);
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
    await browser.switchToParentFrame();
});

//Page Chevron Control
When('clicks on {string} Chevron link', async (objName: string) => {
    const chevronLinks: WebdriverIO.ElementArray = await $$("//span[@class='uef-toggle_control-text']");
    for (let i = 0; i < chevronLinks.length; i++) {
        if ((await chevronLinks[i].getText()).includes(objName)) {
            await chevronLinks[i].click();
            break;
        }
    }
});

When('verifies status of {string} chevron link and {string} text in textbox', async (elementName: string, text: string) => {
    await browser.pause(1000);
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(elementName, false);
    const actualShow: boolean = await element.isDisplayed();
    assert.equal(actualShow, true);
    const actual = await element.getValue();
    assert.equal(actual, text);
});

When('User clicks on {string} link in Claim Development path', async (pageName: string) => {
    var lnks;
    if (pageName == "Development Notes")
        lnks = await $("(//a[@class='uef-menu_link'])[3]");
    else if (pageName == "Person Statement")
        lnks = await $("(//a[@class='uef-menu_link'])[4]");
    else if (pageName == "Report of Contact")
        lnks = await $("(//a[@class='uef-menu_link'])[5]");
    else if (pageName == "Adjudicative Results")
        lnks = await $("(//a[@class='uef-link'])[19]");
    else if (pageName == "Person Info")
        lnks = await $("(//a[@class='uef-menu_link'])[2]");
    await lnks.click();
});

When('Select from Person Providing Statement', async () => {
    await $("//select[@id = 'newRelationToClientTypeCode']").selectByAttribute("value", '02')
});

When('click on save button on Person Statement screen', async () => {
    let loc = await $$("//button[@id = 'uef-button-1']");
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
                let spinnerCtr = await browser.execute("return document.getElementsByName('spinner').length");
                if (spinnerCtr == '0')
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
    let element = await $("(//input[contains(@id, 'socialSecurityNumber')])[last()]");
    element.click();
    await TextboxHelper.sendKeys(element, inputValue, false);
    await browser.keys(['Tab'])
});

When('select Annuity from Civil Service Annuity Type Drop-down List', async () => {
    const loc: WebdriverIO.Element = await $("//select[@id = 'civilServiceAnnuityType']");
    await loc.click();
    await loc.$("//option[@value = 'CSA']").click();

});

Then('system generates notice messages with description {string}', async (errMsg: string) => {
    //await browser.pause(2000);
    //const element: WebdriverIO.Element = await PageConfigHelper.findElement("Notice Message", true);
    let errorMsgs = errMsg.split(';');
    let expText = '';
    var Objs = await $$('<uef-notice />');
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
        timeChanger = new TimeChanger(<Date>enrollCalc.dob, timeFormula);
        table.raw()[1][1] = timeChanger.getDateString("mm/dd/yyyy");
    }
    let rows = await browser.execute("return document.getElementById('" + objName + "').getElementsByTagName('tr').length");
    let expRows = table.raw().length;
    let actArray: any[];
    if (rows == expRows) {
        for (var i = 1; (i < (rows as number)); i++) {
            actArray = await browser.execute("tableref = document.getElementById('" + objName + "').getElementsByTagName('tr').item(" + i + ").getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {hdrRow[i]=tableref[i].innerText.trim();} return hdrRow;");
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
    await ElementHelper.scrollElementToMiddle(await $("#" + objName));
    let colhdrtext = await browser.execute("tableref = document.getElementById('" + objName + "').getElementsByTagName('th');var hdrArr=[];for (i = 0; i < tableref.length; i++) {hdrArr[i]=tableref[i].innerText.trim();} return hdrArr;");

    if (JSON.stringify(table.raw()[0]) != JSON.stringify(colhdrtext))
        throw new Error('col headers data is different with actual ' + JSON.stringify(colhdrtext) + 'and expected ' + JSON.stringify(table.raw()[0]));

    let rows = await browser.execute("return document.getElementById('" + objName + "').getElementsByTagName('tr').length");
    let expRows = table.raw().length;
    if (rows == expRows) {
        for (var i = 1; (i < (rows as number)); i++) {
            let actArray;
            if (objName == 'issueTable')
                actArray = await browser.execute("tableref = document.getElementById('" + objName + "').getElementsByTagName('tr').item(" + i + ").getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {var cellTxt=tableref[i].innerText.trim(); if(cellTxt=='') {cellTxt=tableref[i].getAttribute('value'); if(cellTxt==null) cellTxt=''} hdrRow[i]=cellTxt} return hdrRow;");
            else
                actArray = await browser.execute("tableref = document.getElementById('" + objName + "').getElementsByTagName('tr').item(" + i + ").getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {hdrRow[i]=tableref[i].innerText.trim();} return hdrRow;");

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
    await browser.switchToParentFrame();
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
    const element: WebdriverIO.Element = await PageConfigHelper.findElement("Notice Warning Message", true);
    var expText = await ElementHelper.getText(element);
    expText = expText.replace("\n", "");
    assert.equal(expText, errMsg);
});

Then('system generates edit message with description {string}', async (errMsg: string) => {
    await browser.pause(2000);
    await PageConfigHelper.changeFrame();
    let errorMsgs = errMsg.split(';');
    let expText = '';
    let len = (await $$("//li[starts-with(@id,'uef-input-error-')]")).length;
    for (var i = 1; i <= len; i++) {
        var tmpText = await $("(//li[starts-with(@id,'uef-input-error-')])[" + i + "]").getText();
        if (i == 1)
            expText = tmpText;
        else
            expText = expText + '; ' + tmpText
    }
    PageConfigHelper.setCurrentPage("err");
    assert.equal(errMsg, expText);
    await browser.switchToParentFrame();
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
        let errorMessageElem = await $$("//a[contains(@id, 'uef-error')]");
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
    await browser.switchToParentFrame();
});

Then('system generates error message with description {string} on Contact Info Manage Addresses screen', async (errMsg: string) => {
    const errorMsgsArray = errMsg.split(';');
    if ((PageConfigHelper.getCurrentPage() == "Person Info") || (PageConfigHelper.getCurrentPage() == "Contact Info")) {
        await browser.switchToFrame(await $('<iframe />'));
        await browser.switchToFrame(await $('<iframe />'));
        const screenErrorsArray = await $$("//*[contains(@id, 'uef-error')]");
        for (let i = 1; i < screenErrorsArray.length; i++) {
            assert.equal(await screenErrorsArray[i].getText(), errorMsgsArray[i - 1].trim());

        }
    }
});

When('clicks on {string} button from {string} popup window', async (objName: string, popupWindowObj: string) => {
    const popupWinRef: WebdriverIO.Element = await PageConfigHelper.findElement(popupWindowObj, false);
    //const buttonObj: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    await WaitHelper.getInstance().waitForElementToBeDisplayed(popupWinRef);
    const buttonref: WebdriverIO.Element = await popupWinRef.$('*=' + objName);
    await buttonref.click();
});

When('verify {string} text is present in {string} popup window', async (txtName: string, popupWindowObj: string) => {
    const popupWinRef: WebdriverIO.Element = await PageConfigHelper.findElement(popupWindowObj, false);
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
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(elementName, false);
    await TextboxHelper.sendKeys(element, txtInput, false);
    await browser.switchToParentFrame();
});

When('click on {string} button in a frame', async (objName: string) => {
    await PageConfigHelper.changeFrame();
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    await ElementHelper.click(element);
    await browser.switchToParentFrame();
});

When('click on {string} Radio button in a frame', async (objName: string) => {
    await PageConfigHelper.changeFrame();
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    await ElementHelper.click(element);
    await browser.switchToParentFrame();
});

When('click on {string} Checkbox in a frame', async (objName: string) => {
    if (objName == "<blank>")
        return;
    await PageConfigHelper.changeFrame();
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    await CheckboxHelper.markCheckbox(element, true);
    await browser.switchToParentFrame();
});

When('selects {string} from {string} Drop-down list in a frame', async (optionVal: string, objName: string) => {
    if (optionVal == "<blank>" || optionVal == "<Skip>")
        return;
    await PageConfigHelper.changeFrame();
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
    await DropDownHelper.selectOptionByText(element, optionVal);
    await browser.switchToParentFrame();
});

When('save Lawful Presence record', async () => {
    const saveLawfulStatus = await $$("//button[@id = 'okBtn']");
    await saveLawfulStatus[2].click();

});

Then('delete current Citizen Information entry', async function () {
    await browser.switchToFrame(await $('<iframe />'));
    const count = (await $$("//input[contains(@id , 'delete')]")).length;
    const buttons = await $$("//input[contains(@id , 'delete')]")
    await buttons[1].click();
    await browser.switchToParentFrame();
});

Then('verify {string} label is displayed below date field', async (elementName: string) => {
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(elementName, false);
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
    const locator: WebdriverIO.Element = await $("//select[@id = 'relationshipToClientType']");
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
    await browser.switchToParentFrame();
});

Then('system generates notice message with description {string}', async (errMsg: string) => {
    let errMsgs = errMsg.split(';');
    await PageConfigHelper.changeFrame();
    const screenMessage = await $$("//*[contains(@class,'uef-notice ')]");
    for (let i = 0; i < screenMessage.length; i++) {
        const uiText = (await screenMessage[i].getText()).replace("\n", "").replace("\r", "").trim();
        assert.equal(errMsgs[i].trim(), uiText);
    }
    await browser.switchToParentFrame();
});

Then('system generates exclusion message with description {string}', async (errMsg: string) => {
    await browser.pause(1000);
    const element: WebdriverIO.Element = await PageConfigHelper.findElement("Notice Message", true);
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

    const element: WebdriverIO.Element = await PageConfigHelper.findElement(objName, false);
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
    await TextboxHelper.sendKeys(element, dateVal, false);
});

//-----------------------------------------------------------------------------------------------------------------------------------------------------------
//---Narasimha updates-------
When('input {string} text in {string} textbox', async (txtInput: string, elementName: string) => {
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(elementName, false);
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
    const element: WebdriverIO.Element = await PageConfigHelper.findElement(elementName, false);
    if (value == "Yes") await CheckboxHelper.markCheckbox(element, true);
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
        const val: any = await $$("//button[@id = 'cancelBtn']");
        const arraySize = await val.length;
        val[2].click();
    }
    else if (screenName === "Report of Contact" && value === "Close") {
        const val: any = await $$("//button[@id = 'okBtn']");
        const arraySize = await val.length;
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
        let txtVal = await $$("//*[text()[contains(.,'" + chktxt + "')]]");
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
        await ElementHelper.click(await $(xpath));
        const titles: WebdriverIO.ElementArray = await $$("//*[contains(@id,'More_Info')]//uef-modal-header | //*[contains(@id,'help-modal')]//uef-modal-header");
        let actualTitle = ""
        for (let i = 0; i < titles.length; i++) {
            if (await titles[i].isDisplayed()) {
                actualTitle = await titles[i].getText();
                break;
            }
        }

        const texts: WebdriverIO.ElementArray = await $$("//*[contains(@id,'More_Info')]//uef-modal-body | //*[contains(@id,'help-modal')]//uef-modal-body");
        let actualText = ""
        for (let i = 0; i < texts.length; i++) {
            if (await texts[i].isDisplayed()) {
                actualText = await texts[i].getText();
                break;
            }
        }
        await assert.isTrue(StringManipulationHelper.verifyTwoStringIncluded(actualTitle, tableHash[rowNum].expectedTitle), "actual is: " + actualTitle + ", expected is: " + tableHash[rowNum].expectedTitle);
        await assert.isTrue(StringManipulationHelper.verifyTwoStringIncluded(actualText, tableHash[rowNum].expectedText), "actual is: " + actualText + ", expected is: " + tableHash[rowNum].expectedText);

        let closeButtons: WebdriverIO.ElementArray = await $$("//button[.='Close']");
        for (let i = 0; i < closeButtons.length; i++) {
            if (await closeButtons[i].isDisplayed() && await closeButtons[i].isClickable()) {
                await ElementHelper.click(closeButtons[i]);
                break;
            }
        }
    }
});

When('verify {string} is not on {string} screen', async (value: string, screenName: string) => {
    if((value == "Add Tax Withholding Rate button") && (screenName == "Voluntary Tax Withholding")){
        const AddTaxRate: WebdriverIO.Element = await PageConfigHelper.findElement("Add Tax Withholding Rate button", false);
        const val = await AddTaxRate.isExisting();
        await assert.isFalse(val);
    }
});
