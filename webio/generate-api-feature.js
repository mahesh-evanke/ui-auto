#!/usr/bin/env node
/**
 * Writes API feature content to e2e/api/Generate/.
 * Usage:
 *   node webio/generate-api-feature.js [input.feature]
 *   node webio/generate-api-feature.js < api-content.feature
 * If input file is given, writes e2e/api/Generate/<basename>.feature.
 * If stdin, writes e2e/api/Generate/api-tests-<timestamp>.feature.
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "e2e", "api", "Generate");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function main() {
    const inputFile = process.argv[2];

    ensureDir(OUT_DIR);

    const done = (content, outFileName) => {
        const outPath = path.join(OUT_DIR, outFileName);
        fs.writeFileSync(outPath, content, "utf8");
        console.log("Wrote: " + outPath);
    };

    if (inputFile) {
        const absPath = path.isAbsolute(inputFile) ? inputFile : path.join(process.cwd(), inputFile);
        if (!fs.existsSync(absPath)) {
            console.error("File not found:", absPath);
            process.exit(1);
        }
        const content = fs.readFileSync(absPath, "utf8");
        const basename = path.basename(absPath, path.extname(absPath)) || "api-tests";
        const outFileName = basename + ".feature";
        done(content, outFileName);
        return;
    }

    if (process.stdin.isTTY) {
        console.error("Usage: node webio/generate-api-feature.js [input.feature]");
        console.error("   Or: node webio/generate-api-feature.js < api-content.feature");
        process.exit(1);
    }

    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
        const content = chunks.join("");
        const outFileName = "api-tests-" + Date.now() + ".feature";
        done(content, outFileName);
    });
}

main();
