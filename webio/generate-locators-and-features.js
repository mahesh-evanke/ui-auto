#!/usr/bin/env node
/**
 * Reads exported screens JSON and generates:
 * - e2e/locators/pages/<screenId>.json
 * - e2e/locators/pages.json (append page metadata with title and label)
 * - e2e/features/<screenId>.feature
 *
 * Usage: node generate-locators-and-features.js <path-to-screens.json>
 * Or pipe JSON: node generate-locators-and-features.js
 */

const fs = require("fs");
const path = require("path");

const E2E_ROOT = path.join(__dirname, "..", "e2e");
const LOCATORS = path.join(E2E_ROOT, "locators");
const PAGES_DIR = path.join(LOCATORS, "pages");
const PAGES_JSON = path.join(LOCATORS, "pages.json");
const FEATURES_DIR = path.join(E2E_ROOT, "features");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateScreenJson(screen) {
    const out = {};
    (screen.elements || []).forEach((el) => {
        const logicalName = (el.logicalName || "").trim();
        const selType = (el.selectorType || "").trim();
        const selVal = (el.selectorValue || "").trim();
        if (!logicalName || !selType || !selVal) return;
        out[logicalName] = [selType, selVal];
    });
    return out;
}

function safeFileName(name) {
    const base = String(name || "Screen")
        .replace(/[\\\/:\*\?"<>\|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[\. ]+$/g, "");
    return base || "Screen";
}

/**
 * @param {object} screen - screen payload
 * @param {string} [pageNameForLocator] - page name used to load locator JSON (e.g. "generated/radio/Screen" so framework finds pages/generated/radio/Screen.json)
 */
function generateFeatureLines(screen, pageNameForLocator) {
    const screenId = screen.screenId || "Screen";
    const pageUrl = screen.page || "";
    const pageName = (pageNameForLocator != null && pageNameForLocator !== "") ? pageNameForLocator : screenId;
    const lines = [
        `Feature: ${screenId}`,
        "",
        "  @smoke",
        "  Scenario: Interact with captured elements",
        `    Given User navigates to "${(pageUrl || "").replace(/"/g, '\\"')}" URL`,
        `    And User is on "${(pageName || "").replace(/"/g, '\\"')}" screen`
    ];

    function esc(s) { return (s == null ? "" : String(s)).replace(/"/g, '\\"'); }

    (screen.elements || []).forEach((el) => {
        const logicalName = (el.logicalName || "").trim() || "Element";
        const objectType = (el.objectType || "").toLowerCase();
        const value = (el.value != null && el.value !== "") ? String(el.value).trim() : "";
        if (objectType === "textbox") {
            lines.push(`    And enters "default_value" text in "${esc(logicalName)}" textbox`);
        } else if (objectType === "button") {
            lines.push(`    When clicks on "${esc(logicalName)}" button`);
        } else if (objectType === "link") {
            lines.push(`    When clicks on "${esc(logicalName)}" link`);
        } else if (objectType === "checkbox") {
            lines.push(`    Given select "${esc(logicalName)}" Checkbox`);
        } else if (objectType === "radio") {
            lines.push(`    When clicks on "${esc(logicalName)}" Radio button`);
        } else if (objectType === "dropdown") {
            const optionVal = value || "option1";
            lines.push(`    When selects "${esc(optionVal)}" from "${esc(logicalName)}" Drop-down list`);
        } else if (objectType === "other") {
            const textToVerify = value || logicalName;
            if (textToVerify) {
                lines.push(`    When verify "${esc(textToVerify)}" text is present on the screen`);
            }
        }
    });

    // Optional: web table selection recorded by the automation recorder.
    // We reuse the existing step definition:
    //   When verify data from "{name}" web table
    //     | ... |
    if (screen && screen.selectedTable && screen.selectedTable.name && Array.isArray(screen.selectedTable.data)) {
        const t = screen.selectedTable;
        const name = String(t.name).replace(/"/g, '\\"');
        const data = t.data;
        if (data.length > 0 && Array.isArray(data[0])) {
            lines.push(``);
            lines.push(`    When verify data from "${name}" web table`);
            data.forEach((row) => {
                const cells = (row || []).map((c) => String(c ?? "").replace(/\|/g, "\\|").trim());
                lines.push(`      | ${cells.join(" | ")} |`);
            });
        }
    }

    return lines.join("\n") + "\n";
}

/**
 * Writes generated files for recording mode to e2e/locators/pages/generated/ and e2e/features/generated/.
 * Called from cli.js via page.exposeFunction when user clicks Generate Feature File in recording mode.
 * @param {Object} payload - { screens: Array, folder: string }
 * @returns {{ ok: boolean, message: string, paths?: string[] }}
 */
function writeGeneratedFiles(payload) {
    const E2E_ROOT = path.join(__dirname, "..", "e2e");
    const GENERATED_PAGES = path.join(E2E_ROOT, "locators", "pages", "generated");
    const GENERATED_FEATURES = path.join(E2E_ROOT, "features", "generated");

    try {
        const screens = (payload && payload.screens) || [];
        const folder = (payload && payload.folder && String(payload.folder).trim()) || "generated";
        if (!screens.length) return { ok: false, message: "No screens to generate." };
        // Default "generated" = write to pages/generated/ and features/generated/ (no subfolder)
        const folderDir = folder === "generated" ? GENERATED_PAGES : path.join(GENERATED_PAGES, folder);
        const featureDir = folder === "generated" ? GENERATED_FEATURES : path.join(GENERATED_FEATURES, folder);
        ensureDir(folderDir);
        ensureDir(featureDir);

        const pagesRegistry = {};
        const paths = [];
        const ROOT_PAGES_JSON = path.join(E2E_ROOT, "locators", "pages.json");
        let rootPages = {};
        try {
            if (fs.existsSync(ROOT_PAGES_JSON)) rootPages = JSON.parse(fs.readFileSync(ROOT_PAGES_JSON, "utf8"));
        } catch (e) {}
        if (typeof rootPages !== "object" || rootPages === null) rootPages = {};

        for (const screen of screens) {
            const screenId = screen.screenId || "Screen";
            const safeId = safeFileName(screenId);
            const title = screen.title || screenId;
            const label = screen.label || screenId;
            const pageNameForLocator = folder === "generated" ? ("generated/" + safeId) : ("generated/" + folder + "/" + safeId);

            const screenJson = generateScreenJson(screen);
            const screenPath = path.join(folderDir, safeId + ".json");
            fs.writeFileSync(screenPath, JSON.stringify(screenJson, null, 2), "utf8");
            paths.push(screenPath);

            const featureContent = generateFeatureLines(screen, pageNameForLocator);
            const featurePath = path.join(featureDir, safeId + ".feature");
            fs.writeFileSync(featurePath, featureContent, "utf8");
            paths.push(featurePath);

            pagesRegistry[screenId] = [{ title, label }];
            rootPages[pageNameForLocator] = [{ title, label }];
        }

        const pagesJsonPath = path.join(GENERATED_PAGES, "pages.json");
        fs.writeFileSync(pagesJsonPath, JSON.stringify(pagesRegistry, null, 2), "utf8");
        paths.push(pagesJsonPath);
        try {
            fs.writeFileSync(ROOT_PAGES_JSON, JSON.stringify({ ...rootPages }, null, 2), "utf8");
        } catch (e) {}

        return { ok: true, message: "Files generated successfully.", paths };
    } catch (e) {
        return { ok: false, message: (e && e.message) ? String(e.message) : String(e) };
    }
}

function main() {
    ensureDir(PAGES_DIR);
    ensureDir(FEATURES_DIR);

    let raw;
    const inputPath = process.argv[2];
    if (inputPath) {
        const abs = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
        if (!fs.existsSync(abs)) {
            console.error("File not found:", abs);
            process.exit(1);
        }
        raw = fs.readFileSync(abs, "utf8");
    } else {
        raw = fs.readFileSync(0, "utf8");
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.error("Invalid JSON:", e.message);
        process.exit(1);
    }

    const screens = (data && data.screens) || (Array.isArray(data) ? data : [data]);
    if (!screens.length) {
        console.error("No screens in JSON");
        process.exit(1);
    }

    let pagesRegistry = {};
    try {
        if (fs.existsSync(PAGES_JSON)) {
            pagesRegistry = JSON.parse(fs.readFileSync(PAGES_JSON, "utf8"));
        }
    } catch (e) {}

    for (const screen of screens) {
        const screenId = screen.screenId || "Screen";
        const safeId = safeFileName(screenId);
        const pageUrl = screen.page || "";
        
        // Extract title and label from screen metadata
        const title = screen.title || screenId;
        const label = screen.label || screenId;

        // Generate locators JSON for this screen
        const screenJson = generateScreenJson(screen);
        const pagesPagePath = path.join(PAGES_DIR, safeFileName(screenId) + ".json");
        fs.writeFileSync(pagesPagePath, JSON.stringify(screenJson, null, 2), "utf8");
        console.log("Wrote:", pagesPagePath);

        // Update pages registry with title and label
        pagesRegistry[screenId] = [
            {
                title: title,
                label: label
            }
        ];

        // Generate feature file
        const featureContent = generateFeatureLines(screen);
        const featurePath = path.join(FEATURES_DIR, safeId + ".feature");
        fs.writeFileSync(featurePath, featureContent, "utf8");
        console.log("Wrote:", featurePath);
    }

    // Write updated pages.json with title and label metadata
    fs.writeFileSync(PAGES_JSON, JSON.stringify(pagesRegistry, null, 2), "utf8");
    console.log("Updated:", PAGES_JSON);
    console.log("\nSummary:");
    console.log(`- Processed ${screens.length} screen(s)`);
    console.log("- Each screen's title and label saved to pages.json");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { writeGeneratedFiles, generateScreenJson, generateFeatureLines, safeFileName };
}
if (require.main === module) main();