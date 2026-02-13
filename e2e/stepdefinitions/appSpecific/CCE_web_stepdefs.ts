/**
 * CCE/Medicare app-specific step definitions and screen load handlers.
 * Registers handlers invoked by generic "User is on screen" step.
 */
import { registerScreenLoadHandler } from '../../support/misc-utils/ScreenLoadHandlers';
import { enrollCalc, pageVariables, setEnrollCalcOutput, syncDobToScenarioContext } from './CCE_context';
import { EnrollResultsCalc } from './EnrollResultsCalc';

registerScreenLoadHandler(async (screenName: string) => {
    if (screenName === 'Person Info') {
        await browser.switchToFrame(await $('<iframe />'));
        const dobElem = $("//div[label[@for='dateofbirth']]/following-sibling::div");
        enrollCalc.dob = (await (await dobElem).getText()).trim();
        syncDobToScenarioContext();
        const ssn = await $("//div[@id='piwa-ssn']//div[@class='uef-pattern-content']").getText();
        pageVariables.setSSN = ssn.trim();
        const name = await $("//div[@id='piwa-name']//div[@class='uef-pattern-content']").getText();
        pageVariables.setName = name.trim();
        const birthPlace = await $("//label[@id='uef-place1PatternLabel']/../..//div[@class='uef-pattern-content']").getText();
        pageVariables.setBirthPlace = birthPlace.trim();
        const citizenship = await $("(//table[@summary='Citizenship Details']/tbody/tr)[1]/td[2]").getText();
        pageVariables.citizenship = citizenship.trim();
        await browser.switchToParentFrame();
    } else if (screenName === 'Contact Info') {
        await browser.switchToParentFrame();
        await browser.switchToFrame(await $('<iframe />'));
        const mailAddressElem = $("//table[@summary='Addresses on Record']//div[contains(.,'T2/T18 Mailing')]/../..//div[contains(@id,'addressString')]");
        const mailAddress = await mailAddressElem.getText();
        const residenceAddress = await $("//table[@summary='Addresses on Record']//div[contains(.,'T2/T18 Residence')]/../..//div[contains(@id,'addressString')]").getText();
        const phoneNumber = await $("//input[@id='phonealt.number']").getAttribute('value');
        pageVariables.setMailAddress = mailAddress.trim();
        pageVariables.setResidentAddress = residenceAddress.trim();
        if (phoneNumber) pageVariables.setPhoneNumber = phoneNumber.trim();
        await browser.switchToParentFrame();
    } else if (screenName === 'Insured Status') {
        const actArray = await browser.execute("tableref = document.getElementById('periodinsuredstatus').getElementsByTagName('tr').item(1).getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {hdrRow[i]=tableref[i].innerText.trim();} return hdrRow;");
        enrollCalc.firstMonthInsured = actArray[1];
    } else if (screenName === 'Pre-Adjudicative Results') {
        const temfldate = new Date(enrollCalc.filingDate);
        if (String(temfldate.getFullYear()) === 'NaN') {
            const dobArray = await browser.execute("tableref = document.getElementById('PersonInfo').getElementsByTagName('tr').item(3).getElementsByTagName('td');var hdrRow=[];for (i = 0; i < tableref.length; i++) {hdrRow[i]=tableref[i].innerText.trim();} return hdrRow;");
            enrollCalc.dob = dobArray[1];
            syncDobToScenarioContext();
            const filinfdtTxt = await browser.execute("return document.getElementsByClassName('uef-grid_unit_inner').item(11).innerText") as unknown as string;
            const txtSplit = filinfdtTxt.split('\n');
            enrollCalc.filingDate = new Date(txtSplit[1]);
        }
        setEnrollCalcOutput(EnrollResultsCalc.getInstance().HICalculation(enrollCalc));
    }
});
