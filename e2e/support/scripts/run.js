/**
 * Easy runner for one or many feature files.
 *
 * Usage (no "--" needed):
 *   node e2e/support/scripts/run.js login.feature
 *   node e2e/support/scripts/run.js web              (runs every feature under generated/web)
 *   node e2e/support/scripts/run.js                  (runs ALL features)
 *
 * Accepts: full/relative paths, bare filenames (auto-found), or a category
 * (endtoend | web | api). Works on Windows paths with spaces.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// e2e/support/scripts/ → project root (3 levels up)
const ROOT = path.resolve(__dirname, '..', '..', '..');

const SEARCH_DIRS = [
  path.join(ROOT, 'e2e', 'features'), // covers generated/ and hand-written features recursively
];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.feature')) out.push(full);
  }
}

function allFeatureFiles() {
  const out = [];
  for (const d of SEARCH_DIRS) walk(d, out);
  return out;
}

const CATEGORIES = ['endtoend', 'web', 'api'];

function filesInCategory(all, cat) {
  return all.filter((f) => f.includes(`${path.sep}generated${path.sep}${cat}${path.sep}`));
}

function resolveArg(arg) {
  const norm = arg.replace(/\\/g, '/').replace(/^\/+/, '');

  const direct = path.isAbsolute(arg) ? arg : path.join(ROOT, norm);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return [direct];

  const all = allFeatureFiles();

  if (CATEGORIES.includes(norm)) {
    const m = filesInCategory(all, norm);
    if (m.length) return m;
  }

  const globMatch = norm.match(/^(endtoend|web|api)\/\*(?:\.feature)?$/);
  if (globMatch) {
    const m = filesInCategory(all, globMatch[1]);
    if (m.length) return m;
  }

  const catName = norm.match(/^(endtoend|web|api)\/(.+?)(?:\.feature)?$/);
  if (catName) {
    const [, cat, name] = catName;
    const m = filesInCategory(all, cat).filter(
      (f) => path.basename(f).toLowerCase() === `${name}.feature`.toLowerCase(),
    );
    if (m.length) return m;
  }

  const wanted = norm.endsWith('.feature') ? norm : `${norm}.feature`;
  const byName = all.filter((f) => path.basename(f).toLowerCase() === wanted.toLowerCase());
  if (byName.length) return byName;

  const bySub = all.filter((f) => f.toLowerCase().includes(norm.toLowerCase()));
  if (bySub.length) return bySub;

  return [];
}

let rawArgs = process.argv.slice(2);
const listOnly = rawArgs.includes('--list') || rawArgs.includes('-l');
rawArgs = rawArgs.filter((a) => a !== '--list' && a !== '-l');

let cliTags = '';
{
  const out = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--tags' || a === '-t') { cliTags = rawArgs[++i] || ''; continue; }
    const m = a.match(/^--tags=(.*)$/);
    if (m) { cliTags = m[1]; continue; }
    if (/^@[\w@\s()andornot-]+$/i.test(a) && a.startsWith('@')) { cliTags = cliTags ? `${cliTags} and ${a}` : a; continue; }
    out.push(a);
  }
  rawArgs = out;
}

let featurePaths = [];

if (rawArgs.length === 0) {
  featurePaths = allFeatureFiles();
  if (!featurePaths.length) {
    console.error('No .feature files found under e2e/features/generated/.');
    process.exit(1);
  }
  console.log(`Running ALL ${featurePaths.length} feature file(s).`);
} else {
  for (const arg of rawArgs) {
    const resolved = resolveArg(arg);
    if (!resolved.length) {
      console.error(`✗ Could not find a feature file for: "${arg}"`);
      process.exit(1);
    }
    featurePaths.push(...resolved);
  }
  featurePaths = [...new Set(featurePaths)];
  console.log(`Running ${featurePaths.length} feature file(s):`);
  featurePaths.forEach((f) => console.log('  - ' + path.relative(ROOT, f).split(path.sep).join('/')));
}

if (listOnly) process.exit(0);

// ── Read e2e/config/config.yaml for reportFolder + maxInstances + tags ────────
function readConfig() {
  try {
    const yaml = require('js-yaml');
    const cfgPath = path.join(ROOT, 'e2e', 'config', 'config.yaml');
    if (!fs.existsSync(cfgPath)) return {};
    const doc = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
    return (doc && doc.run) || {};
  } catch {
    return {};
  }
}
const runCfg = readConfig();
const reportFolder = String(runCfg.reportFolder || './reports/integrationTests').replace(/\/+$/, '');
const maxInstances = Number(runCfg.maxInstances) || 1;
const tags = String(runCfg.tags || '').trim();

const reportDirAbs = path.isAbsolute(reportFolder) ? reportFolder : path.join(ROOT, reportFolder);
fs.mkdirSync(reportDirAbs, { recursive: true });
const htmlReportRel = path
  .relative(ROOT, path.join(reportDirAbs, 'cucumber-report.html'))
  .split(path.sep)
  .join('/');

const cucumberEntry = path.join(ROOT, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js');
const args = [
  cucumberEntry,
  ...featurePaths,
  '--require-module', 'ts-node/register',
  '--require', 'e2e/stepdefinitions/**/*.ts',
  '--format', `html:${htmlReportRel}`,
];
if (maxInstances > 1) args.push('--parallel', String(maxInstances));
if (tags) args.push('--tags', tags);

console.log(`Report: ${htmlReportRel}  |  parallel: ${maxInstances}${tags ? '  |  tags: ' + tags : ''}`);

const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error('Failed to start cucumber:', err.message);
  process.exit(1);
});
