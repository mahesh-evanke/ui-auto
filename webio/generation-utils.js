#!/usr/bin/env node
/**
 * Generation utilities for feature and locator file creation.
 * Domain-based structure: e2e/generated/<domain>/{features,locators} and e2e/features/<domain>/.
 * Used by generate-locators-and-features.js and generate-from-swagger.js.
 */

const fs = require("fs");
const path = require("path");

const E2E_ROOT = path.join(__dirname, "..", "e2e");

/** Supported domains for feature/locator generation. */
const DOMAINS = Object.freeze(["web", "api", "db", "end-to-end", "mobile"]);

/** Domain mapping configuration. */
const DOMAIN_CONFIG = Object.freeze({
    web: { label: "Web UI", featuresSubdir: "features", locatorsSubdir: "locators" },
    api: { label: "API", featuresSubdir: "features", locatorsSubdir: "locators" },
    db: { label: "Database", featuresSubdir: "features", locatorsSubdir: "locators" },
    "end-to-end": { label: "End-to-End (Web+API)", featuresSubdir: "features", locatorsSubdir: "locators" },
    mobile: { label: "Mobile", featuresSubdir: "features", locatorsSubdir: "locators" },
});

/** Default content for common.json if created. */
const DEFAULT_COMMON_JSON = "{}";

/** Default content for pages.json if created. */
const DEFAULT_PAGES_JSON = "{}";

/**
 * Validates domain. Returns normalized domain or throws.
 * @param {string} domain - Domain name (case-insensitive).
 * @returns {string} Normalized domain (e.g. "end-to-end").
 */
function validateDomain(domain) {
    if (domain == null || String(domain).trim() === "") {
        throw new Error("Domain is required. Valid domains: " + DOMAINS.join(", "));
    }
    const d = String(domain).trim().toLowerCase();
    const alias = { "e2e": "end-to-end", "webui-api": "end-to-end", "webui": "end-to-end" };
    const normalized = alias[d] || d;
    if (!DOMAINS.includes(normalized)) {
        throw new Error(`Invalid domain "${domain}". Valid domains: ${DOMAINS.join(", ")}`);
    }
    return normalized;
}

/**
 * Returns paths for generated output for a domain.
 * @param {string} domain - Validated domain.
 * @returns {{ featuresDir: string, locatorsDir: string, pagesDir: string, pagesJsonPath: string, commonJsonPath: string }}
 */
function getGeneratedPaths(domain) {
    const d = validateDomain(domain);
    const base = path.join(E2E_ROOT, "generated", d);
    return {
        featuresDir: path.join(base, "features"),
        locatorsDir: path.join(base, "locators"),
        pagesDir: path.join(base, "locators", "pages"),
        pagesJsonPath: path.join(base, "locators", "pages.json"),
        commonJsonPath: path.join(base, "locators", "common.json"),
    };
}

/**
 * Returns paths for manual (non-generated) content.
 * @param {string} domain - Validated domain.
 */
function getManualPaths(domain) {
    const d = validateDomain(domain);
    const base = path.join(E2E_ROOT, "features", d);
    return {
        featuresDir: path.join(base, "features"),
        locatorsDir: path.join(base, "locators"),
        pagesDir: path.join(base, "locators", "pages"),
        pagesJsonPath: path.join(base, "locators", "pages.json"),
        commonJsonPath: path.join(base, "locators", "common.json"),
    };
}

/**
 * Ensures directory exists. Idempotent.
 * @param {string} dir - Directory path.
 */
function ensureDir(dir) {
    if (!dir) return;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Ensures full locator structure for a domain under generated/.
 * Creates: locators/, locators/pages/, common.json (if not exists), pages.json (if not exists).
 * @param {string} domain - Validated domain.
 * @param {boolean} [forceCommonJson=false] - If true, overwrite common.json with default. Default: false.
 */
function ensureLocatorStructure(domain, forceCommonJson = false) {
    const p = getGeneratedPaths(domain);
    ensureDir(p.locatorsDir);
    ensureDir(p.pagesDir);
    ensureDir(p.featuresDir);

    if (!fs.existsSync(p.commonJsonPath) || forceCommonJson) {
        safeWriteFile(p.commonJsonPath, DEFAULT_COMMON_JSON, { overwrite: forceCommonJson });
    }
    if (!fs.existsSync(p.pagesJsonPath)) {
        safeWriteFile(p.pagesJsonPath, DEFAULT_PAGES_JSON, { overwrite: false });
    }
}

/**
 * Safe file write. Never overwrites unless opts.overwrite is true (except for files we intend to update, e.g. pages.json).
 * @param {string} filePath - Full path to file.
 * @param {string} content - Content to write.
 * @param {{ overwrite?: boolean }} [opts] - { overwrite: true } to allow overwrite. Default: true for updates.
 * @returns {boolean} true if written, false if skipped (existing and !overwrite).
 */
function safeWriteFile(filePath, content, opts = {}) {
    const overwrite = opts.overwrite !== false;
    if (fs.existsSync(filePath) && !overwrite) {
        return false;
    }
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
    return true;
}

/**
 * Updates pages.json with a new page entry. Merges with existing. Idempotent for same key.
 * @param {string} pagesJsonPath - Path to pages.json.
 * @param {string} pageKey - Key (e.g. "generated/Screen").
 * @param {string} title - Page title.
 * @param {string[]} [labels] - Label(s).
 */
function updatePagesJson(pagesJsonPath, pageKey, title, labels = []) {
    let root = {};
    try {
        if (fs.existsSync(pagesJsonPath)) {
            root = JSON.parse(fs.readFileSync(pagesJsonPath, "utf8"));
        }
    } catch (e) {}
    if (typeof root !== "object" || root === null) root = {};
    const label = Array.isArray(labels) && labels.length > 0 ? labels[0] : title || pageKey;
    root[pageKey] = [{ title: title || pageKey, label: String(label) }];
    fs.writeFileSync(pagesJsonPath, JSON.stringify(root, null, 2), "utf8");
}

module.exports = {
    DOMAINS,
    DOMAIN_CONFIG,
    E2E_ROOT,
    validateDomain,
    getGeneratedPaths,
    getManualPaths,
    ensureDir,
    ensureLocatorStructure,
    safeWriteFile,
    updatePagesJson,
    DEFAULT_COMMON_JSON,
    DEFAULT_PAGES_JSON,
};
