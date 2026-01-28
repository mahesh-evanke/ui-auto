"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageContext = void 0;
/**
 * Lightweight SDK-owned page/scenario context.
 *
 * Keeps only what the SDK needs across hooks and step definitions.
 */
class PageContext {
    static setCurrentPage(pageName) {
        this.currentPage = pageName;
    }
    static getCurrentPage() {
        return this.currentPage;
    }
    static setScenarioName(scenarioName) {
        this.scenarioName = scenarioName;
    }
    static getScenarioName() {
        return this.scenarioName;
    }
}
exports.PageContext = PageContext;
PageContext.currentPage = '';
PageContext.scenarioName = '';
PageContext.sameScenarioSwitch = false;
//# sourceMappingURL=PageContext.js.map