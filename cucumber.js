const formats = ['progress'];
// HTML report shows attachments (e.g. "Fix with AI" markdown). Disable with CUCUMBER_HTML_REPORT=0
if (process.env.CUCUMBER_HTML_REPORT !== '0') {
  formats.push('html:test-results/cucumber-report.html');
}

module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: ['steps-def/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: formats,
  },
};
