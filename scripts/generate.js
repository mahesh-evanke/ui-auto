#!/usr/bin/env node
/**
 * Replays recorded-session.json into generated/*.feature, locators/pages.yaml,
 * and locators/pages/<pageKey>.yaml.
 */
const fs = require('fs');
const path = require('path');

require('ts-node/register');
const { convertToArtifacts } = require('../utils/converter');
const {
  generatePageKey,
  registerPage,
  resolvePageLocatorPath,
  resolvePagesYamlPath,
  writePageLocatorsYaml,
} = require('../utils/pageRegistry');

const root = path.join(__dirname, '..');
const sessionPath = path.join(root, 'recorded-session.json');
const locatorRoot = path.join(root, 'locators');

if (!fs.existsSync(sessionPath)) {
  console.error('Missing recorded-session.json. Run "npm run pw", record, then click Generate.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const actions = data.actions || [];
const lastUrl = data.lastUrl || '';
const lastTitle = data.lastTitle || '';
const scenarioTitle = data.scenarioTitle || 'User flow';
const pageKey = generatePageKey({ stepName: data.pageKey || data.featureName || 'recordedflow' }, 0);

const featureDir = path.join(root, 'generated');
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
