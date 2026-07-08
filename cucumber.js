// Consumer config: features live in this repo, step definitions come from the
// installed wdio-playwright-library package (see tsconfig.json's ts-node.ignore
// override, which lets ts-node transpile that one package's .ts files).
module.exports = {
  default: {
    paths: ['e2e/features/**/*.feature'],
    require: ['node_modules/wdio-playwright-library/e2e/stepdefinitions/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: ['progress', 'html:test-results/cucumber-report.html'],
  },
};
