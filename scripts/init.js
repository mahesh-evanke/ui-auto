#!/usr/bin/env node
/**
 * Manual scaffold entry point: `npx playwright-without-bdd-init`. Runs the
 * same scaffold as postinstall.js, but on demand - for package managers that
 * skip lifecycle scripts (pnpm's default, `npm install --ignore-scripts`),
 * or to re-scaffold a project that deleted a generated file.
 */
const fs = require('fs');
const path = require('path');
const { runScaffold, PKG_NAME } = require('./scaffold');

const libraryRoot = path.resolve(__dirname, '..');
const consumerRoot = process.cwd();

if (path.resolve(consumerRoot) === path.resolve(libraryRoot)) {
  console.log(`[${PKG_NAME}] Refusing to scaffold into the library's own repo - run this from a consumer project instead.`);
  process.exit(1);
}

if (!fs.existsSync(path.join(consumerRoot, 'package.json'))) {
  console.log(`[${PKG_NAME}] No package.json found in ${consumerRoot} - run this from the root of your project.`);
  process.exit(1);
}

runScaffold(consumerRoot, libraryRoot);
