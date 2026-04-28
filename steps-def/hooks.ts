/**
 * Cucumber hooks for Playwright UI + API capture/execution.
 */
import { After, Before, Status } from '@cucumber/cucumber';
import type { ITestCaseHookParameter } from '@cucumber/cucumber';
import { chromium, request } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { buildAiFixLlmPromptBundle, buildAiFixMarkdown, isAiFixEnabled, isAiFixLlmEnabled } from '../utils/aiFixPrompt';
import { ollamaGenerate, ollamaModel } from '../utils/ollamaClient';
import { attachApiCapture } from '../utils/capture';
import { generateFeatureFromCapturedApis } from '../utils/formatter';
import { readRunConfigFromEnv } from '../utils/mode';
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

  // Reset per-scenario state.
  this.apiState = createEmptyApiState();
  this.apiCaptureEnabled = false;
  this.apiCaptureStop = undefined;

  // Keep existing locator-based UI steps working.
  this.currentPageKey = undefined;
  this.loadPagesRegistry();
  this.loadCommonLocators();

  // Create API context for direct execution mode.
  // Even in replay-only mode, having it ready is harmless.
  this.apiRequestContext = await request.newContext();

  if (!this.runConfig.shouldOpenBrowser) return;

  this.browser = await chromium.launch({
    headless: process.env.HEADLESS === 'true',
    slowMo: Number(process.env.SLOW_MO || '1000'),
  });
  this.context = await this.browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  this.page = await this.context.newPage();

  if (this.runConfig.captureEnabled && this.page) {
    this.apiCaptureEnabled = true;
    const cap = attachApiCapture(this.page, this.apiState.capturedApis);
    this.apiCaptureStop = cap.stop;
  }
});

After(async function (this: AutomationWorld, scenario: ITestCaseHookParameter) {
  // On failure: optional "Fix with AI" bundle (feature + locators + aria snapshot) before closing the browser.
  if (
    isAiFixEnabled() &&
    scenario.result?.status === Status.FAILED &&
    this.runConfig?.shouldOpenBrowser &&
    this.page
  ) {
    try {
      const { markdown } = await buildAiFixMarkdown(this, scenario);
      await this.attach(markdown, 'text/markdown');
      const outDir = path.join(__dirname, '..', 'test-results', 'ai-fix');
      ensureDir(outDir);
      const safeName = scenario.pickle.name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
      const stamp = nowFileStamp();
      const outPath = path.join(outDir, `ai-fix-${stamp}-${safeName}.md`);
      fs.writeFileSync(outPath, markdown, 'utf8');

      // Small manifest so a local UI can list failures and apply fixes.
      try {
        const featureUri = scenario.pickle.uri;
        const bundlePath = path.join(outDir, `ai-fix-${stamp}-${safeName}.bundle.json`);
        const featurePath = path.isAbsolute(featureUri)
          ? featureUri
          : path.join(process.cwd(), featureUri);
        const pageYamlPath = this.currentPageKey
          ? path.join(__dirname, '..', 'locators', 'pages', `${this.currentPageKey}.yaml`)
          : undefined;
        const commonYamlPath = path.join(__dirname, '..', 'locators', 'common.yaml');
        fs.writeFileSync(
          bundlePath,
          JSON.stringify(
            {
              stamp,
              scenarioName: scenario.pickle.name,
              featureUri,
              featurePath,
              currentPageKey: this.currentPageKey ?? null,
              pageYamlPath: pageYamlPath ?? null,
              commonYamlPath,
              markdownPath: outPath,
            },
            null,
            2
          ),
          'utf8'
        );
      } catch {
        // ignore
      }

      // Optional: run local LLM (Ollama) and attach the suggested updated file contents.
      if (isAiFixLlmEnabled()) {
        try {
          const llmPrompt = buildAiFixLlmPromptBundle(markdown);
          const llmOut = await ollamaGenerate({
            model: ollamaModel(),
            prompt: llmPrompt,
          });
          const llmPath = path.join(outDir, `ai-fix-${stamp}-${safeName}.llm.txt`);
          fs.writeFileSync(llmPath, llmOut, 'utf8');
          await this.attach(
            [
              `Model: ${ollamaModel()}`,
              `Saved: ${llmPath}`,
              '',
              llmOut,
            ].join('\n'),
            'text/plain'
          );
        } catch (e) {
          await this.attach(
            `AI fix LLM call failed: ${e instanceof Error ? e.message : String(e)}`,
            'text/plain'
          );
        }
      }
    } catch {
      // Do not mask the original scenario failure.
    }
  }

  // Best-effort close: replay-only runs can omit browser.
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

  try {
    await this.context?.close();
  } catch {
    // ignore
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

    const outDir = path.join(__dirname, '..', 'generated');
    ensureDir(outDir);
    const outPath = path.join(outDir, `api-capture-${nowFileStamp()}.feature`);
    fs.writeFileSync(outPath, featureText, 'utf8');
  } catch {
    // If generation fails, don't hide the original test failure.
  }
});

