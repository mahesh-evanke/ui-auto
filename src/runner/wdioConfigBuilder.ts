/**
 * WDIO config builder for the SDK.
 *
 * Reads consumer-owned config.yaml and produces a WDIO configuration that uses
 * SDK-owned step definitions and hooks.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { generate } from 'multiple-cucumber-html-reporter';
import moment from 'moment';

import {
  loadFrameworkConfig,
  getExecutionMode,
  getEnvironment,
} from '../config/loadConfig';
import { getConsumerRoot } from '../config/consumerRoot';
import { parseFeatureFile } from '../support/gherkin-parser';
import { sdkHooks } from './hooks';

export interface BuildWdioConfigOptions {
  configPath?: string;
  consumerRoot?: string;
  overrides?: {
    env?: string;
    tags?: string;
    browser?: string;
    maxInstances?: number;
    headless?: boolean;
  };
}

function resolveBaseUrl(cfg: any, environment: string): string {
  if (environment === 'VAL') return String(cfg.valUrl ?? '');
  if (environment === 'DEV') return String(cfg.devUrl ?? '');
  if (environment === 'STANDALONE') return String(cfg.standaloneUrl ?? '');
  return '';
}

function resolveBrowserName(cfg: any, browserOverride?: string): string {
  let browserName = String(browserOverride ?? cfg.browserName ?? '').toUpperCase();
  if (browserName === 'IE') return 'internet explorer';
  if (browserName === 'CHROME') return 'chrome';
  if (browserName === 'EDGE') return 'MicrosoftEdge';
  return browserName.toLowerCase();
}

function applyDriverEnv(cfg: any, browserName: string): void {
  if (browserName === 'chrome') {
    const p = String(cfg.chromedriverpath ?? '');
    if (p && p !== '<path>') process.env['CHROMEDRIVER_FILEPATH'] = p;
  }
  if (browserName === 'MicrosoftEdge') {
    const p = String(cfg.edgedriverpath ?? '');
    if (p && p !== '<path>') process.env['EDGEDRIVER_PATH'] = p;
  }
}

function selectFeaturesByTags(
  featureGlob: string,
  tagsCsv: string,
  consumerRoot: string
): string[] {
  const pattern = featureGlob.replace(/^\.\//, '').replace(/\\/g, '/');
  const relativePaths = glob.sync(pattern, { cwd: consumerRoot });
  const paths = relativePaths.map((p) => path.join(consumerRoot, p));
  const tags = String(tagsCsv ?? '')
    .split(/[, ]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tags.length === 0) return paths;

  const selected: string[] = [];
  pathloop: for (const p of paths) {
    try {
      const parsed = parseFeatureFile(p);
      for (const tag of parsed.featureTags) {
        if (tags.includes(tag)) {
          selected.push(p);
          continue pathloop;
        }
      }
      for (const scenario of parsed.scenarios) {
        for (const tag of scenario.tags) {
          if (tags.includes(tag)) {
            selected.push(p);
            continue pathloop;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return Array.from(new Set(selected));
}

export function buildWdioConfig(opts: BuildWdioConfigOptions = {}): any {
  const consumerRoot = opts.consumerRoot ? path.resolve(opts.consumerRoot) : getConsumerRoot();
  const cfg = loadFrameworkConfig({ configPath: opts.configPath, consumerRoot });

  const executionMode = getExecutionMode(cfg);
  const environment = String(opts.overrides?.env ?? getEnvironment(cfg)).toUpperCase();
  const reportFolderRaw = String(cfg.reportFolder ?? './reports/integrationTests');
  const reportFolder = path.isAbsolute(reportFolderRaw)
    ? reportFolderRaw
    : path.join(consumerRoot, reportFolderRaw);

  const browserName = resolveBrowserName(cfg, opts.overrides?.browser);
  applyDriverEnv(cfg, browserName);

  const baseUrl = resolveBaseUrl(cfg, environment);
  if (!baseUrl) {
    throw new Error(
      `Invalid environment '${environment}'. Could not resolve baseUrl from config.yaml.`
    );
  }

  const featureGlob = String(cfg.features ?? './e2e/features/**/*.feature');
  const tagsCsv = String(opts.overrides?.tags ?? cfg.tags ?? '');
  const featuresFiles = selectFeaturesByTags(featureGlob, tagsCsv, consumerRoot);

  const maxInstances = Number(opts.overrides?.maxInstances ?? cfg.maxInstances ?? 1);

  let port: number | undefined;
  let protocol: string | undefined;
  let hostname: string | undefined;

  if (executionMode === 'GRID') {
    hostname = String(cfg.seleniumAddress ?? '');
  } else if (executionMode === 'SELENIUMBOX') {
    hostname = String(cfg.seleniumBoxAddress ?? '');
    port = 443;
    protocol = 'https';
  }

  const stepdefsGlob = path.join(path.resolve(__dirname, '..'), 'stepdefinitions', '**', '*.js');

  const baseCapability: any = {
    maxInstances,
    browserName,
    ...(browserName === 'MicrosoftEdge' &&
    cfg.edgedriverpath &&
    cfg.edgedriverpath !== '<path>'
      ? { 'wdio:edgedriverOptions': { binary: cfg.edgedriverpath } }
      : {}),
    ...(browserName === 'chrome' &&
    cfg.chromedriverpath &&
    cfg.chromedriverpath !== '<path>'
      ? { 'wdio:chromedriverOptions': { binary: cfg.chromedriverpath } }
      : {}),
    'e34:l_testName': cfg.seleniumBoxTestName,
    'e34:video': cfg.seleniumBoxVideoSw,
    'e34:userId': cfg.seleniumBoxId,
    'e34:token': cfg.seleniumBoxToken,
    'e34:projectId': cfg.seleniumBoxProjectName,
    'e34:credential': cfg.seleniumBoxCredential,
  };

  let startTime: Date;
  let endTime: Date;

  return {
    services: [],
    specs: featuresFiles,
    exclude: [],
    maxInstances,
    capabilities: [baseCapability],
    logLevel: 'error',
    bail: 0,
    baseUrl,
    waitforTimeout: cfg.allScriptsTimeout,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,
    ...(executionMode === 'LOCAL'
      ? {}
      : { hostname, port, path: '/wd/hub/', protocol }),
    framework: 'cucumber',
    reporters: [['cucumberjs-json', { jsonFolder: reportFolder + '/json/', language: 'en' }]],
    cucumberOpts: {
      retry: 0,
      require: [stepdefsGlob],
      backtrace: false,
      requireModule: [],
      dryRun: false,
      failFast: false,
      snippets: true,
      source: true,
      strict: false,
      tagExpression: '',
      timeout: cfg.getPageTimeout ?? 60000,
      ignoreUndefinedDefinitions: false,
    },
    beforeScenario: sdkHooks.beforeScenario,
    beforeCommand: sdkHooks.beforeCommand,
    afterScenario: sdkHooks.afterScenario,
    onPrepare: function () {
      startTime = new Date();
    },
    onComplete: function () {
      endTime = new Date();
      const time = moment(startTime!).format('YYYY_MM_DD_dddd_HH_mm');
      const reportPath = path.join(consumerRoot, 'e2e', 'reportHtml', time);
      try {
        generate({
          jsonDir: path.join(reportFolder, 'json') + path.sep,
          reportPath: reportPath + path.sep,
          metadata: {
            browser: { name: browserName },
            device: 'Local test machine',
            platform: { name: 'windows' },
          },
          customData: {
            title: 'Run info',
            data: [
              { label: 'Project', value: cfg.appName },
              { label: 'Browser', value: browserName },
              { label: 'Environment', value: environment },
              {
                label: 'Execution Start Time',
                value: moment(startTime!).format('dddd h:mma D MMM YYYY'),
              },
              {
                label: 'Execution End Time',
                value: moment(endTime!).format('dddd h:mma D MMM YYYY'),
              },
            ],
          },
        });
      } catch (error) {
        console.log('Error in results report generation:' + (error as Error).message);
      }
    },
  };
}
