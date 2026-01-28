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
exports.scaffold = scaffold;
/**
 * Scaffolds e2e folder structure, config, locators, a basic feature file, and step-definitions reference.
 * Used by `ui-auto init` and postinstall. Consumers never create folders manually.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const consumerRoot_1 = require("../config/consumerRoot");
/** Path to GHERKIN_STEP_DEFINITIONS.md next to scaffold (copied there at build). */
const STEP_DEFS_PATH = path.join(__dirname, 'GHERKIN_STEP_DEFINITIONS.md');
const DEFAULT_CONFIG_YAML = `executionMode: local
browserName: chrome
environment: val
tags: "@smoke"
maxInstances: 1
reportFolder: ./reports/integrationTests
allScriptsTimeout: 11000
getPageTimeout: 40000
features: "./e2e/features/**/*.feature"
valUrl: http://localhost:4200/
devUrl: http://localhost:4200/
standaloneUrl: http://localhost:4200/
`;
const DEFAULT_COMMON_JSON = `{}
`;
const DEFAULT_PAGES_JSON = `{
  "Login Page": [{"title": "Your App", "label": "Login"}],
  "Home": [{"title": "Your App", "label": "Home"}]
}
`;
const DEFAULT_LOGIN_PAGE_JSON = `{
  "Username": ["id", "username"],
  "Password": ["id", "password"],
  "Login": ["id", "login-btn"]
}
`;
const DEFAULT_LOGIN_FEATURE = `@smoke @login
Feature: Login

  Scenario: User can log in
    Given User navigates to "http://localhost:4200/" URL
    And User is on "Login Page" screen
    And enters "user@example.com" text in "Username" textbox
    And enters "password" text in "Password" textbox
    When User clicks on "Login" button
    Then User is on "Home" screen
`;
function scaffold(opts = {}) {
    const root = opts.consumerRoot ? path.resolve(opts.consumerRoot) : (0, consumerRoot_1.getConsumerRoot)();
    const force = Boolean(opts.force);
    const dirs = [
        path.join(root, 'e2e', 'config'),
        path.join(root, 'e2e', 'features'),
        path.join(root, 'e2e', 'locators'),
        path.join(root, 'e2e', 'locators', 'pages'),
    ];
    for (const d of dirs) {
        fs.mkdirSync(d, { recursive: true });
    }
    const files = [
        { path: path.join(root, 'e2e', 'config', 'config.yaml'), content: DEFAULT_CONFIG_YAML },
        { path: path.join(root, 'e2e', 'locators', 'common.json'), content: DEFAULT_COMMON_JSON },
        { path: path.join(root, 'e2e', 'locators', 'pages.json'), content: DEFAULT_PAGES_JSON },
        { path: path.join(root, 'e2e', 'locators', 'pages', 'Login Page.json'), content: DEFAULT_LOGIN_PAGE_JSON },
        { path: path.join(root, 'e2e', 'features', 'login.feature'), content: DEFAULT_LOGIN_FEATURE },
    ];
    const stepDefsContent = fs.existsSync(STEP_DEFS_PATH)
        ? fs.readFileSync(STEP_DEFS_PATH, 'utf8')
        : '';
    if (stepDefsContent) {
        files.push({
            path: path.join(root, 'e2e', 'GHERKIN_STEP_DEFINITIONS.md'),
            content: stepDefsContent,
        });
    }
    for (const { path: filePath, content } of files) {
        if (!force && fs.existsSync(filePath))
            continue;
        fs.writeFileSync(filePath, content, 'utf8');
    }
}
//# sourceMappingURL=scaffold.js.map