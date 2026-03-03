#!/usr/bin/env node
/**
 * Record elements on the mobile device/emulator — same workflow as desktop.
 *
 * 1. Starts a small HTTP server so the device can load the Webio script (with a stub
 *    so "Generate" stores the payload in window.__webioExportPayload).
 * 2. Connects to Appium (Chrome on Android / Safari on iOS), opens your site.
 * 3. Injects the script; the Webio bubble and panel appear on the device.
 * 4. You tap the bubble, set screen ID, Start Recording, use the app, then Generate.
 * 5. This script polls for the payload and writes locators + feature to e2e/web/locators
 *    and e2e/web/features (same as desktop).
 *
 * Prerequisites:
 * - Appium running (e.g. npx appium --allow-insecure uiautomator2:chromedriver_autodownload).
 * - Android emulator or device with Chrome (or iOS with Safari).
 * - Your site reachable from the device (e.g. Vite with --host; use URL like http://10.0.2.2:3000/ for Android emulator).
 *
 * Usage:
 *   node webio/record-mobile.js [URL]
 *   URL defaults to http://localhost:3000/ (rewritten to 10.0.2.2:3000 for Android).
 *
 * Example:
 *   node webio/record-mobile.js http://localhost:3000/
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const { writeGeneratedFiles } = require("./generate-locators-and-features.js");
const { getViewport } = require("../e2e/config/devicePresets.js");

const WEBIO_SCRIPT_PORT = 8765;
const POLL_INTERVAL_MS = 2000;

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

function env(name) {
    const v = process.env[name];
    if (v == null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
}

function envNum(name) {
    const v = env(name);
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

function startScriptServer(patchedScript) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url === "/webio.js" || req.url === "/") {
                res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
                res.end(patchedScript);
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        server.listen(WEBIO_SCRIPT_PORT, "0.0.0.0", () => {
            console.log("[record-mobile] Webio script server: http://0.0.0.0:" + WEBIO_SCRIPT_PORT + "/webio.js");
            resolve(server);
        });
    });
}

async function main() {
    let url = process.argv[2] || "http://localhost:3000/";
    const config = loadConfig();
    const mobile = config.mobile || {};
    const platformName = env("MOBILE_PLATFORM") || mobile.platformName || "Android";
    const isAndroid = String(platformName).toLowerCase() === "android";

    if (isAndroid && (url.includes("localhost") || url.includes("127.0.0.1"))) {
        url = url.replace(/localhost|127\.0\.0\.1/g, "10.0.2.2");
    }

    const scriptPath = path.join(__dirname, "web.js");
    let scriptContent = fs.readFileSync(scriptPath, "utf8");
    const stub =
        "window.webioWriteGeneratedFiles=function(p){window.__webioExportPayload=p;return Promise.resolve({ok:true});};";
    const patchedScript = stub + "\n" + scriptContent;

    const server = await startScriptServer(patchedScript);

    // Android: ensure Appium can find the SDK
    if (isAndroid && (mobile.androidSdkRoot || env("ANDROID_SDK_ROOT") || env("ANDROID_HOME"))) {
        const sdkRoot =
            env("ANDROID_SDK_ROOT") ||
            env("ANDROID_HOME") ||
            (mobile.androidSdkRoot ? path.resolve(process.cwd(), mobile.androidSdkRoot) : undefined);
        if (sdkRoot && fs.existsSync(sdkRoot)) {
            process.env.ANDROID_SDK_ROOT = sdkRoot;
            process.env.ANDROID_HOME = sdkRoot;
        }
    }

    const appiumHost = env("APPIUM_HOST") || mobile.appiumHost || "127.0.0.1";
    const appiumPort = envNum("APPIUM_PORT") || mobile.appiumPort || 4723;
    const appiumPath = env("APPIUM_PATH") || mobile.appiumPath || "/";
    const deviceName = env("MOBILE_DEVICE_NAME") || mobile.deviceName || (isAndroid ? "Android Emulator" : "iPhone 15");
    const browserName = env("MOBILE_BROWSER") || mobile.browserName || (isAndroid ? "Chrome" : "Safari");
    const automationName = env("MOBILE_AUTOMATION") || mobile.automationName || (isAndroid ? "UiAutomator2" : "XCUITest");

    const capabilities = {
        platformName,
        "appium:automationName": automationName,
        "appium:deviceName": deviceName,
        browserName,
        "appium:newCommandTimeout": 120,
        "appium:noReset": true,
        // Use classic WebDriver only; Appium does not support all Bidi commands (e.g. script.addPreloadScript).
        "wdio:enforceWebDriverClassic": true,
    };
    if (isAndroid) {
        capabilities["appium:chromedriverAutodownload"] = true;
    }

    console.log("[record-mobile] Connecting to Appium at " + appiumHost + ":" + appiumPort + appiumPath);
    console.log("[record-mobile] Opening URL on device: " + url);

    const { remote } = require("webdriverio");
    const browser = await remote({
        protocol: "http",
        hostname: appiumHost,
        port: appiumPort,
        path: appiumPath,
        capabilities: { alwaysMatch: capabilities },
    });

    try {
        await browser.url(url);
        await browser.pause(2000);

        const viewport = getViewport(config.viewportDevice) || { width: 412, height: 915 };
        try {
            await browser.setWindowSize(viewport.width, viewport.height);
            console.log("[record-mobile] Viewport set to " + viewport.width + "x" + viewport.height + (config.viewportDevice ? " (" + config.viewportDevice + ")." : " (default)."));
        } catch (_) {
            console.log("[record-mobile] Using device default size (setWindowSize not supported or ignored).");
        }

        const scriptHost = isAndroid ? "10.0.2.2" : "127.0.0.1";
        const scriptUrl = "http://" + scriptHost + ":" + WEBIO_SCRIPT_PORT + "/webio.js";
        await browser.execute(function (src) {
            var el = document.createElement("script");
            el.src = src;
            document.documentElement.appendChild(el);
        }, scriptUrl);

        console.log("[record-mobile] Waiting for Webio script to load on device...");
        await browser.waitUntil(
            async () => {
                const ok = await browser.execute(function () {
                    return typeof window.webioCurrentScreenId === "function";
                });
                return ok === true;
            },
            { timeout: 15000, interval: 500 }
        );

        console.log("");
        console.log("=== On the device/emulator ===");
        console.log("  1. Tap the blue 'Webio' bubble to open the panel.");
        console.log("  2. Set Screen ID (e.g. generated/myscreen).");
        console.log("  3. Tap 'Start Recording', then use your app (tap, type, etc.).");
        console.log("  4. Tap 'Generate Feature File' (or 'Generate JSON').");
        console.log("  Files will be written on this machine. Press Ctrl+C to stop.");
        console.log("");

        let intervalId;
        const poll = async () => {
            try {
                const payload = await browser.execute(function () {
                    var p = window.__webioExportPayload;
                    if (p) window.__webioExportPayload = null;
                    return p;
                });
                if (payload && (payload.screens || payload.mode)) {
                    const result = await writeGeneratedFiles(payload);
                    console.log("[record-mobile] Files written: " + (result && result.paths ? result.paths.join(", ") : "ok"));
                }
            } catch (e) {
                // ignore poll errors (e.g. session closed)
            }
        };

        intervalId = setInterval(poll, POLL_INTERVAL_MS);

        const shutdown = async () => {
            if (intervalId) clearInterval(intervalId);
            try {
                await browser.deleteSession();
            } catch (_) {}
            server.close();
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        await new Promise(() => {}); // run until SIGINT/SIGTERM
    } catch (e) {
        console.error("[record-mobile] Error:", e.message);
        process.exitCode = 1;
    } finally {
        try {
            await browser.deleteSession();
        } catch (_) {}
        server.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
