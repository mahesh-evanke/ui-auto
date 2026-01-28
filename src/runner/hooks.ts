/**
 * Central WDIO+Cucumber hooks owned by the SDK.
 *
 * Used by the SDK's WDIO config for consistent behavior across consumer projects
 * (logging, screenshots, injection, cookie handling).
 */
import cucumberJson from 'wdio-cucumberjs-json-reporter';
import moment from 'moment';
import * as fs from 'fs';
import * as path from 'path';
import { PageContext } from '../support/PageContext';
import { injectAutomationOverlay } from '../injection/injectAutomationOverlay';
import { loadFrameworkConfig } from '../config/loadConfig';
import { getConsumerRoot } from '../config/consumerRoot';

function getReportFolder(): string {
  const cfg = loadFrameworkConfig();
  const raw = String(cfg.reportFolder ?? './reports/integrationTests');
  const root = getConsumerRoot();
  return path.isAbsolute(raw) ? raw : path.join(root, raw);
}

async function takeFailureScreenshot(num: number): Promise<void> {
  const reportFolder = getReportFolder();
  const png = (await browser.takeScreenshot()) as unknown as string;
  const dir = path.join(reportFolder, 'screenshot');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const time = moment(new Date()).format('yyyy_MM_DD__HH_mm_ss_SSS');
  const filePath = path.join(dir, `failure_${time}_${num}.png`);
  fs.writeFileSync(filePath, Buffer.from(png, 'base64'));
}

export const sdkHooks = {
  beforeScenario: async function (world: any) {
    PageContext.sameScenarioSwitch = false;
    const scenarioName = String(world?.pickle?.name ?? '').trim();
    if (scenarioName && scenarioName === PageContext.getScenarioName()) {
      PageContext.sameScenarioSwitch = true;
    } else {
      PageContext.sameScenarioSwitch = false;
      await browser.deleteAllCookies();
    }
    PageContext.setScenarioName(scenarioName);
    await injectAutomationOverlay({ scenarioName, status: 'running' });
  },

  beforeCommand: async function (commandName: string) {
    const cmd = String(commandName ?? '').toLowerCase();
    if (cmd === 'url' || cmd === 'navigateto' || cmd === 'refresh') {
      await injectAutomationOverlay({
        scenarioName: PageContext.getScenarioName(),
        status: 'running',
      });
    }
  },

  afterScenario: async function (_world: any, result: any) {
    if (!result?.passed) {
      const scrollHeight = parseInt(
        (await browser.execute('return document.body.scrollHeight')) as unknown as string,
        10
      );
      const clientHeight = parseInt(
        (await browser.execute('return document.body.clientHeight')) as unknown as string,
        10
      );
      const num = Math.ceil(scrollHeight / clientHeight);
      for (let i = 0; i < num; i++) {
        const height = i * clientHeight;
        await browser.execute(`window.scrollTo(0,${height});`);
        await takeFailureScreenshot(i);
        cucumberJson.attach((await browser.takeScreenshot()) as unknown as string, 'image/png');
      }
      await injectAutomationOverlay({
        scenarioName: PageContext.getScenarioName(),
        status: 'failed',
      });
    } else {
      await injectAutomationOverlay({
        scenarioName: PageContext.getScenarioName(),
        status: 'passed',
      });
    }
  },
};
