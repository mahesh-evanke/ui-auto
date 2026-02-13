#!/usr/bin/env node
/**
 * Reads exported locator JSON and generates a Gherkin feature file for E2E automation.
 * Usage: node generate-feature.js <path-to-locator.json> [output.feature]
 */

const fs = require("fs");
const path = require("path");

function esc(s) { return (s == null ? "" : String(s)).replace(/"/g, '\\"'); }

function generateFeatureForScreen(data) {
    const screenId = data.screenId || "Screen";
    const pageUrl = data.page || "";
    const lines = [
        `Feature: ${screenId}`,
        "",
        "  @smoke",
        "  Scenario: Interact with captured elements",
        `    Given User navigates to "${esc(pageUrl)}" URL`,
        `    And User is on "${esc(screenId)}" screen`
    ];

    (data.elements || []).forEach((el) => {
        const logicalName = (el.logicalName || "").trim() || "Element";
        const objectType = (el.objectType || "").toLowerCase();
        const value = (el.value != null && el.value !== "") ? String(el.value).trim() : "";
        if (objectType === "textbox") {
            lines.push(`    And enters "12345" text in "${esc(logicalName)}" textbox`);
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
        }
    });

    return lines.join("\n") + "\n";
}

function generateFeature(data) {
    if (data.screens && Array.isArray(data.screens)) {
        return data.screens.map(function (screen) {
            return { screenId: screen.screenId || "screen", content: generateFeatureForScreen(screen) };
        });
    }
    return [{ screenId: data.screenId || "screen", content: generateFeatureForScreen(data) }];
}

function main() {
    const jsonPath = process.argv[2];
    const outPath = process.argv[3];

    if (!jsonPath) {
        console.error("Usage: node generate-feature.js <path-to-locator.json> [output.feature]");
        process.exit(1);
    }

    const absPath = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
    if (!fs.existsSync(absPath)) {
        console.error("File not found:", absPath);
        process.exit(1);
    }

    let data;
    try {
        data = JSON.parse(fs.readFileSync(absPath, "utf8"));
    } catch (err) {
        console.error("Invalid JSON:", err.message);
        process.exit(1);
    }

    const features = generateFeature(data);
    const outDir = path.dirname(absPath);
    const baseName = path.basename(absPath, path.extname(absPath));

    if (outPath && features.length === 1) {
        const outAbs = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
        fs.writeFileSync(outAbs, features[0].content, "utf8");
        console.log("Wrote:", outAbs);
        return;
    }
    if (outPath && features.length > 1) {
        const outDirSpec = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
        const dir = path.dirname(outDirSpec);
        features.forEach(function (f) {
            const safeId = (f.screenId || "screen").replace(/[^\w\s-]/g, "-").replace(/\s+/g, "-").trim() || "screen";
            const outAbs = path.join(dir, "feature-" + safeId + ".feature");
            fs.writeFileSync(outAbs, f.content, "utf8");
            console.log("Wrote:", outAbs);
        });
        return;
    }
    features.forEach(function (f) {
        const safeId = (f.screenId || "screen").replace(/[^\w\s-]/g, "-").replace(/\s+/g, "-").trim() || "screen";
        const outAbs = path.join(outDir, "feature-" + safeId + ".feature");
        fs.writeFileSync(outAbs, f.content, "utf8");
        console.log("Wrote:", outAbs);
    });
}

main();
