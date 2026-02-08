/**
 * WebdriverIO v9 config for Cucumber e2e tests.
 * Supports Chrome and Edge with optional custom driver exe paths (no auto-download for Edge when path set).
 * Screenshot on scenario failure is written to report folder and attached to Cucumber JSON.
 */
// Skip ts-node type-check when Cucumber loads step defs (avoids TS2554/TS2695/TS2339 in large step files). Run `npx tsc --noEmit` for type-check.
if (process.env.TS_NODE_TRANSPILE_ONLY === undefined) {
    process.env.TS_NODE_TRANSPILE_ONLY = 'true';
}
/// <reference types="@wdio/globals/types" />
import type { Options } from '@wdio/types';
// Browser is injected at runtime by WDIO; declare for type-checking in config hooks.
declare const browser: WebdriverIO.Browser;
import { PageConfigHelper } from "../support/misc-utils/PageHelper";
import { generate } from 'multiple-cucumber-html-reporter';
import { removeSync } from 'fs-extra';
import cucumberJson from 'wdio-cucumberjs-json-reporter';
import moment from 'moment';
import * as fs from 'fs';
import * as glob from 'glob';
import * as yamlReader from 'js-yaml';

const e2eConfig = yamlReader.load(fs.readFileSync('e2e/config/config.yaml', 'utf8')) as Record<string, unknown>;
const executionMode = String(e2eConfig.executionMode).toUpperCase();
const environment = String(e2eConfig.environment).toUpperCase();
const reportFolder = String(e2eConfig.reportFolder);

let baseUrl: string | null = null;
let browserName = String(e2eConfig.browserName).toUpperCase();

if (environment === 'VAL')
    baseUrl = String(e2eConfig.valUrl);
else if (environment === 'DEV')
    baseUrl = String(e2eConfig.devUrl);
else if (environment === 'STANDALONE')
    baseUrl = String(e2eConfig.standaloneUrl);
else {
    console.log('Incorrect environment value');
    process.exit(1);
}

console.log('Application URL: ' + baseUrl);

// Normalize browserName for WDIO v9; build driver options for custom exe (no download when path set)
let capabilitiesBase: Record<string, unknown> = {
    maxInstances: Number(e2eConfig.maxInstances ?? 1),
    'e34:l_testName': e2eConfig.seleniumBoxTestName,
    'e34:video': e2eConfig.seleniumBoxVideoSw,
    'e34:userId': e2eConfig.seleniumBoxId,
    'e34:token': e2eConfig.seleniumBoxToken,
    'e34:projectId': e2eConfig.seleniumBoxProjectName,
    'e34:credential': e2eConfig.seleniumBoxCredential,
};

if (browserName === 'IE') {
    browserName = 'internet explorer';
    capabilitiesBase.browserName = browserName;
} else if (browserName === 'CHROME') {
    browserName = 'chrome';
    capabilitiesBase.browserName = browserName;
    const chromedriverPath = e2eConfig.chromedriverpath && String(e2eConfig.chromedriverpath).trim() !== '' && String(e2eConfig.chromedriverpath) !== '<path>';
    if (chromedriverPath) {
        (capabilitiesBase as Record<string, unknown>)['wdio:chromedriverOptions'] = { binary: String(e2eConfig.chromedriverpath).trim() };
    }
} else if (browserName === 'EDGE') {
    browserName = 'msedge';
    capabilitiesBase.browserName = browserName;
    const edgedriverPath = e2eConfig.edgedriverpath && String(e2eConfig.edgedriverpath).trim() !== '' && String(e2eConfig.edgedriverpath) !== '<path>';
    if (edgedriverPath) {
        (capabilitiesBase as Record<string, unknown>)['wdio:edgedriverOptions'] = { binary: String(e2eConfig.edgedriverpath).trim() };
    }
} else {
    capabilitiesBase.browserName = browserName;
}

let port: number | undefined;
let protocol: string;
let hostname: string;

if (executionMode === 'LOCAL') {
    hostname = 'localhost';
    port = 4444;
    protocol = 'http';
} else if (executionMode === 'GRID') {
    hostname = String(e2eConfig.seleniumAddress);
    protocol = 'http';
} else if (executionMode === 'SELENIUMBOX') {
    hostname = String(e2eConfig.seleniumBoxAddress);
    port = 443;
    protocol = 'https';
} else {
    console.log('Incorrect executionMode value');
    process.exit(1);
}

const paths = glob.sync(String(e2eConfig.features ?? ''));
const parser = require("gherkin-parse");
const tags = String(e2eConfig.tags ?? '').split(/[, ]+/);

var features = [];
pathloop: for (let path of paths) {
    let eachFileJson;
    try {
        eachFileJson = parser.convertFeatureFileToJSON(path);
    } catch (error) {
        eachFileJson = {};
    }
    if (eachFileJson.feature && eachFileJson.feature.tags) {
        for (let tag of eachFileJson.feature.tags) {
            if (tags.includes(tag.name)) {
                features.push(path.replace('e2e\\','..\\'));
                continue pathloop;
            }
        }
        for (let scenario of eachFileJson.feature.children) {
            for (let tag of scenario.tags) {
                if (tags.includes(tag.name)) {
                    features.push(path.replace('e2e\\','..\\'));
                    continue pathloop;
                }
            }
        }
    }
}
let featuresFiles = Array.from(new Set(features));
let startTime;
let endTime;

export const config: WebdriverIO.Config = {
    runner: 'local',
    //
    // ====================
    // Runner Configuration
    // ====================
    //
    //
    // ==================
    // Specify Test Files
    // ==================
    // Define which test specs should run. The pattern is relative to the directory
    // from which `wdio` was called.
    //
    // The specs are defined as an array of spec files (optionally using wildcards
    // that will be expanded). The test for each spec file will be run in a separate
    // worker process. In order to have a group of spec files run in the same worker
    // process simply enclose them in an array within the specs array.
    //
    // If you are calling `wdio` from an NPM script (see https://docs.npmjs.com/cli/run-script),
    // then the current working directory is where your `package.json` resides, so `wdio`
    // will be called from there.
    //
    specs: featuresFiles,
    // Patterns to exclude.
    exclude: [
        // 'path/to/excluded/files'
    ],
    //
    // ============
    // Capabilities
    // ============
    // Define your capabilities here. WebdriverIO can run multiple capabilities at the same
    // time. Depending on the number of capabilities, WebdriverIO launches several test
    // sessions. Within your capabilities you can overwrite the spec and exclude options in
    // order to group specific specs to a specific capability.
    //
    // First, you can define how many instances should be started at the same time. Let's
    // say you have 3 different capabilities (Chrome, Firefox, and Safari) and you have
    // set maxInstances to 1; wdio will spawn 3 processes. Therefore, if you have 10 spec
    // files and you set maxInstances to 10, all spec files will get tested at the same time
    // and 30 processes will get spawned. The property handles how many capabilities
    // from the same test should run tests.
    //
    maxInstances: Number(e2eConfig.maxInstances ?? 1),
    //
    // If you have trouble getting all important capabilities together, check out the
    // Sauce Labs platform configurator - a great tool to configure your capabilities:
    // https://saucelabs.com/platform/platform-configurator
    //
    capabilities: [capabilitiesBase],
    //
    // ===================
    // Test Configurations
    // ===================
    // Define all options that are relevant for the WebdriverIO instance here
    //
    // Level of logging verbosity: trace | debug | info | warn | error | silent
    logLevel: 'error',
    //
    // Set specific log levels per logger
    // loggers:
    // - webdriver, webdriverio
    // - @wdio/browserstack-service, @wdio/devtools-service, @wdio/sauce-service
    // - @wdio/mocha-framework, @wdio/jasmine-framework
    // - @wdio/local-runner
    // - @wdio/sumologic-reporter
    // - @wdio/cli, @wdio/config, @wdio/utils
    // Level of logging verbosity: trace | debug | info | warn | error | silent
    // logLevels: {
    //     webdriver: 'info',
    //     '@wdio/appium-service': 'info'
    // },
    //
    // If you only want to run your tests until a specific amount of tests have failed use
    // bail (default is 0 - don't bail, run all tests).
    bail: 0,
    //
    // Set a base URL in order to shorten url command calls. If your `url` parameter starts
    // with `/`, the base url gets prepended, not including the path portion of your baseUrl.
    // If your `url` parameter starts without a scheme or `/` (like `some/path`), the base url
    // gets prepended directly.
    baseUrl: baseUrl,
    //
    // Default timeout for all waitFor* commands.
    waitforTimeout: Number(e2eConfig.allScriptsTimeout ?? 11000),
    //
    // Default timeout in milliseconds for request
    // if browser driver or grid doesn't send response
    connectionRetryTimeout: 120000,
    //
    // Default request retries count
    connectionRetryCount: 3,
    //
    // Test runner services
    // Services take over a specific job you don't want to take care of. They enhance
    // your test setup with almost no effort. Unlike plugins, they don't add new
    // commands. Instead, they hook themselves up into the test process.
    // For LOCAL: omit hostname/port/path so WDIO starts driver (using binary from capabilities when set).
    // For GRID/SELENIUMBOX: connect to remote hub.
    ...(executionMode !== 'LOCAL' && {
        hostname,
        port,
        path: '/wd/hub/',
        protocol,
    }),
    // Framework you want to run your specs with.
    // The following are supported: Mocha, Jasmine, and Cucumber
    // see also: https://webdriver.io/docs/frameworks
    //
    // Make sure you have the wdio adapter package for the specific framework installed
    // before running any tests.
    framework: 'cucumber',
    //
    // The number of times to retry the entire specfile when it fails as a whole
    // specFileRetries: 1,
    //
    // Delay in seconds between the spec file retry attempts
    // specFileRetriesDelay: 0,
    //
    // Whether or not retried specfiles should be retried immediately or deferred to the end of the queue
    // specFileRetriesDeferred: false,
    //
    // Test reporter for stdout.
    // The only one supported by default is 'dot'
    // see also: https://webdriver.io/docs/dot-reporter
    reporters: [['cucumberjs-json', { jsonFolder: reportFolder + '/json/', language: 'en', },],],
    //
    // If you are using Cucumber you need to specify the location of your step definitions.
    cucumberOpts: {
        retry: 0,
        // <string[]> (file/dir) require files before executing features
        require: [
            './e2e/stepdefinitions/**/*.ts'
        ],
        // <boolean> show full backtrace for errors
        backtrace: false,
        // Load TypeScript step definitions (required when require points to .ts files)
        requireModule: ['ts-node/register'],
        // <boolean> invoke formatters without executing steps
        dryRun: false,
        // <boolean> abort the run on first failure
        failFast: false,
        // <string[]> (type[:path]) specify the output format, optionally supply PATH to redirect formatter output (repeatable)
        format: ['pretty'],
        // <boolean> hide step definition snippets for pending steps
        snippets: true,
        // <boolean> hide source uris
        source: true,
        // <string[]> (name) specify the profile to use
        profile: [],
        // <boolean> fail if there are any undefined or pending steps
        strict: false,
        // Tag filter: use 'tags' (standard); tagExpression is deprecated
        tags: String(e2eConfig.tags ?? ''),
        tagExpression: String(e2eConfig.tags ?? ''),
        // <number> timeout for step definitions
        timeout: Number(e2eConfig.getPageTimeout ?? 40000),
        // <boolean> Enable this config to treat undefined definitions as warnings.
        ignoreUndefinedDefinitions: false
    },

    //
    // =====
    // Hooks
    // =====
    // WebdriverIO provides several hooks you can use to interfere with the test process in order to enhance
    // it and to build services around it. You can either apply a single function or an array of
    // methods to it. If one of them returns with a promise, WebdriverIO will wait until that promise got
    // resolved to continue.
    /**
     * Gets executed once before all workers get launched.
     * @param {Object} config wdio configuration object
     * @param {Array.<Object>} capabilities list of capabilities details
     */
    onPrepare: function () {
        startTime = new Date();
        removeSync(reportFolder);
    },
    /**
     * Gets executed before a worker process is spawned and can be used to initialise specific service
     * for that worker as well as modify runtime environments in an async fashion.
     * @param  {String} cid      capability id (e.g 0-0)
     * @param  {[type]} caps     object containing capabilities for session that will be spawn in the worker
     * @param  {[type]} specs    specs to be run in the worker process
     * @param  {[type]} args     object that will be merged with the main configuration once worker is initialised
     * @param  {[type]} execArgv list of string arguments passed to the worker process
     */
    // onWorkerStart: function (cid, caps, specs, args, execArgv) {
    // },
    /**
     * Gets executed just before initialising the webdriver session and test framework. It allows you
     * to manipulate configurations depending on the capability or spec.
     * @param {Object} config wdio configuration object
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {Array.<String>} specs List of spec file paths that are to be run
     * @param {String} cid worker id (e.g. 0-0)
     */
    // beforeSession: function (config, capabilities, specs, cid) {
    // },
    /**
     * Gets executed before test execution begins. At this point you can access to all global
     * variables like `browser`. It is the perfect place to define custom commands.
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {Array.<String>} specs        List of spec file paths that are to be run
     * @param {Object}         browser      instance of created browser/device session
     */
    // before: function (capabilities, specs) {
    // },
    /**
     * Runs before a WebdriverIO command gets executed.
     * @param {String} commandName hook command name
     * @param {Array} args arguments that command would receive
     */
    // beforeCommand: function (commandName, args) {
    // },
    /**
     * Cucumber Hooks
     *
     * Runs before a Cucumber Feature.
     * @param {String}                   uri      path to feature file
     * @param {GherkinDocument.IFeature} feature  Cucumber feature object
     */
    // beforeFeature: function (uri, feature) {
    // },
    /**
     *
     * Runs before a Cucumber Scenario.
     * @param {ITestCaseHookParameter} world    world object containing information on pickle and test step
     * @param {Object}                 context  Cucumber World object
     */
    beforeScenario: function (world, context) {
        global.environment = environment;
        global.browseName = browserName;
        PageConfigHelper.sameScenarioSwitch = false;
        const scenarioName = world.pickle.name;
        if (scenarioName.trim() === PageConfigHelper.getScenarioName()) {
            PageConfigHelper.sameScenarioSwitch = true;
        }
        else {
            PageConfigHelper.sameScenarioSwitch = false;
            browser.deleteAllCookies();
        }
        PageConfigHelper.setScenarioName(scenarioName.trim());
    },
    /**
     *
     * Runs before a Cucumber Step.
     * @param {Pickle.IPickleStep} step     step data
     * @param {IPickle}            scenario scenario pickle
     * @param {Object}             context  Cucumber World object
     */
    // beforeStep: function (step, scenario, context) {
    // },
    /**
     *
     * Runs after a Cucumber Step.
     * @param {Pickle.IPickleStep} step             step data
     * @param {IPickle}            scenario         scenario pickle
     * @param {Object}             result           results object containing scenario results
     * @param {boolean}            result.passed    true if scenario has passed
     * @param {string}             result.error     error stack if scenario failed
     * @param {number}             result.duration  duration of scenario in milliseconds
     * @param {Object}             context          Cucumber World object
     */
    // afterStep: function (step, scenario, result, context) {
    // },
    /**
     *
     * Runs after a Cucumber Scenario.
     * @param {ITestCaseHookParameter} world            world object containing information on pickle and test step
     * @param {Object}                 result           results object containing scenario results
     * @param {boolean}                result.passed    true if scenario has passed
     * @param {string}                 result.error     error stack if scenario failed
     * @param {number}                 result.duration  duration of scenario in milliseconds
     * @param {Object}                 context          Cucumber World object
     */
    afterScenario: async function (world, result) {
        if (!result.passed) {
            try {
                const scrollHeight = parseInt(await browser.execute("return document.body.scrollHeight") as string, 10);
                const clientHeight = parseInt(await browser.execute("return document.body.clientHeight") as string, 10);
                const numViewports = Math.ceil(scrollHeight / clientHeight) || 1;
                const timestamp = moment(new Date()).format("yyyy_MM_DD__HH_mm_ss_SSS");
                const scenarioName = (world as { pickle?: { name?: string } }).pickle?.name ?? 'scenario';
                const safeName = scenarioName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
                const dir = reportFolder + '/screenshot';
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                for (let i = 0; i < numViewports; i++) {
                    if (i > 0) {
                        await browser.execute("window.scrollTo(0," + (i * clientHeight) + ");");
                    }
                    const png = await browser.takeScreenshot();
                    const filepath = `${dir}/failure_${timestamp}_${safeName}_${i}.png`;
                    await fs.promises.writeFile(filepath, Buffer.from(png, 'base64'));
                    try {
                        cucumberJson.attach(png, 'image/png');
                    } catch {
                        // Reporter attach may not be available in all contexts
                    }
                }
            } catch (err) {
                console.warn('Screenshot on failure could not be taken:', (err as Error).message);
            }
        }
    },
    /**
     *
     * Runs after a Cucumber Feature.
     * @param {String}                   uri      path to feature file
     * @param {GherkinDocument.IFeature} feature  Cucumber feature object
     */
    //afterFeature: function (uri, feature) {
    //},

    /**
     * Runs after a WebdriverIO command gets executed
     * @param {String} commandName hook command name
     * @param {Array} args arguments that command would receive
     * @param {Number} result 0 - command success, 1 - command error
     * @param {Object} error error object if any
     */
    // afterCommand: function (commandName, args, result, error) {
    // },
    /**
     * Gets executed after all tests are done. You still have access to all global variables from
     * the test.
     * @param {Number} result 0 - test pass, 1 - test fail
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {Array.<String>} specs List of spec file paths that ran
     */
    //after: function (result, capabilities, specs) {
    //},
    /**
     * Gets executed right after terminating the webdriver session.
     * @param {Object} config wdio configuration object
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {Array.<String>} specs List of spec file paths that ran
     */
    // afterSession: function (config, capabilities, specs) {
    // },
    /**
     * Gets executed after all workers got shut down and the process is about to exit. An error
     * thrown in the onComplete hook will result in the test run failing.
     * @param {Object} exitCode 0 - success, 1 - fail
     * @param {Object} config wdio configuration object
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {<Object>} results object containing test results
     */
    onComplete: function (exitCode, config, capabilities, results) {
        endTime = new Date();
        let time = moment(startTime).format("YYYY_MM_DD_dddd_HH_mm");
        let repost = reportFolder + '/reportHtml/' + time;
        try {
            generate({
                jsonDir: reportFolder + '/json/',
                reportPath: repost + '/',

                metadata: {
                    browser: {
                        name: browserName
                    },
                    device: 'Local test machine',
                    platform: {
                        name: 'windows'
                    }
                },
                customData: {
                    title: 'Run info',
                    data: [
                        { label: 'Project', value: e2eConfig.appName },
                        { label: 'Browser', value: browserName },
                        { label: 'Environment', value: environment.toUpperCase() },
                        { label: 'Execution Start Time', value: moment(startTime).format("dddd h:mma D MMM YYYY") },
                        { label: 'Execution End Time', value: moment(endTime).format("dddd h:mma D MMM YYYY") }
                    ]
                }
            });
        } catch (error) {
                console.log('Error in results report generation:'+ error);
        }

    },
    /**
    * Gets executed when a refresh happens.
    * @param {String} oldSessionId session ID of the old session
    * @param {String} newSessionId session ID of the new session
    */
    //onReload: function(oldSessionId, newSessionId) {
    //}
}

