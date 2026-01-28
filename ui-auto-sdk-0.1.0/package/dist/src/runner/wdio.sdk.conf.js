"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
/**
 * SDK WDIO config entrypoint.
 *
 * This file exists so we can pass an actual config-file path to the WebdriverIO Launcher.
 * It builds config at runtime from consumer-owned `config.yaml` and environment overrides.
 */
const wdioConfigBuilder_1 = require("./wdioConfigBuilder");
const consumerRoot_1 = require("../config/consumerRoot");
const env = process.env;
exports.config = (0, wdioConfigBuilder_1.buildWdioConfig)({
    consumerRoot: (0, consumerRoot_1.getConsumerRoot)(),
    configPath: env.UI_AUTO_CONFIG_PATH,
    overrides: {
        env: env.UI_AUTO_ENV,
        tags: env.UI_AUTO_TAGS,
        browser: env.UI_AUTO_BROWSER,
        maxInstances: env.UI_AUTO_MAX_INSTANCES ? Number(env.UI_AUTO_MAX_INSTANCES) : undefined,
        headless: env.UI_AUTO_HEADLESS ? env.UI_AUTO_HEADLESS === 'true' : undefined,
    },
});
//# sourceMappingURL=wdio.sdk.conf.js.map