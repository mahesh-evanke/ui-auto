#!/usr/bin/env node
/**
 * CLI: converts a project's locator files between JSON and YAML - in either
 * direction. Plain JS (no ts-node needed), same convention as postinstall.js
 * and locators-to-yaml.js.
 *
 * Converted files are ALWAYS written to a SEPARATE output folder, never next
 * to the originals - the source tree is only ever read, never written to.
 * Relative structure under the source folder (category subfolders, page
 * names) is preserved under the output folder.
 *
 * Usage:
 *   node scripts/convert-locators.js to-yaml [--in <dir>] [--out <dir>] [--overwrite]
 *   node scripts/convert-locators.js to-json [--in <dir>] [--out <dir>] [--overwrite]
 *
 *   --in         Source folder to scan (default: e2e/locators/generated)
 *   --out        Output folder to write converted files into (default: the
 *                e2e/config/config.yaml `locators.convertedOutputDir` setting,
 *                or ./e2e/locators/converted if that isn't set)
 *   --overwrite  Overwrite a file that already exists at the destination
 *
 * npm scripts (see package.json): `npm run convert:locators:to-yaml` /
 * `npm run convert:locators:to-json`.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = process.cwd();
const PKG_NAME = 'wdio-playwright-library';

const direction = process.argv[2];
if (direction !== 'to-yaml' && direction !== 'to-json') {
  console.error(`[${PKG_NAME}] Usage: node scripts/convert-locators.js <to-yaml|to-json> [--in <dir>] [--out <dir>] [--overwrite]`);
  process.exit(1);
}
const targetExt = direction === 'to-yaml' ? 'yaml' : 'json';
const sourceExt = direction === 'to-yaml' ? 'json' : 'yaml';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function defaultOutputDir() {
  const cfgPath = path.join(root, 'e2e', 'config', 'config.yaml');
  if (fs.existsSync(cfgPath)) {
    try {
      const doc = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
      const configured = doc && doc.locators && doc.locators.convertedOutputDir;
      if (configured) return path.resolve(root, configured);
    } catch {
      // fall through to the hardcoded default below
    }
  }
  return path.join(root, 'e2e', 'locators', 'converted');
}

const inDir = path.resolve(root, argValue('--in') || path.join('e2e', 'locators', 'generated'));
let outDir = path.resolve(root, argValue('--out') || defaultOutputDir());
const overwrite = process.argv.includes('--overwrite');

// The whole point of this tool: never write converted files back into the
// folder they were read from. Guard against both an exact match and the
// output folder being nested inside (or equal to) the input folder.
const rel = path.relative(inDir, outDir);
if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
  console.error(
    `[${PKG_NAME}] Refusing to convert: --out (${outDir}) must be a separate folder from --in (${inDir}), not the same folder or a subfolder of it.`,
  );
  process.exit(1);
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(`.${sourceExt}`)) out.push(full);
  }
}

const files = [];
walk(inDir, files);

if (files.length === 0) {
  console.log(`[${PKG_NAME}] No .${sourceExt} files found under ${path.relative(root, inDir)} - nothing to convert.`);
  process.exit(0);
}

let converted = 0;
let skipped = 0;
for (const srcFile of files) {
  const relPath = path.relative(inDir, srcFile);
  const destFile = path.join(outDir, relPath.replace(new RegExp(`\\.${sourceExt}$`), `.${targetExt}`));

  if (fs.existsSync(destFile) && !overwrite) {
    console.log(`[${PKG_NAME}] skip (already exists): ${path.relative(root, destFile)}`);
    skipped++;
    continue;
  }

  try {
    const raw = fs.readFileSync(srcFile, 'utf8');
    const doc = sourceExt === 'json' ? JSON.parse(raw || '{}') : yaml.load(raw) || {};
    const out = targetExt === 'yaml' ? yaml.dump(doc, { lineWidth: -1 }) : JSON.stringify(doc, null, 2) + '\n';
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.writeFileSync(destFile, out, 'utf8');
    console.log(`[${PKG_NAME}] wrote: ${path.relative(root, destFile)}`);
    converted++;
  } catch (e) {
    console.log(`[${PKG_NAME}] skip (invalid ${sourceExt}): ${path.relative(root, srcFile)} - ${e.message}`);
    skipped++;
  }
}

console.log(`[${PKG_NAME}] convert-locators (${direction}) done - ${converted} converted, ${skipped} skipped. Output: ${path.relative(root, outDir)}`);
