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
exports.buildWdioConfig = buildWdioConfig;
const path = __importStar(require("path"));
const glob = __importStar(require("glob"));
const multiple_cucumber_html_reporter_1 = require("multiple-cucumber-html-reporter");
const moment_1 = __importDefault(require("moment"));
const loadConfig_1 = require("../config/loadConfig");
const consumerRoot_1 = require("../config/consumerRoot");
const gherkin_parser_1 = require("../support/gherkin-parser");
const hooks_1 = require("./hooks");
function resolveBaseUrl(cfg, environment) {
    if (environment === 'VAL')
        return String(cfg.valUrl ?? '');
    if (environment === 'DEV')
        return String(cfg.devUrl ?? '');
    if (environment === 'STANDALONE')
        return String(cfg.standaloneUrl ?? '');
    return '';
}
function resolveBrowserName(cfg, browserOverride) {
    let browserName = String(browserOverride ?? cfg.browserName ?? '').toUpperCase();
    if (browserName === 'IE')
        return 'internet explorer';
    if (browserName === 'CHROME')
        return 'chrome';
    if (browserName === 'BRAVE')
        return 'chrome'; // Brave is Chromium-based; use ChromeDriver
    if (browserName === 'EDGE')
        return 'MicrosoftEdge';
    if (browserName === 'FIREFOX')
        return 'firefox';
    if (browserName === 'SAFARI')
        return 'safari';
    return browserName.toLowerCase();
}
function applyDriverEnv(cfg, browserName) {
    if (browserName === 'chrome') {
        const p = String(cfg.chromedriverpath ?? '');
        if (p && p !== '<path>')
            process.env['CHROMEDRIVER_FILEPATH'] = p;
    }
    if (browserName === 'MicrosoftEdge') {
        const p = String(cfg.edgedriverpath ?? '');
        if (p && p !== '<path>')
            process.env['EDGEDRIVER_PATH'] = p;
    }
    if (browserName === 'firefox') {
        const p = String(cfg.geckodriverpath ?? '');
        if (p && p !== '<path>')
            process.env['GECKODRIVER_FILEPATH'] = p;
    }
}
function selectFeaturesByTags(featureGlob, tagsCsv, consumerRoot) {
    const pattern = featureGlob.replace(/^\.\//, '').replace(/\\/g, '/');
    const relativePaths = glob.sync(pattern, { cwd: consumerRoot });
    const paths = relativePaths.map((p) => path.join(consumerRoot, p));
    const tags = String(tagsCsv ?? '')
        .split(/[, ]+/)
        .map((t) => t.trim())
        .filter(Boolean);
    if (tags.length === 0)
        return paths;
    const selected = [];
    pathloop: for (const p of paths) {
        try {
            const parsed = (0, gherkin_parser_1.parseFeatureFile)(p);
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
        }
        catch {
            /* ignore */
        }
    }
    return Array.from(new Set(selected));
}
function buildWdioConfig(opts = {}) {
    const consumerRoot = opts.consumerRoot ? path.resolve(opts.consumerRoot) : (0, consumerRoot_1.getConsumerRoot)();
    const cfg = (0, loadConfig_1.loadFrameworkConfig)({ configPath: opts.configPath, consumerRoot });
    const executionMode = (0, loadConfig_1.getExecutionMode)(cfg);
    const environment = String(opts.overrides?.env ?? (0, loadConfig_1.getEnvironment)(cfg)).toUpperCase();
    const reportFolderRaw = String(cfg.reportFolder ?? './reports/integrationTests');
    const reportFolder = path.isAbsolute(reportFolderRaw)
        ? reportFolderRaw
        : path.join(consumerRoot, reportFolderRaw);
    const browserName = resolveBrowserName(cfg, opts.overrides?.browser);
    applyDriverEnv(cfg, browserName);
    const baseUrl = resolveBaseUrl(cfg, environment);
    if (!baseUrl) {
        throw new Error(`Invalid environment '${environment}'. Could not resolve baseUrl from config.yaml.`);
    }
    const featureGlob = String(cfg.features ?? './e2e/web/features/**/*.feature');
    const tagsCsv = String(opts.overrides?.tags ?? cfg.tags ?? '');
    const featuresFiles = selectFeaturesByTags(featureGlob, tagsCsv, consumerRoot);
    const maxInstances = Number(opts.overrides?.maxInstances ?? cfg.maxInstances ?? 1);
    let port;
    let protocol;
    let hostname;
    if (executionMode === 'GRID') {
        hostname = String(cfg.seleniumAddress ?? '');
    }
    else if (executionMode === 'SELENIUMBOX') {
        hostname = String(cfg.seleniumBoxAddress ?? '');
        port = 443;
        protocol = 'https';
    }
    const stepdefsGlob = path.join(path.resolve(__dirname, '..'), 'stepdefinitions', '**', '*.js');
    const isBrave = String(cfg.browserName ?? '').toUpperCase() === 'BRAVE';
    const braveBrowserPath = isBrave && cfg.braveBrowserPath && cfg.braveBrowserPath !== '<path>'
        ? cfg.braveBrowserPath
        : isBrave && process.platform === 'win32'
            ? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
            : isBrave && process.platform === 'darwin'
                ? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
                : null;
    const baseCapability = {
        maxInstances,
        browserName,
        ...(browserName === 'MicrosoftEdge' &&
            cfg.edgedriverpath &&
            cfg.edgedriverpath !== '<path>'
            ? { 'wdio:edgedriverOptions': { binary: cfg.edgedriverpath } }
            : {}),
        ...(browserName === 'chrome' &&
            cfg.chromedriverpath &&
            cfg.chromedriverpath !== '<path>' &&
            !isBrave
            ? { 'wdio:chromedriverOptions': { binary: cfg.chromedriverpath } }
            : {}),
        ...(browserName === 'chrome' && isBrave && braveBrowserPath
            ? { 'goog:chromeOptions': { binary: braveBrowserPath } }
            : {}),
        ...(browserName === 'firefox' &&
            cfg.geckodriverpath &&
            cfg.geckodriverpath !== '<path>'
            ? { 'wdio:geckodriverOptions': { binary: cfg.geckodriverpath } }
            : {}),
        'e34:l_testName': cfg.seleniumBoxTestName,
        'e34:video': cfg.seleniumBoxVideoSw,
        'e34:userId': cfg.seleniumBoxId,
        'e34:token': cfg.seleniumBoxToken,
        'e34:projectId': cfg.seleniumBoxProjectName,
        'e34:credential': cfg.seleniumBoxCredential,
    };
    let startTime;
    let endTime;
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
        beforeScenario: hooks_1.sdkHooks.beforeScenario,
        beforeCommand: hooks_1.sdkHooks.beforeCommand,
        afterScenario: hooks_1.sdkHooks.afterScenario,
        onPrepare: function () {
            startTime = new Date();
        },
        onComplete: function () {
            endTime = new Date();
            const time = (0, moment_1.default)(startTime).format('YYYY_MM_DD_dddd_HH_mm');
            const reportPath = path.join(consumerRoot, 'e2e', 'reportHtml', time);
            try {
                (0, multiple_cucumber_html_reporter_1.generate)({
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
                                value: (0, moment_1.default)(startTime).format('dddd h:mma D MMM YYYY'),
                            },
                            {
                                label: 'Execution End Time',
                                value: (0, moment_1.default)(endTime).format('dddd h:mma D MMM YYYY'),
                            },
                        ],
                    },
                });
            }
            catch (error) {
                console.log('Error in results report generation:' + error.message);
            }
        },
    };
}
//# sourceMappingURL=wdioConfigBuilder.js.map