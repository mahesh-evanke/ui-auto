#!/usr/bin/env node
/**
 * One-time migration: Moves content from legacy e2e/web, webui-api, api, db to the new structure:
 * e2e/features/<domain>/ and e2e/generated/<domain>/
 * Then removes the legacy folders.
 */

const fs = require("fs");
const path = require("path");

const E2E = path.join(__dirname, "..", "e2e");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(src, e.name);
        const d = path.join(dest, e.name);
        if (e.isDirectory()) {
            copyRecursive(s, d);
        } else {
            fs.copyFileSync(s, d);
        }
    }
}

function mergeJsonIfExists(destPath, srcPath) {
    if (!fs.existsSync(srcPath)) return;
    let dest = {};
    if (fs.existsSync(destPath)) {
        try {
            dest = JSON.parse(fs.readFileSync(destPath, "utf8"));
        } catch {}
    }
    const src = JSON.parse(fs.readFileSync(srcPath, "utf8"));
    Object.assign(dest, src);
    ensureDir(path.dirname(destPath));
    fs.writeFileSync(destPath, JSON.stringify(dest, null, 2), "utf8");
}

function removeDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) removeDir(p);
        else fs.unlinkSync(p);
    }
    fs.rmdirSync(dir);
}

// --- web ---
const webFeatures = path.join(E2E, "web", "features");
const webFeaturesGenerated = path.join(webFeatures, "generated");
const webLocators = path.join(E2E, "web", "locators");
const webLocatorsPages = path.join(webLocators, "pages");
const webLocatorsPagesGen = path.join(webLocatorsPages, "generated");

const destWebFeatures = path.join(E2E, "features", "web", "features");
const destWebGeneratedFeatures = path.join(E2E, "generated", "web", "features");
const destWebGeneratedLocators = path.join(E2E, "generated", "web", "locators");
const destWebGeneratedPages = path.join(destWebGeneratedLocators, "pages");

if (fs.existsSync(webFeatures)) {
    // Manual features (top-level .feature files, test/, WEB-UI-API-MAPPING.md, 1_Home Page.feature)
    const entries = fs.readdirSync(webFeatures, { withFileTypes: true });
    for (const e of entries) {
        if (e.name === "generated") continue;
        const s = path.join(webFeatures, e.name);
        const d = path.join(destWebFeatures, e.name);
        if (e.isDirectory()) copyRecursive(s, d);
        else {
            ensureDir(destWebFeatures);
            fs.copyFileSync(s, d);
        }
    }
    // Generated features
    if (fs.existsSync(webFeaturesGenerated)) {
        copyRecursive(webFeaturesGenerated, destWebGeneratedFeatures);
    }
}

if (fs.existsSync(webLocators)) {
    ensureDir(destWebGeneratedLocators);
    ensureDir(destWebGeneratedPages);
    if (fs.existsSync(path.join(webLocators, "common.json"))) {
        const d = path.join(destWebGeneratedLocators, "common.json");
        if (!fs.existsSync(d)) fs.copyFileSync(path.join(webLocators, "common.json"), d);
    }
    mergeJsonIfExists(path.join(destWebGeneratedLocators, "pages.json"), path.join(webLocators, "pages.json"));
    if (fs.existsSync(webLocatorsPages)) {
        copyRecursive(webLocatorsPages, destWebGeneratedPages);
    }
}

// --- webui-api → end-to-end ---
const webuiApiFeatures = path.join(E2E, "webui-api", "features", "generated");
const webuiApiLocators = path.join(E2E, "webui-api", "locators");
const destE2EFeatures = path.join(E2E, "generated", "end-to-end", "features");
const destE2ELocators = path.join(E2E, "generated", "end-to-end", "locators");

if (fs.existsSync(webuiApiFeatures)) copyRecursive(webuiApiFeatures, destE2EFeatures);
if (fs.existsSync(webuiApiLocators)) copyRecursive(webuiApiLocators, destE2ELocators);

// --- api ---
const apiFeatures = path.join(E2E, "api", "features");
const destApiFeatures = path.join(E2E, "features", "api", "features");
if (fs.existsSync(apiFeatures)) copyRecursive(apiFeatures, destApiFeatures);

// --- db: empty, no migration ---

// --- remove legacy folders ---
const toRemove = [path.join(E2E, "web"), path.join(E2E, "webui-api"), path.join(E2E, "api"), path.join(E2E, "db")];
for (const dir of toRemove) {
    if (fs.existsSync(dir)) {
        removeDir(dir);
        console.log("Removed:", dir);
    }
}

console.log("Migration complete.");
