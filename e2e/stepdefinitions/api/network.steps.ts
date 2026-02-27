/**
 * Network capture step definitions. Start capture before UI, stop and store after UI for validation.
 * For @webui-api scenarios, capture is started automatically so "User sends ... request" can validate
 * the response that the browser received (instead of sending a duplicate request that may get 401).
 */

import { Before, Given, When } from '@wdio/cucumber-framework';
import { startNetworkCapture, stopNetworkCapture, getCapturedApis, waitForNetworkIdle } from '../../support/networkCapture.js';
import { setApisForStep } from './context.js';

Before({ tags: '@webui-api' }, async () => {
    await startNetworkCapture();
});

Given(/^API capture is started$/, async () => {
    await startNetworkCapture();
});

When(/^backend APIs are captured$/, async () => {
    // No step name: use default. Prefer "When backend APIs are captured for \"<name>\"" to set step name.
    await waitForNetworkIdle(2000);
    await stopNetworkCapture();
    setApisForStep('default', getCapturedApis());
});

When(/^backend APIs are captured for "([^"]+)"$/, async (stepName: string) => {
    setApisForStep(stepName, []); // set step name first so "Then validate..." has lastUiStepName even if capture fails
    await waitForNetworkIdle(2000);
    await stopNetworkCapture();
    setApisForStep(stepName, getCapturedApis());
});

/**
 * Table-format feature: "When APIs triggered for \"<Step Name>\" are captured".
 * APIs were already captured in "Given user performs \"<Step Name>\""; this step documents the flow.
 */
When(/^APIs triggered for "([^"]+)" are captured$/, async (_stepName: string) => {
    // Capture and storage already done in the preceding "Given user performs \"<Step Name>\"".
});
