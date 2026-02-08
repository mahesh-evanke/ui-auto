
import { PageConfigHelper } from "../../support/misc-utils/PageHelper";
import { ElementHelper } from "../../support/html-helpers/element-helper";
import { Given, DataTable } from '@cucumber/cucumber';

const chai = require('chai').use(require('chai-as-promised'));
const expect = chai.expect;
const assert = chai.assert;

Given('enters inputs with header names {string} from datatable to verify the edit message in {string} column', async (inputs: string, errorMsg: string, table: DataTable) => {
    const officeCodeElement: WebdriverIO.Element = await PageConfigHelper.findElement("Office Code", false);
    const SSNElement: WebdriverIO.Element = await PageConfigHelper.findElement("SSN", false);
    const NextButtonElement: WebdriverIO.Element = await PageConfigHelper.findElement("Next", true);
    var data = table.hashes();
    for (var i = 0; i < data.length; i++) {
        officeCodeElement
        await officeCodeElement.clearValue();
        await browser.pause(1000);
        if (data[i].officecode != "<blank>")
            await officeCodeElement.setValue(data[i].officecode);
        await SSNElement.clearValue();
        if (data[i].SSN != "<blank>")
            await SSNElement.setValue(data[i].SSN);
        await ElementHelper.click(NextButtonElement);
        await browser.pause(1000);

        var errorMsgs = data[i].description.split(';');
        var expText = '';
        for (var j = 0; j < errorMsgs.length; j++) {
            var tmpText = await $('#uef-input-error-'+j).getText();
            if (j == 0)
                expText = tmpText;
            else
                expText = expText + '; ' + tmpText
        }
        assert.equal(data[i].description, expText);
    }
});
