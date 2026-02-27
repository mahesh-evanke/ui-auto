/**
 * UI step definitions for Web UI + API integration. Perform UI actions and capture APIs triggered by that action.
 */

import { Given, When } from '@wdio/cucumber-framework';
import { $ } from '@wdio/globals';
import { startNetworkCapture, stopNetworkCapture, getCapturedApis, waitForNetworkIdle } from '../../support/networkCapture.js';
import { setApisForStep } from './context.js';
import LoginPage from '../../y/login.page.js';

Given(/^user is on the login page$/, async () => {
    await LoginPage.open();
});

/**
 * Table-format feature: "Given user performs \"<Step Name>\".
 * Performs the UI for that step and captures APIs; stores APIs under step name for "Then validate the following APIs:".
 */
Given(/^user performs "([^"]+)"$/, async (stepName: string) => {
    await startNetworkCapture();
    const name = stepName.toLowerCase();
    if (name === 'login') {
        await LoginPage.login('tomsmith', 'SuperSecretPassword!');
    } else if (name === 'dashboard') {
        const link = await $('a[href="/dashboard"]');
        if (await link.isExisting()) await link.click();
    } else {
        await waitForNetworkIdle(800);
    }
    await waitForNetworkIdle(1500);
    await stopNetworkCapture();
    setApisForStep(stepName, getCapturedApis());
});

/**
 * Performs a named UI action, captures only the APIs triggered by that action, and stores them under the step name.
 * Pattern: start capture → do UI → wait for network → stop capture → store APIs.
 */
When(/^user performs UI action "([^"]+)"$/, async (stepName: string) => {
    await startNetworkCapture();
    // Perform the actual UI based on step name (extend with more actions as needed).
    if (stepName === 'Login' || stepName === 'login') {
        await LoginPage.login('tomsmith', 'SuperSecretPassword!');
    } else if (stepName === 'Dashboard' || stepName === 'dashboard') {
        const link = await $('a[href="/dashboard"]');
        if (await link.isExisting()) await link.click();
    } else {
        await waitForNetworkIdle(800);
    }
    await waitForNetworkIdle(1500);
    await stopNetworkCapture();
    const apis = getCapturedApis();
    setApisForStep(stepName, apis);
});

When(/^user clicks login with username "([^"]+)" and password "([^"]+)"$/, async (username: string, password: string) => {
    await startNetworkCapture();
    await LoginPage.login(username, password);
    await waitForNetworkIdle(1500);
    await stopNetworkCapture();
    setApisForStep('Login', getCapturedApis());
});

When(/^user clicks dashboard$/, async () => {
    await startNetworkCapture();
    const dashboardLink = await $('a[href="/dashboard"]');
    if (await dashboardLink.isExisting()) {
        await dashboardLink.click();
    }
    await waitForNetworkIdle(1500);
    await stopNetworkCapture();
    setApisForStep('Dashboard', getCapturedApis());
});
