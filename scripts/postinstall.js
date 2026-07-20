/**
 * Scaffolds a consumer project's playwright.config.ts, tsconfig.json,
 * e2e/config/config.yaml, e2e/locators/common.yaml, and a starter
 * tests/example.spec.ts on first `npm install` of this package. Never
 * overwrites a file that already exists.
 *
 * Skipped when this package IS the project being installed (i.e. running
 * `npm install` inside this repo itself, not as a dependency of some other
 * project) — detected via INIT_CWD, which npm sets to the directory the
 * install was originally run from.
 */
const path = require('path');
const { runScaffold } = require('./scaffold');

const libraryRoot = path.resolve(__dirname, '..');
const consumerRoot = process.env.INIT_CWD || process.cwd();

if (path.resolve(consumerRoot) === path.resolve(libraryRoot)) {
  process.exit(0);
}

runScaffold(consumerRoot, libraryRoot);
