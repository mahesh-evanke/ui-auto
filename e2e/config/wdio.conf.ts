import {Options} from '@wdio/types';
import { PageConfigHelper } from "../support/misc-utils/PageHelper";
import { generate } from 'multiple-cucumber-html-reporter';
import { removeSync } from 'fs-extra';
import cucumberJson from 'wdio-cucumberjs-json-reporter';
import moment from 'moment';
import * as  fs from 'fs';
import * as  glob from 'glob';
import * as yamlReader from 'js-yaml';
import { parseFeatureFile } from '../support/misc-utils/gherkin-parser';

const e2eConfig = yamlReader.load(fs.readFileSync('e2e/config/config.yaml', 'utf8'));
const executionMode = e2eConfig.executionMode.toUpperCase();
const environment = e2eConfig.environment.toUpperCase();
const reportFolder = e2eConfig.reportFolder;

// WDIO v9 has built-in driver management. Legacy driver service packages like
// `wdio-chromedriver-service` / `wdio-edgedriver-service` are not compatible with v9.
// We keep services empty by default and rely on local driver binaries (if provided)
// via capabilities to avoid downloads.
let runServices: string[] = [];
let baseUrl = null;
let browserName = e2eConfig.browserName.toUpperCase();

if (environment == 'VAL')
    baseUrl = e2eConfig.valUrl;
else if (environment == 'DEV')
    baseUrl = e2eConfig.devUrl;
else if (environment == 'STANDALONE') 
    baseUrl = e2eConfig.standaloneUrl
else{
    console.log('Incorrect environment value');
    process.exit();
}

console.log('Application URL: '+baseUrl)

if (browserName == 'IE') {
    browserName = 'internet explorer';
} else if (browserName == 'CHROME') {
    browserName = 'chrome';
    if(e2eConfig.chromedriverpath != '<path>' && e2eConfig.chromedriverpath != '')
        process.env['CHROMEDRIVER_FILEPATH'] = e2eConfig.chromedriverpath;
} else if (browserName == 'EDGE') {
    browserName = 'MicrosoftEdge';
    if(e2eConfig.edgedriverpath != '<path>' && e2eConfig.edgedriverpath != '')
        process.env['EDGEDRIVER_PATH'] = e2eConfig.edgedriverpath;
}

let port, protocol, seleniumAddressVal;

// In LOCAL mode we run a direct local session (no Selenium server), relying on
// WDIO's driver manager and/or local driver binaries configured in capabilities.
// In GRID/SELENIUMBOX we connect to a remote Selenium endpoint.
if (executionMode == 'GRID') {
    seleniumAddressVal = e2eConfig.seleniumAddress;
    runServices = [];
} else if (executionMode == 'SELENIUMBOX') {
    seleniumAddressVal = e2eConfig.seleniumBoxAddress;
    runServices = [];
    port = 443;
    protocol = 'https'
}

const paths = glob.sync(e2eConfig.features);
const tags = e2eConfig.tags.split(/[, ]+/);

var features = [];
pathloop: for (let path of paths) {
    try {
        const parsed = parseFeatureFile(path);
        for (const tag of parsed.featureTags) {
            if (tags.includes(tag)) {
                features.push(path.replace('e2e\\', '..\\'));
                continue pathloop;
            }
        }
        for (const scenario of parsed.scenarios) {
            for (const tag of scenario.tags) {
                if (tags.includes(tag)) {
                    features.push(path.replace('e2e\\', '..\\'));
                    continue pathloop;
                }
            }
        }
    } catch (error) {
        // ignore malformed/unparseable feature files
    }
}
let featuresFiles = Array.from(new Set(features));
let startTime;
let endTime;

// WDIO capability objects can include vendor-specific keys (e.g. `wdio:*`).
// The `@wdio/types` TypeScript types don't always model these keys, so we keep
// the capability object loosely typed to avoid blocking valid config.
const baseCapability: any = {
    // maxInstances can get overwritten per capability. So if you have an in-house Selenium
    // grid with only 5 firefox instances available you can make sure that not more than
    // 5 instances get started at a time.
    maxInstances: e2eConfig.maxInstances,
    browserName: browserName,
    // If a local driver binary path is provided, force WebdriverIO to use it.
    // This prevents auto-downloading a driver in environments where downloads are restricted.
    ...(browserName === 'MicrosoftEdge' && e2eConfig.edgedriverpath && e2eConfig.edgedriverpath !== '<path>' ? {
        'wdio:edgedriverOptions': { binary: e2eConfig.edgedriverpath }
    } : {}),
    ...(browserName === 'chrome' && e2eConfig.chromedriverpath && e2eConfig.chromedriverpath !== '<path>' ? {
        'wdio:chromedriverOptions': { binary: e2eConfig.chromedriverpath }
    } : {}),
    'e34:l_testName': e2eConfig.seleniumBoxTestName,
    'e34:video': e2eConfig.seleniumBoxVideoSw,
    'e34:userId': e2eConfig.seleniumBoxId,
    'e34:token': e2eConfig.seleniumBoxToken,
    'e34:projectId': e2eConfig.seleniumBoxProjectName,
    'e34:credential': e2eConfig.seleniumBoxCredential,
};

export const config: any = {
    services: runServices,
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
    maxInstances: e2eConfig.maxInstances,
    //
    // If you have trouble getting all important capabilities together, check out the
    // Sauce Labs platform configurator - a great tool to configure your capabilities:
    // https://saucelabs.com/platform/platform-configurator
    //
    capabilities: [baseCapability],
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
    waitforTimeout: e2eConfig.allScriptsTimeout,
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
    ...(executionMode === 'LOCAL' ? {} : {
        hostname: seleniumAddressVal,
        port: port,
        path: '/wd/hub/',
        protocol: protocol,
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
        // <string[]> ("extension:module") require files with the given EXTENSION after requiring MODULE (repeatable)
        requireModule: [],
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
        // <string> (expression) only execute the features or scenarios with tags matching the expression
        tagExpression: e2eConfig.tags,
        // <number> timeout for step definitions
        timeout: e2eConfig.getPageTimeout,
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
    onPrepare: function (config, capabilities) {
        removeSync(reportFolder);
        startTime = new Date();
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
    beforeScenario: async function (world, context) {
        global.environment = environment;
        global.browseName = browserName;
        PageConfigHelper.sameScenarioSwitch = false;
        const scenarioName = world.pickle.name;
        if (scenarioName.trim() === PageConfigHelper.getScenarioName()) {
            PageConfigHelper.sameScenarioSwitch = true;
        }
        else {
            PageConfigHelper.sameScenarioSwitch = false;
            await browser.deleteAllCookies();
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
    afterScenario: async function (world, result, context) {
        if (!result.passed) {
            const scrollHeight = parseInt(await browser.execute("return document.body.scrollHeight") as unknown as string);
            const clientHeight = parseInt(await browser.execute("return document.body.clientHeight") as unknown as string);
            const num = Math.ceil(scrollHeight / clientHeight);
            for (let i = 0; i < num; i++) {
                let height = i * clientHeight;
                await browser.execute("window.scrollTo(0," + height + ");");
                await takeScreenshot(i);
                cucumberJson.attach(await browser.takeScreenshot() as unknown as string, 'image/png');
            }
        }
        async function takeScreenshot(num: number) {
            await browser.takeScreenshot().then(function (png) {
                var dir = reportFolder + '/screenshot';
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                const time = moment(new Date()).format("yyyy_MM_DD__HH_mm_ss_SSS");
                dir = dir + "/failure_" + time + "_" + num + ".png"
                var stream = fs.createWriteStream(dir);
                stream.write(Buffer.from(png, 'base64'));
                stream.end();
            });
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
        let repost = "e2e/reportHtml/" + time;
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

