/**
 * Interactive postinstall: prompts user with yes/no for each test type.
 * e2e/generated and e2e/features are always created.
 * Uses Node readline; no extra dependencies.
 */
import * as path from 'path';
import * as readline from 'readline';
import { scaffold } from './scaffold';

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer || '').trim().toLowerCase()));
  });
}

function parseYesNo(val: string, defaultYes: boolean): boolean {
  if (!val) return defaultYes;
  if (val === 'y' || val === 'yes') return true;
  if (val === 'n' || val === 'no') return false;
  return defaultYes;
}

async function runInteractive(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n--- UI Auto E2E Setup ---');
  console.log('Include test types? [yes/no] Enter = yes\n');

  const web = parseYesNo(await question(rl, 'Web [yes/no]: '), true);
  const api = parseYesNo(await question(rl, 'API [yes/no]: '), true);
  const webuiApi = parseYesNo(await question(rl, 'Web+API [yes/no]: '), true);
  const db = parseYesNo(await question(rl, 'Database [yes/no]: '), true);
  const mobile = parseYesNo(await question(rl, 'Mobile [yes/no]: '), true);

  rl.close();

  const root = process.env.UI_AUTO_POSTINSTALL_ROOT || process.env.INIT_CWD || process.cwd();
  scaffold({
    consumerRoot: path.resolve(root),
    force: false,
    web,
    api,
    webuiApi,
    db,
    mobile,
  });

  const selected = [web && 'Web', api && 'API', webuiApi && 'Web+API', db && 'Database', mobile && 'Mobile'].filter(Boolean);
  console.log(`\nScaffolded: ${selected.length ? selected.join(', ') : 'minimal'}.`);
  console.log('Next: Open your app in a browser, then run: npx webio');
  console.log('Read: e2e/SETUP_GUIDE.md and e2e/GHERKIN_STEP_DEFINITIONS.md\n');
}

export { runInteractive };

if (require.main === module) {
  runInteractive().catch((err) => {
    console.warn('Setup failed:', (err && err.message) || err);
    process.exit(1);
  });
}
