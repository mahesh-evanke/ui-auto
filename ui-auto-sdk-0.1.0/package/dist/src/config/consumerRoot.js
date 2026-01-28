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
exports.CONSUMER_ROOT_ENV = void 0;
exports.getConsumerRoot = getConsumerRoot;
/**
 * Consumer-root resolution for the SDK.
 *
 * The SDK runs inside a consumer repo, but the framework code lives in the SDK package.
 * To locate consumer-owned assets (features, locators, config.yaml, test-data), we resolve
 * a "consumer root" directory.
 *
 * Resolution order:
 * 1) Explicit env var `UI_AUTO_CONSUMER_ROOT`
 * 2) `process.cwd()` (expected when consumer runs `npx ui-auto ...` from repo root)
 */
const path = __importStar(require("path"));
exports.CONSUMER_ROOT_ENV = 'UI_AUTO_CONSUMER_ROOT';
function getConsumerRoot() {
    const envRoot = process.env[exports.CONSUMER_ROOT_ENV];
    if (envRoot && envRoot.trim().length > 0) {
        return path.resolve(envRoot.trim());
    }
    return process.cwd();
}
//# sourceMappingURL=consumerRoot.js.map