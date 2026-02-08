
import { config } from '../../config/wdio.conf';
import { PageConfigHelper } from "../../support/misc-utils/PageHelper";
import { DropDownHelper } from "../../support/html-helpers/dropdown-helper";
import { ElementHelper } from "../../support/html-helpers/element-helper";
import { TextboxHelper } from '../../support/html-helpers/textbox-helper';
import { CheckboxHelper } from '../../support/html-helpers/checkbox-helper';
import { WaitHelper } from '../../support/html-helpers/wait-helper';
import { CSVReader } from '../../support/misc-utils/csv-reader';
import { Given, When } from '@cucumber/cucumber';
import { EnrollCalcInput } from './EnrollCalcInput';

const chai = require('chai').use(require('chai-as-promised'));
const expect = chai.expect;

Given('Set page name to {string}', async (pageName: string) => {
    PageConfigHelper.setCurrentPage(pageName);
})

//FUNC01
Given('User navigates to {string} screen to Establish New Medicare claim', async (pageName: string) => {
    if (PageConfigHelper.getCurrentPage() !== pageName) {
        await browser.url(config.baseUrl);
        await browser.maximizeWindow();
        await WaitHelper.getInstance().waitForPageTitle(pageName);
    }
})


//FUNC01
Given('Go to page {string}', async (pageName: string) => {
    var lnks = await $("//a[@class='uef-menu_link' and . = '" + pageName + "']");
    await lnks.click();
    await WaitHelper.getInstance().waitForPageLoad(pageName);
})


//FUNC02
Given('User navigates to T2 RIB {string} screen for an new claim with {string} test data criteria', async (pageName: string, criteria: string) => {
    if (PageConfigHelper.getCurrentPage() !== pageName) {
        await browser.url(config.baseUrl);
        await browser.maximizeWindow();
        await WaitHelper.getInstance().waitForPageTitle('Home Page');
        if (pageName == 'Home Page')
            return;
        await TextboxHelper.sendKeyswithElementName('Office Code', 'A15', false);
        let ssn = CSVReader.getData(criteria);
        await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await WaitHelper.getInstance().waitForPageLoad("Claim Summary");
        if (pageName == 'Claim Summary')
            return;

        let newEstablesh = await $$("#btnEstablishMedClaim");
        let claimSSN = await $$("//input[contains(@id , 'uef-generated-id')]");
        if ((await newEstablesh.length) == 0 && (await claimSSN.length) == 1) {
            const Claim_SSN= await PageConfigHelper.findElement("claim ssn", false);
            await CheckboxHelper.markCheckbox(Claim_SSN, true);
            const NextButtonElement= await PageConfigHelper.findElement("Next", true);
            await ElementHelper.click(NextButtonElement);
            await WaitHelper.getInstance().waitForPageLoad("Claim Actions");
            PageConfigHelper.setCurrentPage("Claim Actions");
            const Update= await PageConfigHelper.findElement("Update", false);
            await ElementHelper.click(Update);
            const claimDeletion= await PageConfigHelper.findElement("Claim Deletion", false);
            await ElementHelper.click(claimDeletion);
            await ElementHelper.click(NextButtonElement);
            await WaitHelper.getInstance().waitForPageLabel("Are you sure you want to delete this claim");
            await ElementHelper.click(await $("//*[@id='deleteClaimModal']//*[@id='delete-coverage']"));
            await WaitHelper.getInstance().waitForPageTitle('Home Page');
            await browser.refresh();
            await browser.url(config.baseUrl);
            await WaitHelper.getInstance().waitForPageTitle('Home Page');
            await TextboxHelper.sendKeyswithElementName('Office Code', 'A15', false);
            await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
            await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
            await WaitHelper.getInstance().waitForPageLoad("Claim Summary");
        }

        await ElementHelper.clickwithElementName('Establish New Medicare Claim');
        await WaitHelper.getInstance().waitForPageLoad('Applicant Information');
        PageConfigHelper.setCurrentPage("Applicant Information");
        if (pageName == "Applicant Information")
            return;
        const lst_AppType= await PageConfigHelper.findElement("Applicant Type", false);
        await DropDownHelper.selectOptionByText(lst_AppType, "Claimant");
        await browser.pause(1000);
        const lst_ContactMethod= await PageConfigHelper.findElement("Contact Method", false);
        await DropDownHelper.selectOptionByText(lst_ContactMethod, "IN OFFICE VISIT");
        const chk_PrivacyAct= await PageConfigHelper.findElement("Privacy Act", false);
        await CheckboxHelper.markCheckbox(chk_PrivacyAct, true);
        const nextButton= await PageConfigHelper.findElement('Next', true);
        await ElementHelper.click(nextButton);
        await WaitHelper.getInstance().waitForPageLoad("Protective Filing Date");
        if (pageName == "Filing Date" || pageName == "Protective Filing Date") {
            let dobString = "";
            switch (ssn) {
                case "126909900":
                    {
                        dobString = "08/06/1955";
                        break;
                    }
                case "042569705":
                    {
                        dobString = "06/19/1948";
                        break;
                    }
                case "132864403":
                    {
                        dobString = "04/01/1955";
                        break;
                    }

                default:

            }
            if (!new EnrollCalcInput().dob) {
                new EnrollCalcInput().dob = new Date(dobString);
            }
            return;
        }
        await $('#priorProtectiveFilingDate-option-false-label').click();
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await WaitHelper.getInstance().waitForPageLoad("Person Info");
        if (pageName == "Person Info")
            return;
        await browser.switchToFrame(await $('<iframe />'));
        const birthText = "Birth Date Proof is required";
        let birthtexts = await $$("//*[text()[contains(.,'" + birthText + "')]]");
        let checkBirthText = false;
        for (let i = 0; i < (await birthtexts.length); i++) {
            if (await birthtexts[i].isDisplayed()) {
                checkBirthText = true;
                break;
            }
        }
        if (checkBirthText) {
            const btnIdentityEdit= await PageConfigHelper.findElement("Edit_Identity_Button", false);
            await ElementHelper.click(btnIdentityEdit);
            let birthproofCodeLst= await PageConfigHelper.findElement("Birth Proof Code List", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Preferred Proof (Public or religious record of age established before age 5) (B)");
            birthproofCodeLst = await PageConfigHelper.findElement("Birth Proof Type List", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Pre-age 5 State, Local or Foreign Public Birth Certificate (P)");
            const submitButton= await PageConfigHelper.findElement("bttn_Accept", false);
            await ElementHelper.click(submitButton);
        }
        var enrollCalc: EnrollCalcInput = new EnrollCalcInput();
        enrollCalc.dob = new Date((await (await PageConfigHelper.findElement("BirthDateValue", false)).getText()).trim());

        const citizenText = "Citizenship details are required";
        let Citizentexts = await $$("//*[text()[contains(.,'" + citizenText + "')]]");
        let checkCitizenText = false;
        for (let i = 0; i < (await Citizentexts.length); i++) {
            if (await Citizentexts[i].isDisplayed()) {
                checkCitizenText = true;
                break;
            }
        }
        if (checkCitizenText) {
            const btnIdentityEdit= await PageConfigHelper.findElement("Edit_Citizenship_button", false);
            await ElementHelper.click(btnIdentityEdit);
            const addCitizenshipBtn= await PageConfigHelper.findElement("AddCitizen", false);
            await ElementHelper.click(addCitizenshipBtn);
            await browser.pause(1000);
            await browser.switchToFrame(await $('<iframe />'));
            const uscitizenship= await PageConfigHelper.findElement("radio_USCitizenYes", false);
            await ElementHelper.click(uscitizenship);
            let birthproofCodeLst= await PageConfigHelper.findElement("Listbox_USCitizen", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Birth in U.S.");
            let citizenProofLst= await PageConfigHelper.findElement("Listbox_US_Proof_Code", false);
            await DropDownHelper.selectOptionByText(citizenProofLst, "U.S. Passport");
            const citizenshipEnded= await PageConfigHelper.findElement("CitizenshipEndedNo", false);
            await ElementHelper.click(citizenshipEnded);
            const submitButton= await PageConfigHelper.findElement("bttn_OK", false);
            await ElementHelper.click(submitButton);
            await browser.switchToParentFrame();
            const saveCitizenInformation= await PageConfigHelper.findElement("bttn_Save_Citizen", false);
            await ElementHelper.click(saveCitizenInformation);
        }
        const addressText = "T18 Residence address is required";
        let texts = await $$("//*[text()[contains(.,'" + addressText + "')]]");
        let checkAddressText = false;
        for (let i = 0; i < (await texts.length); i++) {
            if (await texts[i].isDisplayed()) {
                checkAddressText = true;
                break;
            }
        }
        if (checkAddressText) {
            const EditContact= await PageConfigHelper.findElement("Edit_Contact", false);
            await ElementHelper.click(EditContact);
            const addNewAddress= await PageConfigHelper.findElement("AddNewAddress", false);
            await ElementHelper.click(addNewAddress);
            await browser.switchToFrame(await $('<iframe />'));
            await TextboxHelper.sendKeyswithElementName('Line_1', '6 Charles street', false);
            await TextboxHelper.sendKeyswithElementName('City', 'Baltimore', false);
            const stateSelect= await PageConfigHelper.findElement("State", false);
            await DropDownHelper.selectOptionByText(stateSelect, "Maryland");
            await TextboxHelper.sendKeyswithElementName('Zip', '21201', false);
            const alladdress = await $("//label[@id = 'uef-checklist0-selectAllLabel']");
            await alladdress.click();
            await TextboxHelper.sendKeyswithElementName('Current T2/T18 Residence Start Date', '02/02/1998', false);
            const clickOK= await PageConfigHelper.findElement("Save", false);
            await ElementHelper.click(clickOK);
            await browser.pause(1000);
            await ElementHelper.clickwithElementName('Recommended USPS standard format');
            const clickOKNewAddress= await PageConfigHelper.findElement("Add New Address OK", false);
            await ElementHelper.click(clickOKNewAddress);
            await browser.switchToParentFrame();
            const spokenlang= await PageConfigHelper.findElement("SpokenLanguagePreference", false);
            await DropDownHelper.selectOptionByText(spokenlang, "English");
            const writtenLang= await PageConfigHelper.findElement("WrittenLanguagePreference", false);
            await DropDownHelper.selectOptionByText(writtenLang, "Bosnian");
            await ElementHelper.clickwithElementName('Save');
            await browser.switchToParentFrame();
            await browser.switchToFrame(await $('<iframe />'));
        }
        const spokenLang = "Spoken Language Preference is required";
        let lang = await $$("//*[text()[contains(.,'" + spokenLang + "')]]");
        let checkspokenLangText = false;
        for (let i = 0; i < (await lang.length); i++) {
            if (await lang[i].isDisplayed()) {
                checkspokenLangText = true;
                break;
            }
        }
        if (checkspokenLangText) {
            const EditContact= await PageConfigHelper.findElement("Edit_Contact", false);
            await ElementHelper.click(EditContact);
            const spokenlangchk= await PageConfigHelper.findElement("SpokenLanguagePreference", false);
            await DropDownHelper.selectOptionByText(spokenlangchk, "English");
            const writtenLang= await PageConfigHelper.findElement("WrittenLanguagePreference", false);
            await DropDownHelper.selectOptionByText(writtenLang, "Bosnian");
            await ElementHelper.clickwithElementName('Save');
            await browser.switchToParentFrame();
            await browser.switchToFrame(await $('<iframe />'));
        }
        const SNO_No= await PageConfigHelper.findElement("radio_SNONo", false);
        await ElementHelper.click(SNO_No);
        const acceptButton= await PageConfigHelper.findElement("Accept", false);
        await ElementHelper.click(acceptButton);
        await browser.switchToParentFrame();
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        const chkPage = "Lawful Presence";
        let pageVal = await $$("//*[text()[contains(.,'" + chkPage + "')]]");
        let checkPageText = false;
        for (let i = 0; i < (await pageVal.length); i++) {
            if (await pageVal[i].isDisplayed()) {
                checkPageText = true;
                break;
            }
        }
        if (checkPageText) {
            PageConfigHelper.setCurrentPage("Lawful Presence");
            const newLawfulbutton= await PageConfigHelper.findElement("AddNew", false);
            await ElementHelper.click(newLawfulbutton);
            const statusdropdown= await PageConfigHelper.findElement("listbox_LawfulStatus", false);
            await DropDownHelper.selectOptionByText(statusdropdown, "Lawfully Admitted for Permanent Residence (LAPR)");
            const startDateTextbox= await PageConfigHelper.findElement("Edit_StartDt", false);
            await TextboxHelper.sendKeys(startDateTextbox, "02/02/1998", false);
            await ElementHelper.clickwithElementName('radio_StatusEnded_No');
            const proofDropdownbox= await PageConfigHelper.findElement("List_Proof_Yes", false);
            await DropDownHelper.selectOptionByText(proofDropdownbox, "Proof provided");
            const saveLawfulStatus = await $$("//button[@id = 'okBtn']");
            await saveLawfulStatus[1].click();
            await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
            //            await browser.pause(4000);
        }
        await PageConfigHelper.handleChildrenPage(pageName);
        if (pageName == "Children")
            return;
        await PageConfigHelper.handleDisabilityPage(pageName);
        if (pageName == "Disability")
            return;
        await PageConfigHelper.handleEarningsPage(pageName);
        if (pageName == "Earnings")
            return;
        await WaitHelper.getInstance().waitForPageLoad("Insured Status");
        let lnks;
        if (pageName == "Spouse Railroad") {
            lnks = await $("//a[@class='uef-menu_link' and . = 'Railroad Spouse']");
        } else {
            lnks = await $("//a[@class='uef-menu_link' and . = '" + pageName + "']");
        }
        await lnks.click();
        await WaitHelper.getInstance().waitForPageLoad(pageName);

    }
})

//FUNC03
Given('User navigates to T2 RIB {string} screen for an existing claim with {string} test data criteria', async (pageName: string, criteria: string) => {
    if (PageConfigHelper.getCurrentPage() !== pageName) {
        await browser.url(config.baseUrl);
        await browser.maximizeWindow();
        await WaitHelper.getInstance().waitForTitle('Claims Home - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Home Page");
        if (pageName == "Home Page")
            return;
        const officeCodeElement= await PageConfigHelper.findElement("Office Code", false);
        const SSNElement= await PageConfigHelper.findElement("SSN", false);
        const NextButtonElement= await PageConfigHelper.findElement("Next", true);
        await TextboxHelper.sendKeys(officeCodeElement, "A15", false);
        let ssn = CSVReader.getData(criteria);
        await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForTitle('Claims Summary - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Claim Summary");
        if (pageName == "Claim Summary")
            return;
        const Claim_SSN= await PageConfigHelper.findElement("claim ssn", false);
        await CheckboxHelper.markCheckbox(Claim_SSN, true);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForTitle('Claim Actions - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Claim Actions");
        if (pageName == "Claim Actions")
            return;
        const Update= await PageConfigHelper.findElement("Update", false);
        await ElementHelper.click(Update);
        const claimInfo= await PageConfigHelper.findElement("Claim Information", false);
        await ElementHelper.click(claimInfo);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForPageTitle("Person Status");
        PageConfigHelper.setCurrentPage("Person Status");
        let lnks;
        if (pageName == "Disability") {
            lnks = await $("//uef-link[@aria-label = 'Disability']");
        }
        else if (pageName == "Children") {
            lnks = await $("//uef-link[@aria-label = 'Children']");
        } else if (pageName == "Marriage") {
            lnks = await $("//uef-link[@aria-label = 'Marriage']");
        } else if (pageName == "Payment Method") {
            lnks = await $("//a[contains(.,'Payment Method')]");
        }else if (pageName == "Spouse Railroad") {
            lnks = await $("//a[contains(.,'Railroad Spouse')]");
        } else {

            await (await $("//a[contains(.,'Pre-Adjudicative Results')]")).click();
            await browser.pause(2000);
            lnks = await $("//a[contains(.,'" + pageName + "')]");
        }
        await lnks.click();
        return;
    }
});

//FUNC04
Given('User navigates to T2 RIB {string} screen for an existing claim in Query Mode with {string} test data criteria', async (pageName: string, criteria: string) => {
    if (PageConfigHelper.getCurrentPage() !== pageName) {
        await browser.url(config.baseUrl);
        await browser.maximizeWindow();
        await WaitHelper.getInstance().waitForTitle('Claims Home - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Home Page");
        if (pageName == "Home Page")
            return;
        const officeCodeElement= await PageConfigHelper.findElement("Office Code", false);
        const SSNElement= await PageConfigHelper.findElement("SSN", false);
        const NextButtonElement= await PageConfigHelper.findElement("Next", true);
        await TextboxHelper.sendKeys(officeCodeElement, "A15", false);
        let ssn = CSVReader.getData(criteria);
        await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForTitle('Claims Summary - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Claim Summary");
        if (pageName == "Claim Summary")
            return;
        const Claim_SSN= await PageConfigHelper.findElement("claim ssn", false);
        await CheckboxHelper.markCheckbox(Claim_SSN, true);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForTitle('Claim Actions - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Claim Actions");
        if (pageName == "Claim Actions")
            return;
        const Query= await PageConfigHelper.findElement("Query", false);
        await ElementHelper.click(Query);
        const claimInfo= await PageConfigHelper.findElement("Claim Information", false);
        await ElementHelper.click(claimInfo);
        await ElementHelper.click(NextButtonElement);
        PageConfigHelper.setCurrentPage("Person Status");
        var lnks = await $("//uef-link[@aria-label = '" + pageName + "']");
        await lnks.click();
    }
})

//FUNC05
When('User goes to {string} screen for a new claim with {string} test data criteria case', async (pageName: string, criteria: string) => {
    //Claim Information
    if (PageConfigHelper.getCurrentPage() !== pageName) {
        await browser.url(config.baseUrl);
        await browser.maximizeWindow();
        await WaitHelper.getInstance().waitForPageTitle('Home Page');
        if (pageName == 'Home Page')
            return;

        await TextboxHelper.sendKeyswithElementName('Office Code', 'A15', false);
        let ssn = CSVReader.getData(criteria);
        await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await WaitHelper.getInstance().waitForPageLoad("Claim Summary");
        if (pageName == 'Claim Summary')
            return;
        await ElementHelper.clickwithElementName('Establish New Medicare Claim');
        await WaitHelper.getInstance().waitForPageLoad('Applicant Information');
        PageConfigHelper.setCurrentPage("Applicant Information");
        if (pageName == "Applicant Information")
            return;
        const lst_AppType= await PageConfigHelper.findElement("Applicant Type", false);
        await DropDownHelper.selectOptionByText(lst_AppType, "Claimant");
        const lst_ContactMethod= await PageConfigHelper.findElement("Contact Method", false);
        await browser.pause(1000);
        await DropDownHelper.selectOptionByText(lst_ContactMethod, "IN OFFICE VISIT");
        const chk_PrivacyAct= await PageConfigHelper.findElement("Privacy Act", false);
        await CheckboxHelper.markCheckbox(chk_PrivacyAct, true);
        const nextButton= await PageConfigHelper.findElement('Next', true);
        await ElementHelper.click(nextButton);
        await WaitHelper.getInstance().waitForPageLoad("Person Info");
        if (pageName == "Person Info")
            return;
        await browser.switchToFrame(await $('<iframe />'));
        let birthText = "Birth Date Proof is required";
        let checkBirthText: boolean = await $('*=' + birthText).isDisplayed();
        if (checkBirthText) {
            const btnIdentityEdit= await PageConfigHelper.findElement("Edit_Identity_Button", false);
            await ElementHelper.click(btnIdentityEdit);
            let birthproofCodeLst= await PageConfigHelper.findElement("Birth Proof Code List", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Preferred Proof (Public or religious record of age established before age 5) (B)");
            birthproofCodeLst = await PageConfigHelper.findElement("Birth Proof Type List", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Pre-age 5 State, Local or Foreign Public Birth Certificate (P)");
            const submitButton= await PageConfigHelper.findElement("bttn_Accept", false);
            await ElementHelper.click(submitButton);
        }
        let citizenText = "Citizenship details are required";
        let checkCitizenText: boolean = await $('*=' + citizenText).isDisplayed();
        if (checkCitizenText) {
            const btnIdentityEdit= await PageConfigHelper.findElement("Edit_Citizenship_button", false);
            await ElementHelper.click(btnIdentityEdit);
            const addCitizenshipBtn= await PageConfigHelper.findElement("AddCitizen", false);
            await ElementHelper.click(addCitizenshipBtn);
            await browser.pause(1000);
            await browser.switchToFrame(await $('<iframe />'));
            const uscitizenship= await PageConfigHelper.findElement("radio_USCitizenYes", false);
            await ElementHelper.click(uscitizenship);
            let birthproofCodeLst= await PageConfigHelper.findElement("Listbox_USCitizen", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Birth in U.S.");
            let citizenProofLst= await PageConfigHelper.findElement("Listbox_US_Proof_Code", false);
            await DropDownHelper.selectOptionByText(citizenProofLst, "U.S. Passport");
            const citizenshipEnded= await PageConfigHelper.findElement("CitizenshipEndedNo", false);
            await ElementHelper.click(citizenshipEnded);
            const submitButton= await PageConfigHelper.findElement("bttn_OK", false);
            await ElementHelper.click(submitButton);
            await browser.switchToParentFrame();
            await browser.switchToFrame(await $('<iframe />'));
            const saveCitizenInformation= await PageConfigHelper.findElement("bttn_Save_Citizen", false);
            await ElementHelper.click(saveCitizenInformation);
        }
        const SNO_No= await PageConfigHelper.findElement("radio_SNONo", false);
        await ElementHelper.click(SNO_No);
        const acceptButton= await PageConfigHelper.findElement("Accept", false);
        await ElementHelper.click(acceptButton);
        await browser.switchToParentFrame();
        await WaitHelper.getInstance().waitForPageLoad("Filing Date");
        if (pageName == "Filing Date")
            return;
        await $('#priorProtectiveFilingDate-option-false-label').click();
        //    await $('#priorProtectiveFilingDate-option').click();
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await WaitHelper.getInstance().waitForPageLoad("Contact Info");
        PageConfigHelper.setCurrentPage("Contact Info");
        if (pageName == "Contact Info")
            return;
        const addressText = "T2/T18 Residence address is required";
        await browser.switchToFrame(await $('<iframe />'));
        let checkAddressText: boolean = await $('*=' + addressText).isDisplayed();
        if (checkAddressText) {
            const addNewAddress= await PageConfigHelper.findElement("AddNewAddress", false);
            await ElementHelper.click(addNewAddress);
            await browser.switchToFrame(await $('<iframe />'));
            const allMailcheckBox= await PageConfigHelper.findElement("Select All Address Types", false);
            const clickOKNewAddress= await PageConfigHelper.findElement("Add New Address OK", false);
            const clickOK= await PageConfigHelper.findElement("Save", false);
            const stateSelect= await PageConfigHelper.findElement("State", false);
            await TextboxHelper.sendKeyswithElementName('Line_1', '6 Charles street', false);
            await TextboxHelper.sendKeyswithElementName('City', 'Baltimore', false);
            await DropDownHelper.selectOptionByText(stateSelect, "Maryland");
            await TextboxHelper.sendKeyswithElementName('Zip', '21201', false);
            //            await CheckboxHelper.markCheckbox(allMailcheckBox,true);
            const alladdress = await $("//label[@id = 'uef-checklist0-selectAllLabel']");
            await alladdress.click();
            await TextboxHelper.sendKeyswithElementName('Current T2/T18 Residence Start Date', '02/02/1998', false);
            await ElementHelper.click(clickOK);
            await browser.pause(1000);
            await ElementHelper.clickwithElementName('Recommended USPS standard format');
            await ElementHelper.click(clickOKNewAddress);
            await browser.switchToParentFrame();
            await browser.switchToFrame(await $('<iframe />'));
        }
        const spokenlang= await PageConfigHelper.findElement("SpokenLanguagePreference", false);
        const writtenLang= await PageConfigHelper.findElement("WrittenLanguagePreference", false);
        await DropDownHelper.selectOptionByText(spokenlang, "English");
        await DropDownHelper.selectOptionByText(writtenLang, "Bosnian");
        await ElementHelper.clickwithElementName('Save');
        await browser.switchToParentFrame();
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Earnings");
        await browser.pause(4000);
        if (pageName == "Earnings")
            return;
        await ElementHelper.clickwithElementName('radio_AgreeEarningsYes');
        await ElementHelper.clickwithElementName('radio_EarnsOtherSSNNo');
        let txtName = "Did you work last year or any time this year?";
        let checkNotinsured: boolean = await $('*=' + txtName).isDisplayed();
        if (checkNotinsured)
            await ElementHelper.clickwithElementName('radio_EarnsWorkdLastThisyrNo');
        const clickNext= await PageConfigHelper.findElement("Next", true);
        await ElementHelper.click(clickNext);
        await WaitHelper.getInstance().waitForPageTitle("Insured Status");
        PageConfigHelper.setCurrentPage("Insured Status");
        if (pageName == "Insured Status")
            return;
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await browser.pause(3000);
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        let currentPageIndicator: boolean = await $('*=Lawful Presence').isDisplayed();
        if (currentPageIndicator) {
            PageConfigHelper.setCurrentPage("Lawful Presence");
            if (pageName == "Lawful Presence")
                return;
            const newLawfulbutton= await PageConfigHelper.findElement("AddNew", false);
            const statusdropdown= await PageConfigHelper.findElement("listbox_LawfulStatus", false);
            const startDateTextbox= await PageConfigHelper.findElement("Edit_StartDt", false);
            const proofDropdownbox= await PageConfigHelper.findElement("List_Proof_Yes", false);
            const saveLawfulStatus = await $$("//button[@id = 'okBtn']");
            await ElementHelper.click(newLawfulbutton);
            await DropDownHelper.selectOptionByText(statusdropdown, "Lawfully Admitted for Permanent Residence (LAPR)");
            await startDateTextbox.sendKeyEvent("02/02/1998");
            await ElementHelper.clickwithElementName('radio_StatusEnded_No');
            await DropDownHelper.selectOptionByText(proofDropdownbox, "Proof provided");
            await saveLawfulStatus[1].click();
            await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
            await browser.pause(4000);
        }
        PageConfigHelper.setCurrentPage("Health Insurance");
        if (pageName === "Health Insurance")
            return;
        const EnrollOptionsDropDown= await PageConfigHelper.findElement("SMIEnrollmentOptions", false);
        await DropDownHelper.selectOptionByText(EnrollOptionsDropDown, "Enroll");
        await ElementHelper.clickwithElementName('ReceivingMedicaidNo');
        await ElementHelper.clickwithElementName('ReceivingAnnuityNo');
        await ElementHelper.clickwithElementName('SpouseAnnuity_No');
        await ElementHelper.clickwithElementName('GroupHealthPlanNo');
        await ElementHelper.clickwithElementName('ClaimantEligibility');
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await browser.pause(3000);
        //        await WaitHelper.getInstance().waitForPageTitle("Induvidual Edits and Alerts");
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        //        await browser.sleep(2000);
        PageConfigHelper.setCurrentPage("Induvidual Edits and Alerts");
        if (pageName == "Induvidual Edits and Alerts")
            return;
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await browser.pause(3000);
        //        await WaitHelper.getInstance().waitForPageTitle("Pre-Adjudicative Results");
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Pre-Adjudicative Results");
        if (pageName == "Pre-Adjudicative Results")
            return;
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await WaitHelper.getInstance().waitForPageLabel("Medicare");
        PageConfigHelper.setCurrentPage("Attestation and Printing");
        if (pageName == "Attestation and Printing")
            return;
        const addSigAttestation= await PageConfigHelper.findElement("AddSignatureandAttestation", false);
        const understandCheckbox= await PageConfigHelper.findElement("Understand Affirmation", false);
        const decalreCheckbox= await PageConfigHelper.findElement("Declare Affirmation", false);
        const empAttestationCheckbox= await PageConfigHelper.findElement("EmpAttestation", false);
        const saveAttestationButton= await PageConfigHelper.findElement("Save", false);
        await ElementHelper.click(addSigAttestation);
        await ElementHelper.clickwithElementName('radio_SignatureTypeOral');
        await CheckboxHelper.markCheckbox(understandCheckbox, true);
        await CheckboxHelper.markCheckbox(decalreCheckbox, true);
        await CheckboxHelper.markCheckbox(empAttestationCheckbox, true);
        await ElementHelper.click(saveAttestationButton);
        await browser.pause(10000);
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));

        await WaitHelper.getInstance().waitForTitle('Development - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Development Worksheet");
        if (pageName == "Development Worksheet")
            return;

        await browser.switchToParentFrame();
        await $("#unitCodeText").setValue("122");
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await browser.pause(2000);
        //await WaitHelper.getInstance().waitForPageTitle('Claim Summary');
        PageConfigHelper.setCurrentPage("Claim Summary");
        const Claim_SSN= await PageConfigHelper.findElement("claim ssn", false);
        await CheckboxHelper.markCheckbox(Claim_SSN, true);
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await browser.pause(2000);
        //await WaitHelper.getInstance().waitForPageTitle('Claim Actions');
        PageConfigHelper.setCurrentPage("Claim Actions");
        const Update= await PageConfigHelper.findElement("Update", false);
        const claimInfo= await PageConfigHelper.findElement("Claim Information", false);
        await ElementHelper.click(Update);
        await ElementHelper.click(claimInfo);
        await ElementHelper.click(await PageConfigHelper.findElement('Next', true));
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Person Status');
        PageConfigHelper.setCurrentPage("Person Status");
        let devNotes = await $$(".uef-link")[12];
        await devNotes.click();
        await WaitHelper.getInstance().waitForPageTitle('Development Notes');
        PageConfigHelper.setCurrentPage("Development Notes");
        if (pageName == "Development Notes")
            return;
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Claim Summary');
        PageConfigHelper.setCurrentPage("Claim Summary");
        await CheckboxHelper.markCheckbox(Claim_SSN, true);
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Claim Actions');
        PageConfigHelper.setCurrentPage("Claim Actions");
        await ElementHelper.click(Update);
        await ElementHelper.click(claimInfo);
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Person Status');
        PageConfigHelper.setCurrentPage("Person Status");
        var lnks = await $$(".uef-link")[13];
        await lnks.click();
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Person Statement');
        PageConfigHelper.setCurrentPage("Person Statement");
        if (pageName == "Person Statement")
            return;
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Claim Summary');
        PageConfigHelper.setCurrentPage("Claim Summary");
        await CheckboxHelper.markCheckbox(Claim_SSN, true);
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Claim Actions');
        PageConfigHelper.setCurrentPage("Claim Actions");
        await ElementHelper.click(Update);
        await ElementHelper.click(claimInfo);
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Person Status');
        PageConfigHelper.setCurrentPage("Person Status");
        var lnks = await $$(".uef-link")[14];
        await lnks.click();
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Report of Contact');
        PageConfigHelper.setCurrentPage("Report of Contact");
        if (pageName == "Report of Contact")
            return;
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Claim Summary');
        PageConfigHelper.setCurrentPage("Claim Summary");
        await CheckboxHelper.markCheckbox(Claim_SSN, true);
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Claim Actions');
        PageConfigHelper.setCurrentPage("Claim Actions");
        await ElementHelper.click(Update);
        await ElementHelper.click(claimInfo);
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForPageTitle('Person Status');
        PageConfigHelper.setCurrentPage("Person Status");
        var lnks = await $$(".uef-link")[15];
        await lnks.click();
        await WaitHelper.getInstance().waitForPageTitle('Determination');
        PageConfigHelper.setCurrentPage("Determination");
        if (pageName == "Determination")
            return;
        await TextboxHelper.sendKeyswithElementName('Employee Job Title', 'TO', false);
        await ElementHelper.click(nextButton);
        browser.pause(2000);
        await WaitHelper.getInstance().waitForTitle('T2/T18 Determination - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Individual Edits and Alert Messages");
        await browser.pause(2000);
        await ElementHelper.click(nextButton);
        await browser.pause(2000);
        await WaitHelper.getInstance().waitForTitle('T2/T18 Determination - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Adjudicative Results");
        await ElementHelper.click(nextButton);
        browser.pause(2000);
        //Claim Determination
        await WaitHelper.getInstance().waitForTitle('T2/T18 Determination - Consolidated Claims Experience');
        PageConfigHelper.setCurrentPage("Determination Confirmation");
        if (pageName == "Determination Confirmation")
            return;
        const closeConfirmButton= await PageConfigHelper.findElement("bttn_Close", false);
        await ElementHelper.clickwithElementName('Radio_ConfirmDeterm');
        await ElementHelper.click(nextButton);
        browser.pause(2000);
        await ElementHelper.click(closeConfirmButton);
        await WaitHelper.getInstance().waitForPageTitle('Claim Summary');
        PageConfigHelper.setCurrentPage("Claim Summary");
        const exitButton= await PageConfigHelper.findElement("Exit", true);
        await ElementHelper.click(exitButton);
        await WaitHelper.getInstance().waitForPageTitle('Exit CCE');
        PageConfigHelper.setCurrentPage("Exit CCE");
        if (pageName == "Exit CCE")
            return;
        const closeButton= await PageConfigHelper.findElement("Close", false);
        await ElementHelper.click(closeButton);
    }
});

//FUNC06
Given('User navigates to {string} screen for an existing pending claim with {string} test data criteria case', async (pageName: string, criteria: string) => {
    await browser.url(config.baseUrl);
    await browser.maximizeWindow();
    //    await browser.sleep(2000);
    await WaitHelper.getInstance().waitForTitle('Claims Home - Consolidated Claims Experience');
    //   await WaitHelper.getInstance().waitForPageTitle('Home Page');
    //   await expect(browser.getTitle()).to.eventually.equal('Claims Home - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Home Page");
    if (pageName == "Home Page")
        return;
    const officeCodeElement= await PageConfigHelper.findElement("Office Code", false);
    const SSNElement= await PageConfigHelper.findElement("SSN", false);
    const NextButtonElement= await PageConfigHelper.findElement("Next", true);
    await TextboxHelper.sendKeys(officeCodeElement, "A15", false);
    let ssn = CSVReader.getData(criteria);
    await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
    await ElementHelper.click(NextButtonElement);
    await WaitHelper.getInstance().waitForTitle('Claims Summary - Consolidated Claims Experience');
    //    await expect(browser.getTitle()).to.eventually.equal('Claims Summary - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Claim Summary");
    if (pageName == "Claim Summary")
        return;
    const Claim_SSN= await PageConfigHelper.findElement("claim ssn", false);
    await CheckboxHelper.markCheckbox(Claim_SSN, true);
    await ElementHelper.click(NextButtonElement);
    await WaitHelper.getInstance().waitForTitle('Claim Actions - Consolidated Claims Experience');
    //    await expect(browser.getTitle()).to.eventually.equal('Claim Actions - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Claim Actions");
    if (pageName == "Claim Actions")
        return;
    const Update= await PageConfigHelper.findElement("Update", false);
    const claimInfo= await PageConfigHelper.findElement("Claim Information", false);
    await ElementHelper.click(Update);
    await ElementHelper.click(claimInfo);
    await ElementHelper.click(NextButtonElement);
    await browser.pause(6000);
    //    await WaitHelper.getInstance().waitForTitle('Person Status - Consolidated Claims Experience');
    //    await expect(browser.getTitle()).to.eventually.equal('Person Status - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Person Status");

    if (pageName == "Application Information") {
        var lnks = await $("//uef-link[@aria-label = 'Applicant Information']");
    }
    else if (pageName == "Person Info") {
        var lnks = await $("//uef-link[@aria-label = 'Person Information']");
    }
    else if (pageName == "Filing Date") {
        var lnks = await $("//uef-link[@aria-label = 'Filing Date']");
    }
    else if (pageName == "Contact Info") {
        var lnks = await $("//uef-link[@aria-label = 'Contact Information']");
    }
    else if (pageName == "Earnings") {
        var lnks = await $("//uef-link[@aria-label = 'Earnings Information']");
    }
    else if (pageName == "Insured Status") {
        var lnks = await $("//uef-link[@aria-label = 'Insured Status']");
    }
    else if (pageName == "Lawful Presence") {
        var lnks = await $("//uef-link[@aria-label = 'Lawful Presence']");
    }
    else if (pageName == "Health Insurance") {
        var lnks = await $("//uef-link[@aria-label = 'Health Insurance']");
    }
    else if (pageName == "Attestation and Printing") {
        var lnks = await $("//uef-link[@aria-label = 'Attestation and Printing']");
    }
    else if (pageName == "Development Worksheet") {
        var lnks = await $("//uef-link[@aria-label = 'Development Worksheet']");
    }
    else if (pageName == "Development Notes") {
        var lnks = await $("//uef-link[@aria-label = 'Development Notes']");
    }
    else if (pageName == "Person Statement") {
        var lnks = await $("//uef-link[@aria-label = 'Person Statement']");
    }
    else if (pageName == "Report of Contact") {
        var lnks = await $("//uef-link[@aria-label = 'Report of Contact']");
    }
    else if (pageName == "Determination") {
        var lnks = await $("//uef-link[@aria-label = 'Determinations']");
    }
    await lnks.click();
})

//FUNC07
When('User goes to {string} screen in Query Mode with {string} test data criteria case', async (pageName: string, criteria: string) => {
    //Claim Information
    await browser.url(config.baseUrl);
    await browser.maximizeWindow();
    await WaitHelper.getInstance().waitForTitle('Claims Home - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Home Page");
    if (pageName == "Home Page")
        return;
    const officeCodeElement= await PageConfigHelper.findElement("Office Code", false);
    const SSNElement= await PageConfigHelper.findElement("SSN", false);
    const NextButtonElement= await PageConfigHelper.findElement("Next", true);
    await TextboxHelper.sendKeys(officeCodeElement, "A15", false);
    let ssn = CSVReader.getData(criteria);
    await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
    await ElementHelper.click(NextButtonElement);
    await WaitHelper.getInstance().waitForTitle('Claims Summary - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Claim Summary");
    if (pageName == "Claim Summary")
        return;
    const Claim_SSN= await PageConfigHelper.findElement("claim ssn", false);
    await CheckboxHelper.markCheckbox(Claim_SSN, true);
    await ElementHelper.click(NextButtonElement);
    await WaitHelper.getInstance().waitForTitle('Claim Actions - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Claim Actions");
    if (pageName == "Claim Actions")
        return;
    const Query= await PageConfigHelper.findElement("Query", false);
    await ElementHelper.click(Query);
    const claimInfo= await PageConfigHelper.findElement("Claim Information", false);
    await ElementHelper.click(claimInfo);
    await ElementHelper.click(NextButtonElement);
    PageConfigHelper.setCurrentPage("Person Status");
    if (pageName == "Disability") {
        var lnks = await $("//uef-link[@aria-label = 'Disability']");
    }
    else if (pageName == "Children") {
        var lnks = await $("//uef-link[@aria-label = 'Children']");
    }
    else if (pageName == "Health Insurance") {
        var lnks = await $("//uef-link[@aria-label = 'Health Insurance']");
    }
    await lnks.click();
    return;
});

//FUNC08
Given('User navigates to {string} screen for a new claim with {string} test data criteria', async (pageName: string, criteria: string) => {
    //Claim Information
    if (PageConfigHelper.sameScenarioSwitch == false) {
        await browser.url(config.baseUrl);
        await browser.maximizeWindow();
        await WaitHelper.getInstance().waitForPageTitle('Home Page');
        if (pageName == 'Home Page')
            return;
        const NextButtonElement= await PageConfigHelper.findElement('Next', true);
        await TextboxHelper.sendKeyswithElementName('Office Code', 'A15', false);
        let ssn = CSVReader.getData(criteria);
        await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForPageLabel('T2/T18 Claims');
        PageConfigHelper.setCurrentPage("Claim Summary");
        if (pageName == 'Claim Summary')
            return;
        await ElementHelper.clickwithElementName('Establish New Medicare Claim');
        await WaitHelper.getInstance().waitForPageTitle('Applicant Information');
        PageConfigHelper.setCurrentPage("Applicant Information");
        if (pageName == "Applicant Information")
            return;
        const lst_AppType= await PageConfigHelper.findElement("Applicant Type", false);
        const lst_ContactMethod= await PageConfigHelper.findElement("Contact Method", false);
        const chk_PrivacyAct= await PageConfigHelper.findElement("Privacy Act", false);
        await DropDownHelper.selectOptionByText(lst_AppType, "Claimant");
        await browser.pause(1000);
        await DropDownHelper.selectOptionByText(lst_ContactMethod, "IN OFFICE VISIT");
        await CheckboxHelper.markCheckbox(chk_PrivacyAct, true);
        await ElementHelper.click(NextButtonElement);
        //await WaitHelper.getInstance().waitForPageLabel('Birth Date Proof');
        //await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        await WaitHelper.getInstance().waitForPageTitle("Person Info");
        //PageConfigHelper.setCurrentPage("Person Info");
        if (pageName == "Person Info")
            return;
        await browser.switchToFrame(await $('<iframe />'));
        let birthText = "Birth Date Proof is required";
        let checkBirthText: boolean = await $('*=' + birthText).isDisplayed();
        if (checkBirthText) {
            const btnIdentityEdit= await PageConfigHelper.findElement("Edit_Identity_Button", false);
            await ElementHelper.click(btnIdentityEdit);
            let birthproofCodeLst= await PageConfigHelper.findElement("Birth Proof Code List", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Preferred Proof (Public or religious record of age established before age 5) (B)");
            birthproofCodeLst = await PageConfigHelper.findElement("Birth Proof Type List", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Pre-age 5 State, Local or Foreign Public Birth Certificate (P)");
            const submitButton= await PageConfigHelper.findElement("bttn_Accept", false);
            await ElementHelper.click(submitButton);
        }
        let citizenText = "Citizenship details are required";
        let checkCitizenText: boolean = await $('*=' + citizenText).isDisplayed();
        if (checkCitizenText) {
            const btnIdentityEdit= await PageConfigHelper.findElement("Edit_Citizenship_button", false);
            await ElementHelper.click(btnIdentityEdit);
            const addCitizenshipBtn= await PageConfigHelper.findElement("AddCitizen", false);
            await ElementHelper.click(addCitizenshipBtn);
            await browser.pause(1000);
            await browser.switchToFrame(await $('<iframe />'));
            const uscitizenship= await PageConfigHelper.findElement("radio_USCitizenYes", false);
            await ElementHelper.click(uscitizenship);
            let birthproofCodeLst= await PageConfigHelper.findElement("Listbox_USCitizen", false);
            await DropDownHelper.selectOptionByText(birthproofCodeLst, "Birth in U.S.");
            let citizenProofLst= await PageConfigHelper.findElement("Listbox_US_Proof_Code", false);
            await DropDownHelper.selectOptionByText(citizenProofLst, "U.S. Passport");
            const citizenshipEnded= await PageConfigHelper.findElement("CitizenshipEndedNo", false);
            await ElementHelper.click(citizenshipEnded);
            const submitButton= await PageConfigHelper.findElement("bttn_OK", false);
            await ElementHelper.click(submitButton);
            await browser.switchToParentFrame();
            await browser.switchToFrame(await $('<iframe />'));
            const saveCitizenInformation= await PageConfigHelper.findElement("bttn_Save_Citizen", false);
            await ElementHelper.click(saveCitizenInformation);
        }
        const SNO_No= await PageConfigHelper.findElement("radio_SNONo", false);
        await ElementHelper.click(SNO_No);
        const acceptButton= await PageConfigHelper.findElement("bttn_Accept", false);
        await ElementHelper.click(acceptButton);
        await browser.switchToParentFrame();
        //await WaitHelper.getInstance().waitForPageLabel('Protective filing date exists before today');
        await WaitHelper.getInstance().waitForPageTitle('Filing Date');
        //PageConfigHelper.setCurrentPage("Filing Date");
        if (pageName == "Filing Date")
            return;
        await ElementHelper.clickwithElementName('radio_ProtectiveFillingYes');
        await TextboxHelper.sendKeyswithElementName('ProtectiveFilingDate', '01/10/2021', false);
        await ElementHelper.click(NextButtonElement);
        //await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        await WaitHelper.getInstance().waitForPageTitle("Contact Info");
        //PageConfigHelper.setCurrentPage("Contact Info");
        if (pageName == "Contact Info")
            return;
        const addressText = "T2/T18 Residence address is required";
        await browser.switchToFrame(await $('<iframe />'));
        const checkAddressText: boolean = await $('*=' + addressText).isDisplayed();
        if (checkAddressText) {
            const addNewAddress= await PageConfigHelper.findElement("AddNewAddress", false);
            await ElementHelper.click(addNewAddress);
            await browser.switchToFrame(await $('<iframe />'));
            const allMailcheckBox= await PageConfigHelper.findElement("AllAddressTypes", false);
            const mailcheckBox= await PageConfigHelper.findElement("mailing", false);
            const clickOKNewAddress= await PageConfigHelper.findElement("Add New Address OK", false);
            const clickOK= await PageConfigHelper.findElement("Save", false);
            const stateSelect= await PageConfigHelper.findElement("State", false);
            await TextboxHelper.sendKeyswithElementName('Line_1', '6 Charles street', false);
            await TextboxHelper.sendKeyswithElementName('City', 'Baltimore', false);
            await DropDownHelper.selectOptionByText(stateSelect, "Maryland");
            await TextboxHelper.sendKeyswithElementName('Zip', '21201', false);
            //await CheckboxHelper.markCheckbox(mailcheckBox,true);
            const alladdress = await $("//input[@id = 'uef-checklist0-selectAll']");
            await alladdress.click();
            await TextboxHelper.sendKeyswithElementName('Current T2/T18 Residence Start Date', '02/02/1998', false);
            await ElementHelper.click(clickOK);
            await ElementHelper.clickwithElementName('Recommended USPS standard format');
            await ElementHelper.click(clickOKNewAddress);
            await browser.switchToParentFrame();
        }
        const spokenlang= await PageConfigHelper.findElement("SpokenLanguagePreference", false);
        const writtenLang= await PageConfigHelper.findElement("WrittenLanguagePreference", false);
        await spokenlang.sendKeyEvent("English");
        await writtenLang.sendKeyEvent("Bosnian");
        await ElementHelper.clickwithElementName('Save');
        await browser.switchToParentFrame();
        //await WaitHelper.getInstance().waitForPageLabel('Taxed SocialSecurityEarnings ($)');
        //await WaitHelper.getInstance().waitForPageTitle("Earnings");
        //await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        await WaitHelper.getInstance().waitForPageTitle("Earnings");
        //PageConfigHelper.setCurrentPage("Earnings");
        if (pageName == "Earnings")
            return;
        await ElementHelper.clickwithElementName('radio_AgreeEarningsYes');
        await ElementHelper.clickwithElementName('radio_EarnsOtherSSNNo');
        const txtName = "Did you work last year or any time this year?";
        let checkNotinsured: boolean = await $('*=' + txtName).isDisplayed();
        if (checkNotinsured)
            await ElementHelper.clickwithElementName('radio_EarnsWorkdLastThisyrNo');
        await ElementHelper.click(NextButtonElement);

        await WaitHelper.getInstance().waitForPageTitle('Insured Status');

        //await browser.wait(protractor.ExpectedConditions.presenceOf(element(by.xpath("//uef-table[@id = 'periodinsuredstatus']"))), 10000);
        //PageConfigHelper.setCurrentPage("Insured Status");
        if (pageName == "Insured Status")
            return;
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        //await WaitHelper.getInstance().waitForPageTitle("T2/T18 Data - Consolidated Claims Experience");
        //await WaitHelper.getInstance().waitForPageLabel('Lawful Presence');

        //await browser.wait(protractor.ExpectedConditions.presenceOf(element(by.xpath("//div[contains(@class , 'uef-container_header')]"))), 10000);
        let currentPageIndicator: boolean = await $('*=Lawful Presence').isDisplayed();
        if (currentPageIndicator) {
            //await WaitHelper.getInstance().waitForPageLabel('Lawful Presence');
            await WaitHelper.getInstance().waitForPageTitle("Lawful Presence");
            //PageConfigHelper.setCurrentPage("Lawful Presence");
            if (pageName == "Lawful Presence")
                return;
            const newLawfulbutton= await PageConfigHelper.findElement("AddNew", false);
            const statusdropdown= await PageConfigHelper.findElement("listbox_LawfulStatus", false);
            const startDateTextbox= await PageConfigHelper.findElement("Edit_StartDt", false);
            const proofDropdownbox= await PageConfigHelper.findElement("List_Proof_Yes", false);
            const saveLawfulStatus = await $$("//button[@id = 'okBtn']");
            await ElementHelper.click(newLawfulbutton);
            await DropDownHelper.selectOptionByText(statusdropdown, "Lawfully Admitted for Permanent Residence (LAPR)");
            await startDateTextbox.sendKeyEvent("02/02/1998");
            await ElementHelper.clickwithElementName('radio_StatusEnded_No');
            await DropDownHelper.selectOptionByText(proofDropdownbox, "Proof provided");
            await saveLawfulStatus[1].click();
            await ElementHelper.click(NextButtonElement);
            //await WaitHelper.getInstance().waitForPageLabel('No HI data located');
            //await  browser.sleep(1000);
            //await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
            await WaitHelper.getInstance().waitForPageTitle("Health Insurance");

            //PageConfigHelper.setCurrentPage("Health Insurance");
            if (pageName == "Health Insurance")
                return;
            const EnrollOptionsDropDown= await PageConfigHelper.findElement("SMIEnrollmentOptions", false);
            await DropDownHelper.selectOptionByText(EnrollOptionsDropDown, "Enroll");
            await ElementHelper.clickwithElementName('ReceivingMedicaidNo');
            await ElementHelper.clickwithElementName('ReceivingAnnuityNo');
            await ElementHelper.clickwithElementName('SpouseAnnuity_No');
            await ElementHelper.clickwithElementName('GroupHealthPlanNo');
            await ElementHelper.clickwithElementName('ClaimantEligibility');
            await ElementHelper.click(NextButtonElement);
        }
        else {
            //await WaitHelper.getInstance().waitForPageLabel('No HI data located');
            PageConfigHelper.setCurrentPage("Health Insurance");
            if (pageName == "Health Insurance")
                return;
            const EnrollOptionsDropDown= await PageConfigHelper.findElement("SMIEnrollmentOptions", false);
            await DropDownHelper.selectOptionByText(EnrollOptionsDropDown, "Enroll");
            await ElementHelper.clickwithElementName('ReceivingMedicaidNo');
            await ElementHelper.clickwithElementName('ReceivingAnnuityNo');
            await ElementHelper.clickwithElementName('SpouseAnnuity_No');
            await ElementHelper.clickwithElementName('GroupHealthPlanNo');
            await ElementHelper.clickwithElementName('ClaimantEligibility');
            await ElementHelper.click(NextButtonElement);
        }
        //await WaitHelper.getInstance().waitForPageLabel('Alerts');
        //await browser.sleep(2000);
        //await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        await WaitHelper.getInstance().waitForPageTitle("Induvidual Edits and Alerts");
        //PageConfigHelper.setCurrentPage("Induvidual Edits and Alerts");
        if (pageName == "Induvidual Edits and Alerts")
            return;
        await ElementHelper.click(NextButtonElement);
        //await WaitHelper.getInstance().waitForPageLabel('Person Information');
        //await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        await WaitHelper.getInstance().waitForPageTitle("Pre-Adjudicative Results");
        //PageConfigHelper.setCurrentPage("Pre-Adjudicative Results");
        if (pageName == "Pre-Adjudicative Results")
            return;
        await ElementHelper.click(NextButtonElement);
        //await element(by.xpath("//*[@id = 'nextBtn']")).click();
        //await WaitHelper.getInstance().waitForPageLabel('Medicare');
        //await WaitHelper.getInstance().waitForTitle('T2/T18 Data - Consolidated Claims Experience');
        await WaitHelper.getInstance().waitForPageTitle("Attestation and Printing");
        //PageConfigHelper.setCurrentPage("Attestation and Printing");
        if (pageName == "Attestation and Printing")
            return;
        const addSigAttestation= await PageConfigHelper.findElement("AddSignatureandAttestation", false);
        const understandCheckbox= await PageConfigHelper.findElement("Understand Affirmation", false);
        const decalreCheckbox= await PageConfigHelper.findElement("Declare Affirmation", false);
        const empAttestationCheckbox= await PageConfigHelper.findElement("EmpAttestation", false);
        const saveAttestationButton= await PageConfigHelper.findElement("Save", false);
        await ElementHelper.click(addSigAttestation);
        await ElementHelper.clickwithElementName('radio_SignatureTypeOral');
        await CheckboxHelper.markCheckbox(understandCheckbox, true);
        await CheckboxHelper.markCheckbox(decalreCheckbox, true);
        await CheckboxHelper.markCheckbox(empAttestationCheckbox, true);
        await ElementHelper.click(saveAttestationButton);
        await WaitHelper.getInstance().waitForPageLabel('Medicare');
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForPageLabel('Issue');
        PageConfigHelper.setCurrentPage("Development Worksheet");
        const unitcode= await PageConfigHelper.findElement("UnitCode", false);
        await TextboxHelper.sendKeys(unitcode, '122', false);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForPageLabel('T2/T18 Claims');
        PageConfigHelper.setCurrentPage("Claim Summary");
        if (pageName == "Claim Summary")
            return;
        const Claim_SSN= await PageConfigHelper.findElement("claim ssn", false);
        await CheckboxHelper.markCheckbox(Claim_SSN, true);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForPageLabel('Actions');
        PageConfigHelper.setCurrentPage("Claim Actions");
        if (pageName == "Claim Actions")
            return;
        const Update= await PageConfigHelper.findElement("Update", false);
        const claimInfo= await PageConfigHelper.findElement("Claim Information", false);
        await ElementHelper.click(Update);
        await ElementHelper.click(claimInfo);
        await ElementHelper.click(NextButtonElement);
        await WaitHelper.getInstance().waitForPageLabel('T2/T18 Data');
        PageConfigHelper.setCurrentPage("Person Status");
        if (pageName == "Attestation and Printing") {
            var lnks = await browser.$("//uef-link[@aria-label = 'Attestation and Printing']");
        }
        else if (pageName == "Development Worksheet") {
            var lnks = await browser.$("//uef-link[@aria-label = 'Development Worksheet']");
        }
        else if (pageName == "Development Notes") {
            var lnks = await browser.$("//uef-link[@aria-label = 'Development Notes']");
        }
        else if (pageName == "Person Statement") {
            var lnks = await $("//uef-link[@aria-label = 'Person Statement']");
        }
        else if (pageName == "Report of Contact") {
            var lnks = await $("//uef-link[@aria-label = 'Report of Contact']");
        }
        else if (pageName == "Determination") {
            var lnks = await $("//uef-link[@aria-label = 'Determinations']");
        }
        await lnks.click();
    }
});

//FUNC09
Given('User navigates to {string} screen for an existing pending claim with {string} test data criteria for Enrollment cases', async (pageName: string, criteria: string) => {
    await browser.url(config.baseUrl);
    await browser.maximizeWindow();
    await WaitHelper.getInstance().waitForTitle('Claims Home - Consolidated Claims Experience');
    await expect(browser.getTitle()).to.eventually.equal('Claims Home - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Home Page");
    if (pageName == "Home Page")
        return;
    const officeCodeElement= await PageConfigHelper.findElement("Office Code", false);
    const NextButtonElement= await PageConfigHelper.findElement("Next", true);
    await TextboxHelper.sendKeys(officeCodeElement, "A15", false);
    let ssn = CSVReader.getData(criteria, 'N');
    await TextboxHelper.sendKeyswithElementName('SSN', ssn, false);
    await ElementHelper.click(NextButtonElement);
    await WaitHelper.getInstance().waitForTitle('Claims Summary - Consolidated Claims Experience');
    await expect(browser.getTitle()).to.eventually.equal('Claims Summary - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Claim Summary");
    if (pageName == "Claim Summary")
        return;
    const Claim_SSN= await PageConfigHelper.findElement("claim ssn", false);
    await CheckboxHelper.markCheckboxWithWaitDisplay(Claim_SSN, true);
    await ElementHelper.click(NextButtonElement);
    await WaitHelper.getInstance().waitForTitle('Claim Actions - Consolidated Claims Experience');
    await expect(browser.getTitle()).to.eventually.equal('Claim Actions - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Claim Actions");
    if (pageName == "Claim Actions")
        return;
    const Update= await PageConfigHelper.findElement("Update", false);
    await ElementHelper.click(Update);
    const claimInfo= await PageConfigHelper.findElement("Claim Information", false);
    await ElementHelper.click(claimInfo);
    await ElementHelper.click(NextButtonElement);
    await WaitHelper.getInstance().waitForTitle('Person Status - Consolidated Claims Experience');
    await expect(browser.getTitle()).to.eventually.equal('Person Status - Consolidated Claims Experience');
    PageConfigHelper.setCurrentPage("Person Status");

    if (pageName == "Application Information") {
        var lnks = await $$(".uef-link")[1];
    }
    else if (pageName == "Person Info") {
        var lnks = await $$(".uef-link")[3];
    }
    else if (pageName == "Contact Info") {
        var lnks = await $$(".uef-link")[5];
    }
    else if (pageName == "Earnings") {
        var lnks = await $$(".uef-link")[6];
    }
    else if (pageName == "Lawful Presence") {
        var lnks = await $$(".uef-link")[8];
    }
    else if (pageName == "Health Insurance") {
        var lnks = await $$(".uef-link")[8];
    }
    else if (pageName == "Individual Edits and Alert Messages") {
        var lnks = await $("//uef-link[@aria-label = 'Individual Edits and Alert Messages']");
    }
    else if (pageName == "Attestation and Printing") {
        var lnks = await $("//uef-link[@aria-label = 'Attestation and Printing']");
    }
    else if (pageName == "Development Worksheet") {
        var lnks = await $("//uef-link[@aria-label = 'Development Worksheet']");
    }
    else if (pageName == "Development Notes") {
        var lnks = await $("//uef-link[@aria-label = 'Development Notes']");
    }
    else if (pageName == "Person Statement") {
        var lnks = await $("//uef-link[@aria-label = 'Person Statement']");
    }
    else if (pageName == "Report of Contact") {
        var lnks = await $("//uef-link[@aria-label = 'Report of Contact']");
    }
    else if (pageName == "Determination") {
        var lnks = await $("//uef-link[@aria-label = 'Determinations']");
    }
    await lnks.click();
});
