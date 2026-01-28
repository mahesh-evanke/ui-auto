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
exports.SdkPageHelper = void 0;
/**
 * SDK-owned page helper.
 *
 * This replaces the repo-local `e2e/support/misc-utils/PageHelper.ts` for SDK builds.
 * It resolves locators from the consumer project via `src/locators/locatorProvider`.
 */
const EC = __importStar(require("wdio-wait-for"));
const locatorProvider_1 = require("../locators/locatorProvider");
const PageContext_1 = require("./PageContext");
function toSelector(locator) {
    const [kind, value] = locator;
    const t = String(kind ?? '').toLowerCase();
    if (t === 'xpath')
        return value;
    if (t === 'id')
        return `#${value}`;
    if (t === 'name')
        return `[name="${value}"]`;
    if (t === 'tagname')
        return `<${value} />`;
    if (t === 'linktext')
        return `=${value}`;
    if (t === 'buttontext')
        return `=${value}`;
    if (t === 'classname')
        return `.${value}`;
    return `[${kind}="${value}"]`;
}
class SdkPageHelper {
    static async locator(elementName, common) {
        const raw = (0, locatorProvider_1.getElementLocator)(elementName, {
            common,
            pageName: PageContext_1.PageContext.getCurrentPage(),
        });
        if (!raw)
            throw new Error(`Element with name '${elementName}' not found in JSON`);
        return raw;
    }
    static async selector(elementName, common) {
        const loc = await this.locator(elementName, common);
        return toSelector(loc);
    }
    static async findElement(elementName, common, waitFormat = 'non') {
        const selector = await this.selector(elementName, common);
        if (waitFormat.toLowerCase().includes('click')) {
            await browser.waitUntil(EC.elementToBeClickable(selector), {
                timeout: 20000,
                timeoutMsg: 'time out when wait to clickable: SdkPageHelper',
            });
        }
        return (await $(selector));
    }
}
exports.SdkPageHelper = SdkPageHelper;
//# sourceMappingURL=PageHelper.js.map