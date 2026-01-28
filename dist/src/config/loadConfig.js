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
exports.resolveDefaultConfigPath = resolveDefaultConfigPath;
exports.loadFrameworkConfig = loadFrameworkConfig;
exports.getExecutionMode = getExecutionMode;
exports.getEnvironment = getEnvironment;
/**
 * SDK config loader.
 *
 * Loads the consumer-owned YAML configuration from `e2e/config/config.yaml` (by default)
 * and returns a typed, normalized object.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
const consumerRoot_1 = require("./consumerRoot");
let cachedConfig = null;
let cachedConfigPath = null;
function resolveDefaultConfigPath(consumerRoot) {
    return path.join(consumerRoot, 'e2e', 'config', 'config.yaml');
}
function loadFrameworkConfig(opts = {}) {
    const consumerRoot = opts.consumerRoot ? path.resolve(opts.consumerRoot) : (0, consumerRoot_1.getConsumerRoot)();
    const configPath = opts.configPath ? path.resolve(opts.configPath) : resolveDefaultConfigPath(consumerRoot);
    if (!opts.bustCache && cachedConfig && cachedConfigPath === configPath) {
        return cachedConfig;
    }
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found. Expected at: ${configPath}. ` +
            `Either run from consumer repo root or set UI_AUTO_CONSUMER_ROOT / --config.`);
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Invalid config.yaml content at: ${configPath}`);
    }
    cachedConfig = parsed;
    cachedConfigPath = configPath;
    return cachedConfig;
}
function getExecutionMode(config) {
    const mode = String(config.executionMode ?? '').toUpperCase();
    if (mode === 'GRID' || mode === 'SELENIUMBOX')
        return mode;
    return 'LOCAL';
}
function getEnvironment(config) {
    return String(config.environment ?? '').toUpperCase();
}
//# sourceMappingURL=loadConfig.js.map