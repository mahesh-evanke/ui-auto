/**
 * WDIO mobile (Appium) runner.
 *
 * Goal: reuse the same feature files and step definitions for Mobile Web
 * (Android Chrome / iOS Safari) via Appium.
 *
 * Notes:
 * - We import the existing `wdio.conf.ts` and override only the parts that must differ
 *   (services, capabilities, Appium host/port/path).
 * - Network capture via CDP is not available in Appium sessions; @webui-api scenarios
 *   should fall back to axios validation (hybrid mode handled in api.steps.ts).
 * - "Could not connect to Bidi protocol" in the logs is expected on Appium and can be
 *   ignored; the session uses classic WebDriver and Android testing works normally.
 * - To avoid "No connection to WebDriver Bidi" errors on steps like "User is on X screen",
 *   we set wdio:enforceWebDriverClassic and patch webdriver to strip webSocketUrl from the
 *   session response (see node_modules/webdriver/build/node.js startWebDriverSession).
 *   If the error returns after npm install, re-apply: after "params.capabilities = ..."
 *   add: if (capabilities.alwaysMatch?.["wdio:enforceWebDriverClassic"] && params.capabilities)
 *   delete params.capabilities.webSocketUrl;
 */
import * as fs from 'fs';
import * as yamlReader from 'js-yaml';
import type { Options } from '@wdio/types';
import * as path from 'path';

// Prevent interactive prompting in the base config.
process.env.WDIO_OPEN_BROWSER = process.env.WDIO_OPEN_BROWSER ?? 'true';

// Load base config AFTER setting env vars above (important: avoids prompt).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { config: baseConfig } = require('./wdio.conf');

type MobileCfg = {
    platformName?: string; // Android | iOS
    deviceName?: string;
    udid?: string;
    platformVersion?: string;
    browserName?: string; // Chrome | Safari
    automationName?: string; // UiAutomator2 | XCUITest
    newCommandTimeout?: number;
    noReset?: boolean;
    appiumHost?: string;
    appiumPort?: number;
    appiumPath?: string; // usually '/' (Appium2) or '/wd/hub' (older)
    /** Android SDK root (required for Android). Appium reads ANDROID_HOME/ANDROID_SDK_ROOT. */
    androidSdkRoot?: string;
};

function readMobileCfg(): MobileCfg {
    const root = yamlReader.load(fs.readFileSync('e2e/config/config.yaml', 'utf8')) as any;
    return (root?.mobile ?? {}) as MobileCfg;
}

function env(name: string): string | undefined {
    const v = process.env[name];
    if (v == null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
}

function envBool(name: string): boolean | undefined {
    const v = env(name);
    if (v == null) return undefined;
    if (v.toLowerCase() === 'true') return true;
    if (v.toLowerCase() === 'false') return false;
    return undefined;
}

function envNum(name: string): number | undefined {
    const v = env(name);
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

function upper(s: string | undefined): string {
    return String(s ?? '').toUpperCase();
}

const mobile = readMobileCfg();

const platformName = env('MOBILE_PLATFORM') ?? mobile.platformName ?? 'Android';
const platformUpper = upper(platformName);

// Appium (uiautomator2) requires ANDROID_HOME/ANDROID_SDK_ROOT for Android. Set from env or config
// so the Appium server process (and its children) see it.
if (platformUpper === 'ANDROID') {
    const sdkRoot =
        env('ANDROID_SDK_ROOT') ??
        env('ANDROID_HOME') ??
        (mobile.androidSdkRoot ? path.resolve(process.cwd(), mobile.androidSdkRoot) : undefined);
    if (sdkRoot && fs.existsSync(sdkRoot)) {
        process.env.ANDROID_SDK_ROOT = sdkRoot;
        process.env.ANDROID_HOME = sdkRoot;
    }
}

const defaultBrowserName = platformUpper === 'IOS' ? 'Safari' : 'Chrome';
const browserName = env('MOBILE_BROWSER') ?? mobile.browserName ?? defaultBrowserName;

const defaultAutomationName = platformUpper === 'IOS' ? 'XCUITest' : 'UiAutomator2';
const automationName = env('MOBILE_AUTOMATION') ?? mobile.automationName ?? defaultAutomationName;

const deviceName =
    env('MOBILE_DEVICE_NAME') ??
    mobile.deviceName ??
    (platformUpper === 'IOS' ? 'iPhone 15' : 'Android Emulator');

const udid = env('MOBILE_UDID') ?? mobile.udid;
const platformVersion = env('MOBILE_PLATFORM_VERSION') ?? mobile.platformVersion;

const appiumHost = env('APPIUM_HOST') ?? mobile.appiumHost ?? '127.0.0.1';
const appiumPort = envNum('APPIUM_PORT') ?? mobile.appiumPort ?? 4723;
const appiumPath = env('APPIUM_PATH') ?? mobile.appiumPath ?? '/';
const newCommandTimeout = envNum('MOBILE_NEW_COMMAND_TIMEOUT') ?? mobile.newCommandTimeout ?? 120;
const noReset = envBool('MOBILE_NO_RESET') ?? mobile.noReset ?? true;

// Use Appium service when installed; otherwise user can run Appium externally.
// For Android Chrome, enable chromedriver auto-download so Appium fetches a driver matching device Chrome.
const appiumServiceDir = path.join(process.cwd(), 'node_modules', '@wdio', 'appium-service');
const useAppiumService = fs.existsSync(appiumServiceDir);
const appiumServiceOptions = useAppiumService
    ? [
          {
              args: {
                  // Comma-separated string (Appium CLI --allow-insecure). Enables Chromedriver auto-download for Android Chrome.
                  allowInsecure: 'uiautomator2:chromedriver_autodownload',
              },
          },
      ]
    : [];

const mobileCapability: any = {
    // Keep maxInstances aligned with base config unless overridden per capability.
    maxInstances: (baseConfig as any).maxInstances ?? 1,
    platformName,
    browserName,
    'appium:automationName': automationName,
    'appium:deviceName': deviceName,
    ...(udid ? { 'appium:udid': udid } : {}),
    ...(platformVersion ? { 'appium:platformVersion': platformVersion } : {}),
    'appium:newCommandTimeout': newCommandTimeout,
    'appium:noReset': noReset,
    // Mobile web (Android Chrome) needs a compatible Chromedriver. Let Appium manage it.
    ...(platformUpper === 'ANDROID' ? { 'appium:chromedriverAutodownload': true } : {}),
    // Force classic WebDriver; Appium may return webSocketUrl but Bidi is unreliable (socket hang up).
    'wdio:enforceWebDriverClassic': true,
};

export const config: Options.Testrunner = {
    ...(baseConfig as any),
    services: useAppiumService ? [['appium', appiumServiceOptions[0]]] : [],
    capabilities: [mobileCapability],
    protocol: 'http',
    hostname: appiumHost,
    port: appiumPort,
    path: appiumPath,
    /**
     * Strip Bidi so only classic WebDriver is used. Appium often returns webSocketUrl in the session
     * response; WDIO then tries Bidi and fails ("socket hang up"). Removing it and the handler
     * makes subsequent commands use classic protocol (getTitle, getUrl, etc.).
     */
    before: function (_capabilities: any, _specs: string[]) {
        const g = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : {});
        const b = (g as any).browser;
        if (b && b.capabilities && typeof b.capabilities.webSocketUrl === 'string') {
            delete b.capabilities.webSocketUrl;
        }
        if (b && (b as any)._bidiHandler) {
            (b as any)._bidiHandler = null;
        }
    },
};

