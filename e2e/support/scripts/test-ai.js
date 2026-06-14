/**
 * Wrapper for `npm run test:ai`.
 *   npm run test:ai                      → runs ALL features under generated/ai
 *   npm run test:ai 01_my-scenario       → runs ONLY that feature (scoped to ai/)
 *   npm run test:ai ai/01_my-scenario    → same (explicit)
 *
 * Without this wrapper, the script hardcoded "ai", so passing a filename ran the
 * whole ai category PLUS the file (i.e. everything).
 */
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2).filter(Boolean);
const KNOWN = ['ai', 'web', 'api', 'endtoend'];

// A "feature name" is a positional token that isn't a flag (-x/--x) or a tag (@x).
const isFlagOrTag = (a) => a.startsWith('-') || a.startsWith('@');
const namedFiles = args.filter((a) => !isFlagOrTag(a));

// No file names given → run the whole ai category. Flags/tags always pass through.
const targets = args.map((a) => {
  if (isFlagOrTag(a)) return a;
  if (a.includes('/') || a.includes('\\') || KNOWN.includes(a)) return a;
  return `ai/${a}`;
});
if (!namedFiles.length) targets.unshift('ai');

const runJs = path.join(__dirname, 'run.js');
const child = spawn(process.execPath, [runJs, ...targets], { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (e) => { console.error('Failed to start runner:', e.message); process.exit(1); });
