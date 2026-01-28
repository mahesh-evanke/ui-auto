"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sdkClick = sdkClick;
exports.sdkSendKeys = sdkSendKeys;
exports.sdkClearText = sdkClearText;
exports.sdkWaitForPage = sdkWaitForPage;
/**
 * Minimal SDK-owned element helpers (no e2e dependency).
 * Used by core step definitions for click, type, and wait-for-page.
 */
const EC = __importStar(require("wdio-wait-for"));
const locatorProvider_1 = require("../locators/locatorProvider");
const DEFAULT_TIMEOUT_MS = 15000;
async function sdkClick(element) {
    await element.click();
}
async function sdkSendKeys(element, value, sendEnter = false) {
    await element.waitForDisplayed({ timeout: DEFAULT_TIMEOUT_MS });
    await element.clearValue();
    await element.setValue(value);
    if (sendEnter)
        await element.sendKeys(['Enter']);
}
async function sdkClearText(element) {
    await element.clearValue();
}
/**
 * Wait for page to be ready using pages.json metadata (title, optional label).
 */
async function sdkWaitForPage(screenName) {
    const meta = (0, locatorProvider_1.getPageMetadata)(screenName);
    if (!meta) {
        throw new Error(`No page metadata for "${screenName}" in pages.json. Add an entry like: "${screenName}": [{"title": "...", "label": "..."}]`);
    }
    await browser.waitUntil(EC.titleContains(meta.title), {
        timeout: DEFAULT_TIMEOUT_MS,
        timeoutMsg: `Timeout waiting for page title to contain "${meta.title}" (screen: ${screenName})`,
    });
    if (meta.label) {
        const labelSelector = `//*[contains(text(),"${meta.label}")]`;
        await browser.waitUntil(EC.presenceOf($(labelSelector)), {
            timeout: DEFAULT_TIMEOUT_MS,
            timeoutMsg: `Timeout waiting for label "${meta.label}" (screen: ${screenName})`,
        });
    }
}
//# sourceMappingURL=sdkElementHelpers.js.map