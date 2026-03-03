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
exports.runInteractive = runInteractive;
/**
 * Interactive postinstall: prompts user with yes/no for each test type.
 * e2e/generated and e2e/features are always created.
 * Uses Node readline; no extra dependencies.
 */
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const scaffold_1 = require("./scaffold");
function question(rl, prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve((answer || '').trim().toLowerCase()));
    });
}
function parseYesNo(val, defaultYes) {
    if (!val)
        return defaultYes;
    if (val === 'y' || val === 'yes')
        return true;
    if (val === 'n' || val === 'no')
        return false;
    return defaultYes;
}
async function runInteractive() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n--- UI Auto E2E Setup ---');
    console.log('Include test types? [yes/no] Enter = yes\n');
    const web = parseYesNo(await question(rl, 'Web [yes/no]: '), true);
    const api = parseYesNo(await question(rl, 'API [yes/no]: '), true);
    const webuiApi = parseYesNo(await question(rl, 'Web+API [yes/no]: '), true);
    const db = parseYesNo(await question(rl, 'Database [yes/no]: '), true);
    const mobile = parseYesNo(await question(rl, 'Mobile [yes/no]: '), true);
    rl.close();
    const root = process.env.UI_AUTO_POSTINSTALL_ROOT || process.env.INIT_CWD || process.cwd();
    (0, scaffold_1.scaffold)({
        consumerRoot: path.resolve(root),
        force: false,
        web,
        api,
        webuiApi,
        db,
        mobile,
    });
    const selected = [web && 'Web', api && 'API', webuiApi && 'Web+API', db && 'Database', mobile && 'Mobile'].filter(Boolean);
    console.log(`\nScaffolded: ${selected.length ? selected.join(', ') : 'minimal'}.`);
    console.log('Next: Open your app in a browser, then run: npx webio');
    console.log('Read: e2e/SETUP_GUIDE.md and e2e/GHERKIN_STEP_DEFINITIONS.md\n');
}
if (require.main === module) {
    runInteractive().catch((err) => {
        console.warn('Setup failed:', (err && err.message) || err);
        process.exit(1);
    });
}
//# sourceMappingURL=postinstallInteractive.js.map