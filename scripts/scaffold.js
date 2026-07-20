/**
 * Shared scaffold logic for a consumer project's playwright.config.ts,
 * tsconfig.json, e2e/config/config.yaml, e2e/locators/common.yaml, and a
 * starter tests/example.spec.ts. Never overwrites a file that already
 * exists. Used by both postinstall.js (runs automatically on `npm install`)
 * and init.js (run manually via `npx playwright-without-bdd-init`, for
 * package managers that skip lifecycle scripts, or re-scaffolding after the
 * fact).
 */
const fs = require('fs');
const path = require('path');

const PKG_NAME = 'playwright-without-bdd-library';

function writeIfMissing(consumerRoot, relPath, content) {
  const fp = path.join(consumerRoot, relPath);
  if (fs.existsSync(fp)) {
    console.log(`[${PKG_NAME}] skip (already exists): ${relPath}`);
    return;
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
  console.log(`[${PKG_NAME}] created: ${relPath}`);
}

/** Merge keys into the consumer's package.json under `field`, never overwriting an existing key. */
function mergePackageJsonField(consumerRoot, field, entries) {
  const pkgPath = path.join(consumerRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    console.log(`[${PKG_NAME}] skip package.json merge (invalid JSON)`);
    return;
  }
  pkg[field] = pkg[field] || {};
  let changed = false;
  for (const [key, value] of Object.entries(entries)) {
    if (Object.prototype.hasOwnProperty.call(pkg[field], key)) continue;
    pkg[field][key] = value;
    changed = true;
  }
  if (!changed) return;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`[${PKG_NAME}] merged package.json "${field}"`);
}

function runScaffold(consumerRoot, libraryRoot) {
  writeIfMissing(
    consumerRoot,
    'playwright.config.ts',
    `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  reporter: [['html', { outputFolder: 'reports/integrationTests', open: 'never' }], ['list']],
  use: {
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
});
`,
  );

  writeIfMissing(
    consumerRoot,
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'commonjs',
          lib: ['ES2022', 'DOM'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          moduleResolution: 'node',
        },
      },
      null,
      2,
    ) + '\n',
  );

  const templateConfig = path.join(libraryRoot, 'e2e', 'config', 'config.yaml');
  writeIfMissing(consumerRoot, 'e2e/config/config.yaml', fs.existsSync(templateConfig) ? fs.readFileSync(templateConfig, 'utf8') : '');

  writeIfMissing(consumerRoot, 'e2e/locators/common.yaml', '');

  writeIfMissing(
    consumerRoot,
    'tests/example.spec.ts',
    `import { test, expect } from '${PKG_NAME}';

test('homepage loads', async ({ webActions }) => {
  await webActions.navigate('https://the-internet.herokuapp.com/');
  await webActions.verifyTextPresent('Welcome to the-internet');
});
`,
  );

  mergePackageJsonField(consumerRoot, 'scripts', {
    test: 'playwright test',
    'test:headed': 'playwright test --headed',
    'test:ui': 'playwright test --ui',
    report: 'playwright show-report reports/integrationTests',
  });

  console.log(
    `[${PKG_NAME}] Scaffold complete. Next: npx playwright install, then: npm test` +
      ` (this package has no test cases of its own — write your *.spec.ts files under tests/,` +
      ` importing { test, expect } from '${PKG_NAME}').`,
  );
}

module.exports = { runScaffold, PKG_NAME };
