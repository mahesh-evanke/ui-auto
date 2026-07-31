#!/usr/bin/env node
/**
 * CLI: converts a project's JSON locator files to YAML - standalone plain JS
 * so it runs under plain `node` without a TS loader, like the other scripts.
 * Walks e2e/locators/generated/** (plus e2e/locators/common.json) and writes
 * a sibling .yaml for each .json. Skips ones whose .yaml already exists unless
 * you pass --overwrite.
 *
 * Usage (from a consumer project): npx playwright-without-bdd-locators-to-yaml
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = process.cwd();
const locatorRoot = path.join(root, 'e2e', 'locators', 'generated');
const categories = ['web', 'api', 'endtoend'];
const overwrite = process.argv.includes('--overwrite');

function walkJson(dir, files) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJson(full, files);
    else if (entry.name.endsWith('.json')) files.push(full);
  }
}

const files = [];
for (const cat of categories) walkJson(path.join(locatorRoot, cat), files);
const commonJson = path.join(root, 'e2e', 'locators', 'common.json');
if (fs.existsSync(commonJson)) files.push(commonJson);

let converted = 0;
let skipped = 0;
for (const jsonFile of files) {
  const yamlFile = jsonFile.replace(/\.json$/, '.yaml');
  if (fs.existsSync(yamlFile) && !overwrite) {
    console.log(`[playwright-without-bdd-library] skip (yaml exists): ${path.relative(root, jsonFile)}`);
    skipped++;
    continue;
  }
  try {
    const doc = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    fs.writeFileSync(yamlFile, yaml.dump(doc, { lineWidth: -1 }), 'utf8');
    console.log(`[playwright-without-bdd-library] wrote: ${path.relative(root, yamlFile)}`);
    converted++;
  } catch (e) {
    console.log(`[playwright-without-bdd-library] skip (invalid JSON): ${path.relative(root, jsonFile)}`);
    skipped++;
  }
}

console.log(`[playwright-without-bdd-library] locators-to-yaml done - ${converted} converted, ${skipped} skipped.`);
