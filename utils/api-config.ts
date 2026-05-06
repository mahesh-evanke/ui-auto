/**
 * Resolves ${aliasName} variable references in API URLs by reading
 * *-api-config.yaml files from locators/generated/ at runtime.
 *
 * Format of api-config.yaml:
 *   api1: https://customer-billing-dev.vercel.app
 *   api2: https://auth.myapp.com
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const GENERATED_DIR = path.join(__dirname, '..', 'locators', 'generated');

let cachedAliases: Record<string, string> | null = null;

function loadAliases(): Record<string, string> {
  if (cachedAliases !== null) return cachedAliases;

  const aliases: Record<string, string> = {};
  try {
    if (!fs.existsSync(GENERATED_DIR)) {
      cachedAliases = aliases;
      return aliases;
    }
    const files = fs.readdirSync(GENERATED_DIR).filter((f) => f.endsWith('-api-config.yaml'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(GENERATED_DIR, file), 'utf8');
        const parsed = yaml.load(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (key && typeof value === 'string' && value.trim()) {
              aliases[key] = value.trim();
            }
          }
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // ignore directory read errors
  }

  cachedAliases = aliases;
  return aliases;
}

/** Clear the cache (call between test runs if needed). */
export function clearApiUrlAliasCache(): void {
  cachedAliases = null;
}

/**
 * Replaces every ${name} token in a URL with the matching base URL from
 * the api-config.yaml files.  Returns the URL unchanged if no token is found.
 */
export function resolveApiUrl(url: string): string {
  if (!url || !url.includes('${')) return url;
  const aliases = loadAliases();
  return url.replace(/\$\{([^}]+)\}/g, (_match, name: string) => aliases[name] ?? _match);
}
