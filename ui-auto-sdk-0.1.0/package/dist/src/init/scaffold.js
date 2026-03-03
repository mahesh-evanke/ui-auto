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
 * Scaffolds e2e folder structure, config, locators, and sample feature files.
 * Used by `ui-auto init` and postinstall. e2e/generated and e2e/features are always created.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const consumerRoot_1 = require("../config/consumerRoot");
const STEP_DEFS_PATH = path.join(__dirname, 'GHERKIN_STEP_DEFINITIONS.md');
const SETUP_GUIDE_PATH = path.join(__dirname, 'SETUP_GUIDE.md');
const CONFIG_TEMPLATE_PATH = path.join(__dirname, 'config-template.yaml');
function getConfigContent() {
    if (fs.existsSync(CONFIG_TEMPLATE_PATH)) {
        return fs.readFileSync(CONFIG_TEMPLATE_PATH, 'utf8');
    }
    return '';
}
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
const SAMPLE_WEB_FEATURE = `@smoke
Feature: Login

  Scenario: User can log in
    Given User navigates to "http://localhost:4200/" URL
    And User is on "Login Page" screen
    And enters "user@example.com" text in "Username" textbox
    And enters "password" text in "Password" textbox
    When User clicks on "Login" button
    Then User is on "Home" screen
`;
const SAMPLE_WEBUI_API_FEATURE = `@webui-api @smoke
Feature: Web UI + API Integration

  Scenario: Sample E2E flow
    Given User navigates to "http://localhost:4200/" URL
    And User is on "Login Page" screen
    And enters "user@example.com" text in "Username" textbox
    And enters "password" text in "Password" textbox
    When clicks on "Login" button
    Given User sends GET request to "https://api.example.com/user"
    Then User expects status code 200
`;
const SAMPLE_MOBILE_FEATURE = `@smoke @mobile
Feature: Mobile - Sample

  Scenario: Open app and verify screen
    Given User navigates to "http://localhost:4200/" URL
    And User is on "Login Page" screen
`;
const SAMPLE_API_EXAMPLE_FEATURE = `@smoke @api
Feature: API - Sample

  Scenario: Create a booking via REST API
    Given User sends POST request to "https://restful-booker.herokuapp.com/booking" with body:
      | path                          | value          |
      | firstname                     | "James"        |
      | lastname                      | "Brown"        |
      | totalprice                    | 111            |
      | depositpaid                   | true           |
      | bookingdates.checkin          | "2018-01-01"   |
      | bookingdates.checkout         | "2019-01-01"   |
      | additionalneeds               | "Breakfast"    |
    Then User expects status code 200
`;
const SAMPLE_DB_EXAMPLE_FEATURE = `@database @smoke
Feature: Database - Sample

  Scenario: Verify table has rows
    # DB connection from e2e/config/config.yaml
    Then the database table "users" should have at least 1 row(s)
`;
function scaffold(opts = {}) {
    const root = opts.consumerRoot ? path.resolve(opts.consumerRoot) : (0, consumerRoot_1.getConsumerRoot)();
    const force = Boolean(opts.force);
    const web = Boolean(opts.web);
    const api = Boolean(opts.api);
    const webuiApi = Boolean(opts.webuiApi);
    const db = Boolean(opts.db);
    const mobile = Boolean(opts.mobile);
    const dirs = [
        path.join(root, 'e2e', 'config'),
        path.join(root, 'e2e', 'generated'),
        path.join(root, 'e2e', 'features'),
    ];
    if (web) {
        dirs.push(path.join(root, 'e2e', 'features', 'web', 'features'), path.join(root, 'e2e', 'features', 'web', 'locators'), path.join(root, 'e2e', 'features', 'web', 'locators', 'pages'), path.join(root, 'e2e', 'generated', 'web', 'features'), path.join(root, 'e2e', 'generated', 'web', 'locators'), path.join(root, 'e2e', 'generated', 'web', 'locators', 'pages'));
    }
    if (api) {
        // For API suites, create example feature under e2e/features/api and e2e/generated/api (no inner features/ folder).
        dirs.push(path.join(root, 'e2e', 'features', 'api'), path.join(root, 'e2e', 'generated', 'api'));
    }
    if (webuiApi) {
        dirs.push(path.join(root, 'e2e', 'features', 'end-to-end', 'features'), path.join(root, 'e2e', 'features', 'end-to-end', 'locators'), path.join(root, 'e2e', 'features', 'end-to-end', 'locators', 'pages'), path.join(root, 'e2e', 'generated', 'end-to-end', 'features'));
    }
    if (db) {
        // For database suites, create example feature under e2e/features/db and e2e/generated/db (no inner features/ folder).
        dirs.push(path.join(root, 'e2e', 'features', 'db'), path.join(root, 'e2e', 'generated', 'db'));
    }
    if (mobile) {
        dirs.push(path.join(root, 'e2e', 'features', 'mobile', 'features'), path.join(root, 'e2e', 'generated', 'mobile', 'features'));
    }
    for (const d of dirs) {
        fs.mkdirSync(d, { recursive: true });
    }
    const configContent = getConfigContent();
    const files = [];
    if (configContent) {
        files.push({ path: path.join(root, 'e2e', 'config', 'config.yaml'), content: configContent });
    }
    if (web) {
        files.push({ path: path.join(root, 'e2e', 'features', 'web', 'locators', 'common.json'), content: DEFAULT_COMMON_JSON }, { path: path.join(root, 'e2e', 'features', 'web', 'locators', 'pages.json'), content: DEFAULT_PAGES_JSON }, { path: path.join(root, 'e2e', 'features', 'web', 'locators', 'pages', 'Login Page.json'), content: DEFAULT_LOGIN_PAGE_JSON }, { path: path.join(root, 'e2e', 'features', 'web', 'features', 'sample_login.feature'), content: SAMPLE_WEB_FEATURE });
    }
    if (api) {
        files.push({ path: path.join(root, 'e2e', 'features', 'api', 'example.feature'), content: SAMPLE_API_EXAMPLE_FEATURE }, { path: path.join(root, 'e2e', 'generated', 'api', 'example.feature'), content: SAMPLE_API_EXAMPLE_FEATURE });
    }
    if (webuiApi) {
        files.push({ path: path.join(root, 'e2e', 'features', 'end-to-end', 'features', 'sample_webui_api.feature'), content: SAMPLE_WEBUI_API_FEATURE }, { path: path.join(root, 'e2e', 'features', 'end-to-end', 'locators', 'common.json'), content: DEFAULT_COMMON_JSON }, { path: path.join(root, 'e2e', 'features', 'end-to-end', 'locators', 'pages.json'), content: DEFAULT_PAGES_JSON }, { path: path.join(root, 'e2e', 'features', 'end-to-end', 'locators', 'pages', 'Login Page.json'), content: DEFAULT_LOGIN_PAGE_JSON });
    }
    if (mobile) {
        files.push({ path: path.join(root, 'e2e', 'features', 'mobile', 'features', 'sample_mobile.feature'), content: SAMPLE_MOBILE_FEATURE });
    }
    if (db) {
        files.push({ path: path.join(root, 'e2e', 'features', 'db', 'example.feature'), content: SAMPLE_DB_EXAMPLE_FEATURE }, { path: path.join(root, 'e2e', 'generated', 'db', 'example.feature'), content: SAMPLE_DB_EXAMPLE_FEATURE });
    }
    const stepDefsContent = fs.existsSync(STEP_DEFS_PATH) ? fs.readFileSync(STEP_DEFS_PATH, 'utf8') : '';
    if (stepDefsContent) {
        files.push({
            path: path.join(root, 'e2e', 'GHERKIN_STEP_DEFINITIONS.md'),
            content: stepDefsContent,
        });
    }
    const setupGuideContent = fs.existsSync(SETUP_GUIDE_PATH) ? fs.readFileSync(SETUP_GUIDE_PATH, 'utf8') : '';
    if (setupGuideContent) {
        files.push({
            path: path.join(root, 'e2e', 'SETUP_GUIDE.md'),
            content: setupGuideContent,
        });
    }
    for (const { path: filePath, content } of files) {
        if (!force && fs.existsSync(filePath))
            continue;
        fs.writeFileSync(filePath, content, 'utf8');
    }
}
//# sourceMappingURL=scaffold.js.map