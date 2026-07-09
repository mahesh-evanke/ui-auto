/**
 * Scaffolds a consumer project's cucumber.js, tsconfig.json, e2e/config/config.yaml,
 * e2e/locators/*, and a starter e2e/features/example.feature on first `npm install`
 * of this package. Never overwrites a file that already exists.
 *
 * Skipped when this package IS the project being installed (i.e. running `npm install`
 * inside this repo itself, not as a dependency of some other project) — detected via
 * INIT_CWD, which npm sets to the directory the install was originally run from.
 */
const fs = require('fs');
const path = require('path');

const PKG_NAME = 'wdio-playwright-library';
const libraryRoot = path.resolve(__dirname, '..');
const consumerRoot = process.env.INIT_CWD || process.cwd();

if (path.resolve(consumerRoot) === path.resolve(libraryRoot)) {
  process.exit(0);
}

function writeIfMissing(relPath, content) {
  const fp = path.join(consumerRoot, relPath);
  if (fs.existsSync(fp)) {
    console.log(`[${PKG_NAME}] skip (already exists): ${relPath}`);
    return;
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
  console.log(`[${PKG_NAME}] created: ${relPath}`);
}

writeIfMissing(
  'cucumber.js',
  `// Points require at this package's step definitions inside node_modules.
module.exports = {
  default: {
    paths: ['e2e/features/**/*.feature'],
    require: ['node_modules/${PKG_NAME}/e2e/stepdefinitions/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: ['progress'],
  },
};
`,
);

writeIfMissing(
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
      // ts-node ignores node_modules by default; this override lets it transpile
      // this one package's .ts files despite living under node_modules.
      'ts-node': {
        transpileOnly: true,
        ignore: [`node_modules/(?!${PKG_NAME})`],
      },
    },
    null,
    2,
  ) + '\n',
);

const templateConfig = path.join(libraryRoot, 'e2e', 'config', 'config.yaml');
writeIfMissing(
  'e2e/config/config.yaml',
  fs.existsSync(templateConfig) ? fs.readFileSync(templateConfig, 'utf8') : '',
);

writeIfMissing('e2e/locators/common.yaml', '');
writeIfMissing('e2e/locators/pages.yaml', '');

writeIfMissing(
  'e2e/features/example.feature',
  `Feature: Example smoke test (runs against the installed ${PKG_NAME})

  Scenario: Verify the-internet homepage loads
    Given User navigates to "https://the-internet.herokuapp.com/" URL
    When verify "Welcome to the-internet" text is present on the screen
`,
);

console.log(
  `[${PKG_NAME}] Scaffold complete. Next: npm install --save-dev ts-node@^10.9.2 typescript@^5.7.2` +
    ` (pin these — ts-node 10 does not support typescript 7's native compiler), then run: npx cucumber-js`,
);
