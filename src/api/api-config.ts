/**
 * Resolves ${aliasName} variable references in API URLs.
 *
 * Reads all *.yaml files recursively under locators/generated/ and collects
 * URL aliases from:
 *   - a top-level "urls:" map  (e.g. api.yaml → urls: { login: https://... })
 *   - top-level string values  (e.g. api-config.yaml → login: https://...)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const GENERATED_DIR = path.join(process.cwd(), 'e2e', 'locators', 'generated');

let cachedAliases: Record<string, string> | null = null;

function walkYamlFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkYamlFiles(full, out);
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) out.push(full);
  }
}

function collectStrings(obj: Record<string, unknown>, into: Record<string, string>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (key && typeof value === 'string' && value.trim()) {
      into[key] = value.trim();
    }
  }
}

function loadAliases(): Record<string, string> {
  if (cachedAliases !== null) return cachedAliases;

  const aliases: Record<string, string> = {};
  const files: string[] = [];
  walkYamlFiles(GENERATED_DIR, files);

  for (const file of files) {
    try {
      const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const doc = parsed as Record<string, unknown>;

      if (doc.urls && typeof doc.urls === 'object' && !Array.isArray(doc.urls)) {
        collectStrings(doc.urls as Record<string, unknown>, aliases);
      }

      collectStrings(doc, aliases);
    } catch {
      // skip malformed files
    }
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
 * the api-config.yaml files. Returns the URL unchanged if no token is found.
 */
export function resolveApiUrl(url: string): string {
  if (!url || !url.includes('${')) return url;
  const aliases = loadAliases();
  const resolved = url.replace(/\$\{([^}]+)\}/g, (_match, name: string) => aliases[name] ?? _match);
  return resolved.replace(/([^:])\/\/+/g, '$1/');
}
