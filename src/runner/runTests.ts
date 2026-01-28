/**
 * Programmatic WDIO runner used by the SDK CLI.
 */
import * as path from 'path';

export interface RunOptions {
  wdioConfigPath?: string;
  wdioArgs?: Record<string, any>;
}

export async function runTests(opts: RunOptions = {}): Promise<number> {
  const wdioConfigPath = opts.wdioConfigPath ?? path.join(__dirname, 'wdio.sdk.conf.js');

  const { Launcher } = require('@wdio/cli');
  const launcher = new Launcher(wdioConfigPath, opts.wdioArgs ?? {});
  const exitCode = await launcher.run();
  return exitCode;
}
