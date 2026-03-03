/**
 * Runs on `npm install` when the SDK is added as a dependency.
 * - TTY (interactive): spawns interactive setup so user can select Web, API, Web+API, Mobile.
 * - Non-TTY (CI/IDE): scaffolds minimal structure (config + base folders only).
 */
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { scaffold } from './scaffold';

const consumerRoot = path.resolve(process.env.INIT_CWD || process.cwd());
const opts = { consumerRoot, force: false };

const scriptDir = __dirname;
const interactiveScript = path.join(scriptDir, 'postinstallInteractive.js');
const isCI = Boolean(process.env.CI || process.env.CONTINUOUS_INTEGRATION || process.env.GITHUB_ACTIONS);
const canInteractive = (process.stdin.isTTY || process.stdout.isTTY) && !isCI;

if (canInteractive && fs.existsSync(interactiveScript)) {
  process.env.UI_AUTO_POSTINSTALL_ROOT = consumerRoot;
  process.env.INIT_CWD = consumerRoot;
  const result = spawnSync(process.execPath, [interactiveScript], {
    stdio: 'inherit',
    env: process.env,
    cwd: consumerRoot,
  });
  if (result.status !== 0) {
    scaffold(opts);
  }
} else {
  scaffold(opts);
  if (!process.stdin.isTTY) {
    console.log('\nUI Auto: Run "npx ui-auto init" to select test types (Web, API, Web+API, Database, Mobile).\n');
  }
}
