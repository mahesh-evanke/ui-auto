/**
 * Cucumber hooks for Playwright UI + API capture/execution.
 */
import '../support/config'; // load e2e/config/config.yaml into process.env before anything reads it
import { After, Before, Status } from '@cucumber/cucumber';
import type { ITestCaseHookParameter } from '@cucumber/cucumber';
import { chromium, request } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { attachApiCapture } from '../support/capture';
import { contextOptions, launchOptions } from '../support/contextOptions';
import { generateFeatureFromCapturedApis } from '../support/formatter';
import { readRunConfigFromEnv } from '../support/mode';
import { createEmptyApiState } from './apiState';
import { AutomationWorld } from './world';

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function nowFileStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

Before(async function (this: AutomationWorld) {
  this.runConfig = readRunConfigFromEnv();

  this.apiState = createEmptyApiState();
  this.apiCaptureEnabled = false;
  this.apiCaptureStop = undefined;

  this.currentPageKey = undefined;
  this.loadPagesRegistry();
  this.loadCommonLocators();

  this.apiRequestContext = await request.newContext();

  if (!this.runConfig.shouldOpenBrowser) return;

  this.browser = await chromium.launch(
    launchOptions({
      headless: process.env.HEADLESS === 'true',
      slowMo: Number(process.env.SLOW_MO || '1000'),
      channel: process.env.PW_CHANNEL || undefined,
    }),
  );

  // reports/ is at project root — two levels up from e2e/stepdefinitions/
  const recordVideoDir =
    process.env.RECORD_VIDEO === '1'
      ? path.join(__dirname, '..', '..', 'reports', 'recorded')
      : undefined;

  this.context = await this.browser.newContext(
    contextOptions({
      deviceName: process.env.VIEWPORT_DEVICE,
      recordVideoDir,
      defaultViewport: { width: 1280, height: 720 },
    }),
  );
  this.page = await this.context.newPage();

  if (this.runConfig.captureEnabled && this.page) {
    this.apiCaptureEnabled = true;
    const cap = attachApiCapture(this.page, this.apiState.capturedApis);
    this.apiCaptureStop = cap.stop;
  }
});

After(async function (this: AutomationWorld, scenario: ITestCaseHookParameter) {
  try {
    this.apiCaptureStop?.();
  } catch {
    // ignore
  }

  try {
    await this.apiRequestContext?.dispose();
  } catch {
    // ignore
  }

  const video = this.page?.video?.();

  try {
    await this.context?.close();
  } catch {
    // ignore
  }

  if (video) {
    try {
      const status = scenario.result?.status === Status.PASSED ? 'PASS' : 'FAIL';
      const safe = scenario.pickle.name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
      const dir = path.join(__dirname, '..', '..', 'reports', 'recorded');
      ensureDir(dir);
      await video.saveAs(path.join(dir, `${safe}-${status}-${nowFileStamp()}.webm`));
      await video.delete().catch(() => undefined);
    } catch {
      // ignore video errors
    }
  }

  try {
    await this.browser?.close();
  } catch {
    // ignore
  }

  if (!this.runConfig?.shouldGenerateFeatureFromCapture) return;

  try {
    const featureText = generateFeatureFromCapturedApis({
      capturedApis: this.apiState.capturedApis,
      featureName: 'Captured API Replay',
      scenarioName: 'API calls',
    });

    // Generated capture output goes into e2e/features/generated/
    const outDir = path.join(__dirname, '..', 'features', 'generated');
    ensureDir(outDir);
    const outPath = path.join(outDir, `api-capture-${nowFileStamp()}.feature`);
    fs.writeFileSync(outPath, featureText, 'utf8');
  } catch {
    // Don't hide the original test failure.
  }
});
