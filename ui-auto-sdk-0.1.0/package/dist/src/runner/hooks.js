"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sdkHooks = void 0;
/**
 * Central WDIO+Cucumber hooks owned by the SDK.
 *
 * Used by the SDK's WDIO config for consistent behavior across consumer projects
 * (logging, screenshots, injection, cookie handling).
 */
const wdio_cucumberjs_json_reporter_1 = __importDefault(require("wdio-cucumberjs-json-reporter"));
const moment_1 = __importDefault(require("moment"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const PageContext_1 = require("../support/PageContext");
const injectAutomationOverlay_1 = require("../injection/injectAutomationOverlay");
const loadConfig_1 = require("../config/loadConfig");
const consumerRoot_1 = require("../config/consumerRoot");
function getReportFolder() {
    const cfg = (0, loadConfig_1.loadFrameworkConfig)();
    const raw = String(cfg.reportFolder ?? './reports/integrationTests');
    const root = (0, consumerRoot_1.getConsumerRoot)();
    return path.isAbsolute(raw) ? raw : path.join(root, raw);
}
async function takeFailureScreenshot(num) {
    const reportFolder = getReportFolder();
    const png = (await browser.takeScreenshot());
    const dir = path.join(reportFolder, 'screenshot');
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const time = (0, moment_1.default)(new Date()).format('yyyy_MM_DD__HH_mm_ss_SSS');
    const filePath = path.join(dir, `failure_${time}_${num}.png`);
    fs.writeFileSync(filePath, Buffer.from(png, 'base64'));
}
exports.sdkHooks = {
    beforeScenario: async function (world) {
        PageContext_1.PageContext.sameScenarioSwitch = false;
        const scenarioName = String(world?.pickle?.name ?? '').trim();
        if (scenarioName && scenarioName === PageContext_1.PageContext.getScenarioName()) {
            PageContext_1.PageContext.sameScenarioSwitch = true;
        }
        else {
            PageContext_1.PageContext.sameScenarioSwitch = false;
            await browser.deleteAllCookies();
        }
        PageContext_1.PageContext.setScenarioName(scenarioName);
        await (0, injectAutomationOverlay_1.injectAutomationOverlay)({ scenarioName, status: 'running' });
    },
    beforeCommand: async function (commandName) {
        const cmd = String(commandName ?? '').toLowerCase();
        if (cmd === 'url' || cmd === 'navigateto' || cmd === 'refresh') {
            await (0, injectAutomationOverlay_1.injectAutomationOverlay)({
                scenarioName: PageContext_1.PageContext.getScenarioName(),
                status: 'running',
            });
        }
    },
    afterScenario: async function (_world, result) {
        if (!result?.passed) {
            const scrollHeight = parseInt((await browser.execute('return document.body.scrollHeight')), 10);
            const clientHeight = parseInt((await browser.execute('return document.body.clientHeight')), 10);
            const num = Math.ceil(scrollHeight / clientHeight);
            for (let i = 0; i < num; i++) {
                const height = i * clientHeight;
                await browser.execute(`window.scrollTo(0,${height});`);
                await takeFailureScreenshot(i);
                wdio_cucumberjs_json_reporter_1.default.attach((await browser.takeScreenshot()), 'image/png');
            }
            await (0, injectAutomationOverlay_1.injectAutomationOverlay)({
                scenarioName: PageContext_1.PageContext.getScenarioName(),
                status: 'failed',
            });
        }
        else {
            await (0, injectAutomationOverlay_1.injectAutomationOverlay)({
                scenarioName: PageContext_1.PageContext.getScenarioName(),
                status: 'passed',
            });
        }
    },
};
//# sourceMappingURL=hooks.js.map