#!/usr/bin/env node
/**
 * CLI: Launches Chrome with locator-collector script auto-injected on every
 * page load/redirect. Run: node cli.js [optional-start-url]
 */

const path = require("path");
const fs = require("fs");
const { writeGeneratedFiles } = require("./generate-locators-and-features.js");

async function main() {
    const startUrl = process.argv[2] || "about:blank";
    const scriptPath = path.join(__dirname, "web.js");
    const scriptContent = fs.readFileSync(scriptPath, "utf8");

    let puppeteer;
    try {
        puppeteer = require("puppeteer");
    } catch {
        console.error("Missing dependency. Run: npm install puppeteer");
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const setupPage = async (page) => {
        if (!page) return;
        try {
            await page.exposeFunction("webioWriteGeneratedFiles", async (payload) => {
                return writeGeneratedFiles(payload);
            });
            await page.evaluateOnNewDocument(scriptContent);
        } catch (err) {
            console.warn("Setup failed for page:", err.message);
        }
    };

    const pages = await browser.pages();
    for (const page of pages) {
        await setupPage(page);
    }

    browser.on("targetcreated", async (target) => {
        const page = await target.page();
        if (page) await setupPage(page);
    });

    const [page] = await browser.pages();
    if (page && startUrl !== "about:blank") {
        await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    }

    console.log("Chrome opened. Script is injected on every page load.");
    console.log("Right-click any element → 'Edit Save Locator' to capture. Use 'Generate JSON' or 'Generate Feature File' in the panel.");
    console.log("Then run: node webio/generate-locators-and-features.js <path-to-downloaded.json>");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
