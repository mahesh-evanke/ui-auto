"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Core SDK step definitions (app-agnostic).
 *
 * Consumers write features using these steps; no framework logic in consumer repos.
 */
const cucumber_framework_1 = require("@wdio/cucumber-framework");
const PageContext_1 = require("../support/PageContext");
const PageHelper_1 = require("../support/PageHelper");
const sdkElementHelpers_1 = require("../support/sdkElementHelpers");
(0, cucumber_framework_1.Given)('User navigates to {string} URL', async (url) => {
    await browser.url(url);
});
(0, cucumber_framework_1.Given)('enters {string} text in {string} textbox', async (txtInput, elementName) => {
    const element = await PageHelper_1.SdkPageHelper.findElement(elementName, false);
    if (txtInput !== '<blank>') {
        await (0, sdkElementHelpers_1.sdkSendKeys)(element, txtInput, false);
    }
    else {
        await (0, sdkElementHelpers_1.sdkClearText)(element);
    }
});
(0, cucumber_framework_1.When)('User clicks on {string} button', async (buttonName) => {
    const element = await PageHelper_1.SdkPageHelper.findElement(buttonName, false, 'click');
    await (0, sdkElementHelpers_1.sdkClick)(element);
});
(0, cucumber_framework_1.Then)('User is on {string} screen', async (screenName) => {
    PageContext_1.PageContext.setCurrentPage(screenName);
    await (0, sdkElementHelpers_1.sdkWaitForPage)(screenName);
});
//# sourceMappingURL=core_stepdefs.js.map