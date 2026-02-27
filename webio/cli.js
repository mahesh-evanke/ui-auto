#!/usr/bin/env node
/**
 * CLI: Launches the browser from e2e/config/config.yaml (browserName) with
 * locator-collector script auto-injected. Supports Chrome, Edge (Puppeteer),
 * Firefox and Safari/WebKit (Playwright).
 * Run: node cli.js [optional-start-url]
 */

const path = require("path");
const fs = require("fs");
const { writeGeneratedFiles } = require("./generate-locators-and-features.js");
const { getViewport } = require("../e2e/config/devicePresets.js");

function loadConfig() {
    const configPath = path.join(__dirname, "..", "e2e", "config", "config.yaml");
    if (!fs.existsSync(configPath)) return {};
    try {
        const yaml = require("js-yaml");
        return yaml.load(fs.readFileSync(configPath, "utf8")) || {};
    } catch (e) {
        console.warn("Could not load config.yaml:", e.message);
        return {};
    }
}

function resolveBrowser(config) {
    const raw = (config.browserName || "chrome").toString().toLowerCase();
    if (raw === "edge" || raw === "microsoftedge") return "edge";
    if (raw === "brave") return "brave";
    if (raw === "firefox") return "firefox";
    if (raw === "safari") return "safari";
    return "chrome";
}

function getDefaultEdgePath() {
    if (process.platform === "win32") return "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    if (process.platform === "darwin") return "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    return null;
}

function getDefaultBravePath() {
    if (process.platform === "win32") return "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
    if (process.platform === "darwin") return "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
    return null;
}

function getDefaultFirefoxPath() {
    if (process.platform === "win32") return "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
    if (process.platform === "darwin") return "/Applications/Firefox.app/Contents/MacOS/firefox";
    return null;
}

/**
 * Returns { engine: 'puppeteer'|'playwright', browserLabel, launchOpts }.
 * For Puppeteer: launchOpts = { headless, defaultViewport, args, executablePath? }.
 * For Playwright: launchOpts = { browserType: 'firefox'|'webkit', executablePath? }.
 * @param {object} [opts] - Optional. opts.viewport = { width, height } from config viewportDevice (null = desktop).
 */
function getLaunchOptions(config, opts = {}) {
    const browser = resolveBrowser(config);
    const browserLabel = browser.charAt(0).toUpperCase() + browser.slice(1);

    if (browser === "firefox" || browser === "safari") {
        const isFirefox = browser === "firefox";
        const defaultPath = isFirefox ? getDefaultFirefoxPath() : null;
        const customPath = isFirefox && config.firefoxBrowserPath && config.firefoxBrowserPath !== "<path>"
            ? config.firefoxBrowserPath
            : null;
        const exe = customPath || defaultPath;
        return {
            engine: "playwright",
            browserLabel: isFirefox ? "Firefox" : "Safari",
            browserType: isFirefox ? "firefox" : "webkit",
            executablePath: isFirefox && exe && fs.existsSync(exe) ? exe : undefined,
            viewport: opts.viewport || null
        };
    }

    const launchOpts = {
        headless: false,
        defaultViewport: opts.viewport || null,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    };
    if (browser === "edge") {
        const edgePath = config.edgeBrowserPath || config.edgedriverpath;
        const exe = (edgePath && edgePath !== "<path>") ? edgePath : getDefaultEdgePath();
        if (exe && fs.existsSync(exe)) launchOpts.executablePath = exe;
        else if (exe) console.warn("Edge path not found:", exe, "- falling back to Chrome.");
    } else if (browser === "brave") {
        const bravePath = config.braveBrowserPath;
        const exe = (bravePath && bravePath !== "<path>") ? bravePath : getDefaultBravePath();
        if (exe && fs.existsSync(exe)) launchOpts.executablePath = exe;
        else if (exe) console.warn("Brave path not found:", exe, "- falling back to Chrome.");
    }
    return { engine: "puppeteer", browserLabel, launchOpts };
}

async function runWithPuppeteer(scriptContent, startUrl, browserLabel, launchOpts) {
    const puppeteer = require("puppeteer");
    const browser = await puppeteer.launch(launchOpts);

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

    for (const page of await browser.pages()) await setupPage(page);
    browser.on("targetcreated", async (target) => {
        const page = await target.page();
        if (page) await setupPage(page);
    });

    const [page] = await browser.pages();
    if (page && startUrl !== "about:blank") {
        await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    return browserLabel;
}

async function runWithPlaywright(scriptContent, startUrl, opts) {
    const { chromium: _c, firefox, webkit } = require("playwright");
    const browserType = opts.browserType === "firefox" ? firefox : webkit;
    const launchOptions = { headless: false };
    if (opts.executablePath) launchOptions.executablePath = opts.executablePath;

    const browser = await browserType.launch(launchOptions);
    const contextOptions = opts.viewport
        ? { viewport: opts.viewport }
        : { viewport: null };
    const context = await browser.newContext(contextOptions);

    await context.addInitScript(scriptContent);

    const setupPage = async (page) => {
        if (!page) return;
        try {
            await page.exposeFunction("webioWriteGeneratedFiles", async (payload) => {
                return writeGeneratedFiles(payload);
            });
        } catch (err) {
            console.warn("Setup failed for page:", err.message);
        }
    };

    const page = await context.newPage();
    await setupPage(page);
    context.on("page", (p) => setupPage(p));

    if (startUrl !== "about:blank") {
        await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    return opts.browserLabel;
}

async function main() {
    const argv = process.argv.slice(2);
    const startUrl = argv[0] && !argv[0].startsWith("--") ? argv[0] : "about:blank";
    const scriptPath = path.join(__dirname, "web.js");
    const scriptContent = fs.readFileSync(scriptPath, "utf8");

    const config = loadConfig();
    const viewport = getViewport(config.viewportDevice);
    const launchOptions = getLaunchOptions(config, { viewport });

    let browserLabel;
    if (launchOptions.engine === "playwright") {
        try {
            require.resolve("playwright");
        } catch {
            console.error("For Firefox/Safari support, install Playwright: npm install playwright");
            process.exit(1);
        }
        browserLabel = await runWithPlaywright(scriptContent, startUrl, launchOptions);
    } else {
        try {
            require.resolve("puppeteer");
        } catch {
            console.error("Missing dependency. Run: npm install puppeteer");
            process.exit(1);
        }
        browserLabel = await runWithPuppeteer(scriptContent, startUrl, launchOptions.browserLabel, launchOptions.launchOpts);
    }

    console.log(browserLabel + " opened. Script is injected on every page load.");
    if (viewport) console.log("Viewport: " + viewport.width + "x" + viewport.height + " (" + (config.viewportDevice || "device") + ").");
    console.log("Right-click any element → 'Edit Save Locator' to capture. Use 'Generate JSON' or 'Generate Feature File' in the panel.");
    console.log("Then run: node webio/generate-locators-and-features.js <path-to-downloaded.json>");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
