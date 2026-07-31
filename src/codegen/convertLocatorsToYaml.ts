/**
 * Converts a project's JSON locator files to YAML - for teams migrating from
 * a JSON-locator (e.g. WDIO) setup who want to switch to YAML. Walks every
 * .json under e2e/locators/generated/** (plus e2e/locators/common.json) and
 * writes a sibling .yaml with the same content.
 *
 * JSON locators already LOAD without conversion (see locatorPaths /
 * LocatorStore) - this is only for teams who prefer to adopt YAML. Run via
 * `npx playwright-without-bdd-locators-to-yaml` (scripts/locators-to-yaml.js),
 * or call this function from a setup script.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CATEGORIES, LOCATOR_ROOT } from '../locators/locatorPaths';

function walkJson(dir: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJson(full, files);
    else if (entry.name.endsWith('.json')) files.push(full);
  }
}

function collectJsonLocatorFiles(): string[] {
  const files: string[] = [];
  for (const cat of CATEGORIES) walkJson(path.join(LOCATOR_ROOT, cat), files);
  const commonJson = path.resolve(LOCATOR_ROOT, '..', 'common.json');
  if (fs.existsSync(commonJson)) files.push(commonJson);
  return files;
}

export interface ConvertResult {
  /** .yaml files written. */
  converted: string[];
  /** .json files skipped because a .yaml sibling already existed (unless `overwrite`). */
  skipped: string[];
}

/** Converts every JSON locator file to a sibling YAML file. Skips ones whose .yaml already exists unless `overwrite` is true. */
export function convertLocatorsToYaml(options: { overwrite?: boolean } = {}): ConvertResult {
  const converted: string[] = [];
  const skipped: string[] = [];

  for (const jsonFile of collectJsonLocatorFiles()) {
    const yamlFile = jsonFile.replace(/\.json$/, '.yaml');
    if (fs.existsSync(yamlFile) && !options.overwrite) {
      skipped.push(jsonFile);
      continue;
    }
    try {
      const doc = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      fs.writeFileSync(yamlFile, yaml.dump(doc, { lineWidth: -1 }), 'utf8');
      converted.push(yamlFile);
    } catch {
      skipped.push(jsonFile);
    }
  }

  return { converted, skipped };
}
