const formats = ['progress'];
// HTML report shows attachments (e.g. "Fix with AI" markdown). Disable with CUCUMBER_HTML_REPORT=0
if (process.env.CUCUMBER_HTML_REPORT !== '0') {
  formats.push('html:test-results/cucumber-report.html');
}

module.exports = {
  default: {
    // No default paths: scripts/run.js always passes explicit feature paths,
    // so those are authoritative (passing a single file runs ONLY that file).
    // (Features now live under feature/generated/<category>/.)
    paths: [],
    require: ['e2e/stepdefinitions/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: formats,
  },
};
