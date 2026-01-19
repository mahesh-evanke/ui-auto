import * as path from 'path';
import { CheckboxHelper } from '../html-helpers/checkbox-helper';
import { DropDownHelper } from '../html-helpers/dropdown-helper';
import { ElementHelper } from '../html-helpers/element-helper';
import { TextboxHelper } from '../html-helpers/textbox-helper';
import { WaitHelper } from '../html-helpers/wait-helper';
import { JsonHelper } from '../misc-utils/json-helper';
import { TimeChanger } from './TimeChanger';
var EC = require("wdio-wait-for");

export class PageConfigHelper {
    private static current_page: string;
    private static scenario_name: string;
    public static sameScenarioSwitch: boolean;

    static setCurrentPage(pageName: string) {
        this.current_page = pageName;
    }

    static getCurrentPage() {
        return this.current_page;
    }

    static setScenarioName(scenarioName: string) {
        this.scenario_name = scenarioName;
    }

    static getScenarioName() {
        return this.scenario_name;
    }
    static async locator(elementStr: string, commonPageObj: boolean) {
        let dirPath = path.resolve('e2e/locators');
        let pageFilePath: string;
        if (commonPageObj == true)
            pageFilePath = path.join(dirPath, "common.json");
        else {
            let pageToInspect = PageConfigHelper.current_page + '.json';
            dirPath = path.resolve('e2e/locators/pages/');
            pageFilePath = path.join(dirPath, pageToInspect);
        }
        const elementtoFound = JsonHelper.getElement(pageFilePath, elementStr);
        if (elementtoFound) {
            return elementtoFound;
        }
        else
            throw new Error('Element with name:' + elementStr + ' not found in JSON');
    }

    static async locationPath(elementStr: string, commonPageObj: boolean) {
        const elementtoFound = await this.locator(elementStr, commonPageObj);
        let locator = "";
        if (elementtoFound[0] === 'xpath') {
            locator = elementtoFound[1];
        }
        else if (elementtoFound[0] === 'id') {
            locator = '#' + elementtoFound[1];
        }
        else if (elementtoFound[0] === 'name') {
            locator = '[name="' + elementtoFound[1] + '"]';
        }
        else if (elementtoFound[0] === 'tagName') {
            locator = '<' + elementtoFound[1] + ' />';
        }
        else if (elementtoFound[0] === 'linkText') {
            locator = '=' + elementtoFound[1];
        }
        else if (elementtoFound[0] === 'buttonText') {
            locator = '=' + elementtoFound[1];
        }
        else if (elementtoFound[0] === 'className') {
            locator = '.' + elementtoFound[1];
        } else {
            locator = '[' + elementtoFound[0] + '="' + elementtoFound[1] + '"]';
        }
        return locator;
    }

    static async findElements(elementStr: string, commonPageObj: boolean) {
        const locator = await this.locationPath(elementStr, commonPageObj);
        await browser.pause(400);
        return await $$(locator);
    }
    static async findElement(elementStr: string, commonPageObj: boolean, waitFormat: string = 'non') {
        const locator = await this.locationPath(elementStr, commonPageObj);
        if (waitFormat.toLowerCase().includes('click')) {
            await browser.waitUntil(EC.elementToBeClickable(locator), {
                timeout: 20000,
                timeoutMsg: "time out when wait to clickable: pageHelper 67."
            });
        }
        return await $(locator);
    }

    static async findTitle(screenName: string) {
        let dirPath = path.resolve('e2e/locators');
        let pageFilePath: string;
        pageFilePath = path.join(dirPath, "pages.json");
        const elementtoFound = JsonHelper.getElement(pageFilePath, screenName);
        if (elementtoFound)
            return elementtoFound[0];
        else
            return 'Element not found in JSON';
    }

    static navigateToUrl(pageName: string) {
        this.current_page = pageName;
        const pagePath = path.resolve('e2e/locators/pages.json');
        pageName = JsonHelper.getPage(pagePath, pageName);
        //browser.navigate().to(pageName);

    }

    public static async answerQuestions(key: string, value: string, dob: Date = new Date("5/10/1995")) {
        //console.log(key + " ___:___ "+value)
        let objValue = value.toString();
        if (objValue.toLowerCase() == "<blank>") {
            return;
        }
        if (key.toLocaleLowerCase().includes("scenario_title")) {
            console.log("scenario_title:    " + value);
            return;
        }
        const elements = await PageConfigHelper.findElements(key, false);
        if (elements.length == 0) {
            console.log("-----------------element not exist "+ key)
            return;
        }
        let display = false;
        let element;
        for (let elem of elements) {
            if (await elem.isDisplayed()) {
                element = elem;
                display = true;
                break;
            }
        }
        if (!display) {
            return;
        }
        //const element = (elements.length == 1) ? await PageConfigHelper.findElement(key, false) : elements[0];
        const objTagName = await element.getTagName();
        if (objTagName == "input") {
            var objType = await element.getAttribute('type');
            if (objType == "text") {
                objValue = objValue.replace("<space>", " ")
                if (objValue.includes("<CURRENT_DATE")) {
                    objValue = TimeChanger.getActualTime(objValue, new Date());
                }else if (objValue.includes("<CURRENT_MONTH")) {
                    objValue = objValue.replace("CURRENT_MONTH","CURRENT_DATE");
                    objValue = TimeChanger.getActualTime(objValue, new Date(),"MM/yyyy");
                }
                 else if (objValue.includes("<DOB")) {
                    objValue = TimeChanger.getActualTime(objValue, dob);
                }
                await TextboxHelper.sendKeys(element, objValue, false);
            } else if (objType == "tel") {
                await TextboxHelper.sendKeys(element, objValue, false);
            }
            else if (objType == "checkbox") {
                const check: boolean = objValue.toLocaleLowerCase().startsWith("check");
                await CheckboxHelper.markCheckbox(element, check);
            }
            else if (objType == "radio" && objTagName == "input") {
                await ElementHelper.click(element);
            }
            else if (objType == "button") {
                await ElementHelper.click(element);
            }

        } else if (objTagName == "select") {
            await DropDownHelper.selectOptionByText(element, objValue);
        } else if (objTagName.includes("radiolist")) {
            let locator = await PageConfigHelper.locator(key, false);
            let elem = null;
            if ((objValue.toLowerCase() == "yes")) {
                elem = await $("//input[@id='" + locator[1] + "-option-true']/../.. | //input[@id='" + locator[1] + "-option-yes']/../..");
            } else if (objValue.toLowerCase() == "no") {
                elem = await $("//input[@id='" + locator[1] + "-option-false']/../.. | //input[@id='" + locator[1] + "-option-no']/../..");
            } else {
                let labels = await element.$$('.//label');
                for (let i = 0; i < labels.length; i++) {
                    let mainId = await element.getAttribute("field-name");
                    let labelId = await labels[i].getAttribute("id");
                    let subId = labelId.substring((mainId.length + 8), (labelId.length - 6));
                    let labelText = await labels[i].getText();
                    if (subId.toLowerCase() == objValue.toLowerCase() || labelText.toLowerCase() == objValue.toLowerCase()) {
                        objValue = subId;
                        break;
                    }
                }
                let id = locator[1] + '-option-' + objValue;
                elem = await $("//input[@id='" + id + "']/../..");
            }
            await ElementHelper.click(elem);

        } else if (objTagName == "button") {
            if (elements.length != 1 && Number.isInteger(Number(objValue)) && Number(objValue) > 0) {
                const order = parseInt(objValue);
                await ElementHelper.click(elements[order - 1]);
            } else if (objValue.toLocaleLowerCase() == 'yes') {
                await ElementHelper.click(element);
            }
        } else if (objTagName == "textarea") {
            if (objValue.includes("<CURRENT_DATE")) {
                objValue = TimeChanger.getActualTime(objValue, new Date());
            } else if (objValue.includes("<DOB")) {
                objValue = TimeChanger.getActualTime(objValue, dob);
            }
            await TextboxHelper.sendKeys(element, objValue, false);
        }
    }

    public static async clickSaveButton() {
        await $$("//button[.='Save']").forEach(async element => {
            let needClick: boolean = true;
            if (needClick && await element.isDisplayed()) {
                await ElementHelper.click(element);
                needClick = false;
            }
        });
    }

    public static async handleChildrenPage(expectedPageName: string) {
        await WaitHelper.getInstance().waitForPageLoad("Children");
        PageConfigHelper.setCurrentPage("Children");
        if (expectedPageName == "Children")
            return;
        await ElementHelper.click(await $("#childrenMeetingListConditions-option-false-label"));
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
    }

    public static async handleDisabilityPage(expectedPageName: string) {
        await WaitHelper.getInstance().waitForPageLoad("Disability");
        await PageConfigHelper.setCurrentPage("Disability");
        if (expectedPageName == "Disability")
            return;
        await PageConfigHelper.answerQuestions("Radio_Unable_to_Work", "No");
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
    }

    public static async handleEarningsPage(expectedPageName: string) {
        await WaitHelper.getInstance().waitForPageLoad("Earnings");
        await PageConfigHelper.setCurrentPage("Earnings");
        if (expectedPageName == "Earnings")
            return;
        await ElementHelper.clickwithElementName('radio_AgreeEarningsYes');
        await ElementHelper.clickwithElementName('radio_EarnsOtherSSNNo');
        await ElementHelper.clickwithElementName('radio_EarnsWorkdLastThisyrNo');
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
    }

    public static async changeFrame() {
        await browser.switchToParentFrame();
        if (PageConfigHelper.getCurrentPage() == "Marriage" || PageConfigHelper.getCurrentPage() == "Advance Designation") {
            await browser.switchToFrame(await $('<iframe />'));
        }
        if (PageConfigHelper.getCurrentPage() == "Person Info" || PageConfigHelper.getCurrentPage() == "Contact Info") {
            await browser.switchToFrame(await $('<iframe />'));
            await browser.switchToFrame(await $('<iframe />'));
        }
    }
}
