/**
 * Scaffolds e2e folder structure, config, locators, a basic feature file, and step-definitions reference.
 * Used by `ui-auto init` and postinstall. Consumers never create folders manually.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getConsumerRoot } from '../config/consumerRoot';

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

export interface ScaffoldOptions {
  consumerRoot?: string;
  force?: boolean;
}

export function scaffold(opts: ScaffoldOptions = {}): void {
  const root = opts.consumerRoot ? path.resolve(opts.consumerRoot) : getConsumerRoot();
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

  const files: Array<{ path: string; content: string }> = [
    { path: path.join(root, 'e2e', 'config', 'config.yaml'), content: DEFAULT_CONFIG_YAML },
    { path: path.join(root, 'e2e', 'locators', 'common.json'), content: DEFAULT_COMMON_JSON },
    { path: path.join(root, 'e2e', 'locators', 'pages.json'), content: DEFAULT_PAGES_JSON },
    { path: path.join(root, 'e2e', 'locators', 'pages', 'Login Page.json'), content: DEFAULT_LOGIN_PAGE_JSON },
    { path: path.join(root, 'e2e', 'features', 'login.feature'), content: DEFAULT_LOGIN_FEATURE },
  ];

  const stepDefsContent = fs.existsSync(STEP_DEFS_PATH) ? fs.readFileSync(STEP_DEFS_PATH, 'utf8') : '';
  if (stepDefsContent) {
    files.push({
      path: path.join(root, 'e2e', 'GHERKIN_STEP_DEFINITIONS.md'),
      content: stepDefsContent,
    });
  }

  for (const { path: filePath, content } of files) {
    if (!force && fs.existsSync(filePath)) continue;
    fs.writeFileSync(filePath, content, 'utf8');
  }
}
