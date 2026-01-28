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
exports.resolveLocatorsDir = resolveLocatorsDir;
exports.resolveCommonLocatorsPath = resolveCommonLocatorsPath;
exports.resolvePagesMapPath = resolvePagesMapPath;
exports.resolvePageLocatorsPath = resolvePageLocatorsPath;
exports.getElementLocator = getElementLocator;
exports.getPageUrlByName = getPageUrlByName;
exports.getPageMetadata = getPageMetadata;
exports.clearLocatorCache = clearLocatorCache;
/**
 * Locator provider for consumer projects.
 *
 * Consumers own locators under:
 * - e2e/locators/common.json
 * - e2e/locators/pages.json
 * - e2e/locators/pages/*.json
 *
 * The SDK resolves these from the consumer root (cwd by default).
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const consumerRoot_1 = require("../config/consumerRoot");
function readJsonFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}
const cache = new Map();
function getCachedJson(filePath) {
    const abs = path.resolve(filePath);
    const existing = cache.get(abs);
    if (existing)
        return existing;
    if (!fs.existsSync(abs)) {
        throw new Error(`Locator JSON not found: ${abs}`);
    }
    const json = readJsonFile(abs);
    cache.set(abs, json);
    return json;
}
function resolveLocatorsDir(opts) {
    const root = opts?.consumerRoot ? path.resolve(opts.consumerRoot) : (0, consumerRoot_1.getConsumerRoot)();
    return path.join(root, 'e2e', 'locators');
}
function resolveCommonLocatorsPath(opts) {
    return path.join(resolveLocatorsDir(opts), 'common.json');
}
function resolvePagesMapPath(opts) {
    return path.join(resolveLocatorsDir(opts), 'pages.json');
}
function resolvePageLocatorsPath(pageName, opts) {
    return path.join(resolveLocatorsDir(opts), 'pages', `${pageName}.json`);
}
function getElementLocator(elementName, opts) {
    const common = Boolean(opts.common);
    const pageName = opts.pageName;
    const filePath = common ? resolveCommonLocatorsPath(opts) : resolvePageLocatorsPath(String(pageName ?? ''), opts);
    const json = getCachedJson(filePath);
    return json[elementName];
}
function getPageUrlByName(pageName, opts) {
    const json = getCachedJson(resolvePagesMapPath(opts));
    const v = json[pageName];
    if (typeof v === 'string')
        return v;
    return '';
}
/**
 * Read page metadata from pages.json (title/label for "User is on X screen").
 * Expects format: "ScreenName": [{"title": "...", "label": "..."}]
 */
function getPageMetadata(screenName, opts) {
    const json = getCachedJson(resolvePagesMapPath(opts));
    const raw = json[screenName];
    if (!raw || !Array.isArray(raw) || raw.length === 0)
        return null;
    const first = raw[0];
    if (!first || typeof first !== 'object')
        return null;
    const title = first.title;
    const label = first.label;
    if (!title || typeof title !== 'string')
        return null;
    return { title, label: typeof label === 'string' ? label : undefined };
}
function clearLocatorCache() {
    cache.clear();
}
//# sourceMappingURL=locatorProvider.js.map