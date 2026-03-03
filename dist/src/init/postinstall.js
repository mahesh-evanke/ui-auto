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
/**
 * Runs on `npm install` when the SDK is added as a dependency.
 * - TTY (interactive): spawns interactive setup so user can select Web, API, Web+API, Mobile.
 * - Non-TTY (CI/IDE): scaffolds minimal structure (config + base folders only).
 */
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const scaffold_1 = require("./scaffold");
const consumerRoot = path.resolve(process.env.INIT_CWD || process.cwd());
const opts = { consumerRoot, force: false };
const scriptDir = __dirname;
const interactiveScript = path.join(scriptDir, 'postinstallInteractive.js');
const isCI = Boolean(process.env.CI || process.env.CONTINUOUS_INTEGRATION || process.env.GITHUB_ACTIONS);
const canInteractive = (process.stdin.isTTY || process.stdout.isTTY) && !isCI;
if (canInteractive && fs.existsSync(interactiveScript)) {
    process.env.UI_AUTO_POSTINSTALL_ROOT = consumerRoot;
    process.env.INIT_CWD = consumerRoot;
    const result = (0, child_process_1.spawnSync)(process.execPath, [interactiveScript], {
        stdio: 'inherit',
        env: process.env,
        cwd: consumerRoot,
    });
    if (result.status !== 0) {
        (0, scaffold_1.scaffold)(opts);
    }
}
else {
    (0, scaffold_1.scaffold)(opts);
    if (!process.stdin.isTTY) {
        console.log('\nUI Auto: Run "npx ui-auto init" to select test types (Web, API, Web+API, Database, Mobile).\n');
    }
}
//# sourceMappingURL=postinstall.js.map