#!/usr/bin/env node
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
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * SDK CLI entrypoint.
 *
 * Consumer usage (from consumer repo root):
 * - npx ui-auto init
 * - npx ui-auto run --env val --tags "@smoke"
 */
const path = __importStar(require("path"));
const runTests_1 = require("./runner/runTests");
const scaffold_1 = require("./init/scaffold");
const consumerRoot_1 = require("./config/consumerRoot");
function parseArgs(argv) {
    const args = argv.slice(2);
    const command = args[0] && !args[0].startsWith('-') ? args[0] : 'run';
    const options = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (!a.startsWith('--'))
            continue;
        const key = a.slice(2);
        const next = args[i + 1];
        if (!next || next.startsWith('--')) {
            options[key] = true;
        }
        else {
            options[key] = next;
            i++;
        }
    }
    return { command, options };
}
function setEnvFromOptions(opts) {
    if (typeof opts.consumerRoot === 'string')
        process.env[consumerRoot_1.CONSUMER_ROOT_ENV] = path.resolve(opts.consumerRoot);
    if (typeof opts.config === 'string')
        process.env.UI_AUTO_CONFIG_PATH = path.resolve(opts.config);
    if (typeof opts.env === 'string')
        process.env.UI_AUTO_ENV = opts.env;
    if (typeof opts.tags === 'string')
        process.env.UI_AUTO_TAGS = opts.tags;
    if (typeof opts.browser === 'string')
        process.env.UI_AUTO_BROWSER = opts.browser;
    if (typeof opts.maxInstances === 'string')
        process.env.UI_AUTO_MAX_INSTANCES = opts.maxInstances;
    if (opts.headless === true || opts.headless === 'true')
        process.env.UI_AUTO_HEADLESS = 'true';
}
async function main() {
    const { command, options } = parseArgs(process.argv);
    setEnvFromOptions(options);
    if (command === 'init') {
        (0, scaffold_1.scaffold)({
            consumerRoot: typeof options.consumerRoot === 'string' ? path.resolve(options.consumerRoot) : undefined,
            force: options.force === true,
        });
        console.log('E2E structure created. Edit e2e/config/config.yaml, e2e/locators, and e2e/features, then run: npx ui-auto run');
        process.exit(0);
        return;
    }
    if (command !== 'run') {
        console.error(`Unknown command: ${command}. Supported: init, run`);
        process.exit(2);
    }
    const exitCode = await (0, runTests_1.runTests)();
    process.exit(exitCode);
}
main();
//# sourceMappingURL=cli.js.map