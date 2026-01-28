/**
 * Core SDK step definitions (app-agnostic).
 *
 * Consumers write features using these steps; no framework logic in consumer repos.
 */
import { Given, Then, When } from '@wdio/cucumber-framework';
import { PageContext } from '../support/PageContext';
import { SdkPageHelper } from '../support/PageHelper';
import {
  sdkClick,
  sdkSendKeys,
  sdkClearText,
  sdkWaitForPage,
} from '../support/sdkElementHelpers';

Given('User navigates to {string} URL', async (url: string) => {
  await browser.url(url);
});

Given('enters {string} text in {string} textbox', async (txtInput: string, elementName: string) => {
  const element = await SdkPageHelper.findElement(elementName, false);
  if (txtInput !== '<blank>') {
    await sdkSendKeys(element, txtInput, false);
  } else {
    await sdkClearText(element);
  }
});

When('User clicks on {string} button', async (buttonName: string) => {
  const element = await SdkPageHelper.findElement(buttonName, false, 'click');
  await sdkClick(element);
});

Then('User is on {string} screen', async (screenName: string) => {
  PageContext.setCurrentPage(screenName);
  await sdkWaitForPage(screenName);
});
