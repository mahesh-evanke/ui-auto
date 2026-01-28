"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTests = exports.loadFrameworkConfig = void 0;
/**
 * Public SDK entrypoints (non-CLI).
 */
var loadConfig_1 = require("./config/loadConfig");
Object.defineProperty(exports, "loadFrameworkConfig", { enumerable: true, get: function () { return loadConfig_1.loadFrameworkConfig; } });
var runTests_1 = require("./runner/runTests");
Object.defineProperty(exports, "runTests", { enumerable: true, get: function () { return runTests_1.runTests; } });
//# sourceMappingURL=index.js.map