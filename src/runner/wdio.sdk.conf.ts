/**
 * SDK WDIO config entrypoint.
 *
 * Provides a config-file path to the WebdriverIO Launcher. Builds config at runtime
 * from consumer-owned config.yaml and environment overrides.
 */
import { buildWdioConfig } from './wdioConfigBuilder';
import { getConsumerRoot } from '../config/consumerRoot';

const env = process.env;

export const config: any = buildWdioConfig({
  consumerRoot: getConsumerRoot(),
  configPath: env.UI_AUTO_CONFIG_PATH,
  overrides: {
    env: env.UI_AUTO_ENV,
    tags: env.UI_AUTO_TAGS,
    browser: env.UI_AUTO_BROWSER,
    maxInstances: env.UI_AUTO_MAX_INSTANCES ? Number(env.UI_AUTO_MAX_INSTANCES) : undefined,
    headless: env.UI_AUTO_HEADLESS ? env.UI_AUTO_HEADLESS === 'true' : undefined,
  },
});
