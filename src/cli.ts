#!/usr/bin/env node
/**
 * SDK CLI entrypoint.
 *
 * Consumer usage (from consumer repo root):
 * - npx ui-auto init
 * - npx ui-auto run --env val --tags "@smoke"
 */
import * as path from 'path';
import { runTests } from './runner/runTests';
import { scaffold } from './init/scaffold';
import { runInteractive } from './init/postinstallInteractive';
import { CONSUMER_ROOT_ENV } from './config/consumerRoot';

function parseArgs(argv: string[]): { command: string; options: Record<string, string | boolean> } {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith('-') ? args[0] : 'run';
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i++;
    }
  }
  return { command, options };
}

function setEnvFromOptions(opts: Record<string, string | boolean>): void {
  if (typeof opts.consumerRoot === 'string')
    process.env[CONSUMER_ROOT_ENV] = path.resolve(opts.consumerRoot);
  if (typeof opts.config === 'string') process.env.UI_AUTO_CONFIG_PATH = path.resolve(opts.config);
  if (typeof opts.env === 'string') process.env.UI_AUTO_ENV = opts.env;
  if (typeof opts.tags === 'string') process.env.UI_AUTO_TAGS = opts.tags;
  if (typeof opts.browser === 'string') process.env.UI_AUTO_BROWSER = opts.browser;
  if (typeof opts.maxInstances === 'string')
    process.env.UI_AUTO_MAX_INSTANCES = opts.maxInstances;
  if (opts.headless === true || opts.headless === 'true')
    process.env.UI_AUTO_HEADLESS = 'true';
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv);
  setEnvFromOptions(options);

  if (command === 'init') {
    const root = typeof options.consumerRoot === 'string' ? path.resolve(options.consumerRoot) : process.cwd();
    process.env.UI_AUTO_POSTINSTALL_ROOT = root;

    const hasFlags = options.web !== undefined || options.api !== undefined || options.webuiApi !== undefined || options.db !== undefined || options.mobile !== undefined;
    if (hasFlags) {
      scaffold({
        consumerRoot: root,
        force: options.force === true,
        web: options.web === true,
        api: options.api === true,
        webuiApi: options.webuiApi === true || options['webui-api'] === true,
        db: options.db === true,
        mobile: options.mobile === true,
      });
      console.log('E2E structure created. Run: npx ui-auto run');
    } else if (process.stdin.isTTY) {
      await runInteractive();
    } else {
      scaffold({ consumerRoot: root, force: options.force === true });
      console.log('E2E structure created. Run: npx ui-auto init --web --api to add more, or npx ui-auto run');
    }
    process.exit(0);
    return;
  }

  if (command !== 'run') {
    console.error(`Unknown command: ${command}. Supported: init, run`);
    process.exit(2);
  }

  const exitCode = await runTests();
  process.exit(exitCode);
}

main();
