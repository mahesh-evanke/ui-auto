/**
 * SDK config loader.
 *
 * Loads the consumer-owned YAML configuration from `e2e/config/config.yaml` (by default)
 * and returns a typed, normalized object.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getConsumerRoot } from './consumerRoot';

let cachedConfig: Record<string, any> | null = null;
let cachedConfigPath: string | null = null;

export function resolveDefaultConfigPath(consumerRoot: string): string {
  return path.join(consumerRoot, 'e2e', 'config', 'config.yaml');
}

export interface LoadConfigOptions {
  configPath?: string;
  consumerRoot?: string;
  bustCache?: boolean;
}

export function loadFrameworkConfig(opts: LoadConfigOptions = {}): Record<string, any> {
  const consumerRoot = opts.consumerRoot ? path.resolve(opts.consumerRoot) : getConsumerRoot();
  const configPath = opts.configPath ? path.resolve(opts.configPath) : resolveDefaultConfigPath(consumerRoot);

  if (!opts.bustCache && cachedConfig && cachedConfigPath === configPath) {
    return cachedConfig;
  }

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found. Expected at: ${configPath}. ` +
        `Either run from consumer repo root or set UI_AUTO_CONSUMER_ROOT / --config.`
    );
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid config.yaml content at: ${configPath}`);
  }

  cachedConfig = parsed as Record<string, any>;
  cachedConfigPath = configPath;
  return cachedConfig;
}

export function getExecutionMode(config: Record<string, any>): string {
  const mode = String(config.executionMode ?? '').toUpperCase();
  if (mode === 'GRID' || mode === 'SELENIUMBOX') return mode;
  return 'LOCAL';
}

export function getEnvironment(config: Record<string, any>): string {
  return String(config.environment ?? '').toUpperCase();
}
