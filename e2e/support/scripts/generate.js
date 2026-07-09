#!/usr/bin/env node
/**
 * Replays recorded-session.json into e2e/features/generated/<cat>/*.feature
 * and e2e/locators/ files.
 */
const fs = require('fs');
const path = require('path');

require('ts-node/register');
const { convertToArtifacts } = require('../converter');
const {
  generatePageKey,
  registerPage,
  resolvePageLocatorPath,
  resolvePagesYamlPath,
  writePageLocatorsYaml,
} = require('../pageRegistry');

// Resolve against the caller's project root (cwd), not this package's own
// location — this script may run in-place or installed under node_modules.
const root = process.cwd();

// recorded-session.json lives at e2e/features/generated/
const sessionPath = path.join(root, 'e2e', 'features', 'generated', 'recorded-session.json');
const locatorRoot = path.join(root, 'e2e', 'locators');

if (!fs.existsSync(sessionPath)) {
  console.error(`Missing recorded-session.json at: ${path.relative(root, sessionPath)}`);
  console.error('Run "npm run pw", record, then click Generate.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const actions = data.actions || [];
const lastUrl = data.lastUrl || '';
const lastTitle = data.lastTitle || '';
const scenarioTitle = data.scenarioTitle || 'User flow';
const pageKey = generatePageKey({ stepName: data.pageKey || data.featureName || 'recordedflow' }, 0);

const featureDir = path.join(root, 'e2e', 'features', 'generated');
fs.mkdirSync(featureDir, { recursive: true });

const featurePath = path.join(featureDir, `${pageKey}.feature`);

const artifact = convertToArtifacts(actions, {
  scenarioTitle,
  scenarioUrl: lastUrl,
  featureFile: featurePath,
  pageKey,
  pageStepInput: { title: lastTitle },
});

fs.writeFileSync(featurePath, artifact.featureContent, 'utf8');

if (artifact.pageKey && artifact.pageMeta) {
  registerPage(resolvePagesYamlPath(locatorRoot), artifact.pageKey, artifact.pageMeta.title, artifact.pageMeta.label);
  writePageLocatorsYaml(resolvePageLocatorPath(pageKey, locatorRoot), artifact.locatorMap);
}

console.log('Wrote:', path.relative(root, featurePath));
console.log('Wrote:', path.relative(root, resolvePagesYamlPath(locatorRoot)));
console.log('Wrote:', path.relative(root, resolvePageLocatorPath(pageKey, locatorRoot)));
