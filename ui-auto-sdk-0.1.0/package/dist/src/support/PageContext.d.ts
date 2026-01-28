/**
 * Lightweight SDK-owned page/scenario context.
 *
 * Keeps only what the SDK needs across hooks and step definitions.
 */
export declare class PageContext {
    private static currentPage;
    private static scenarioName;
    static sameScenarioSwitch: boolean;
    static setCurrentPage(pageName: string): void;
    static getCurrentPage(): string;
    static setScenarioName(scenarioName: string): void;
    static getScenarioName(): string;
}
//# sourceMappingURL=PageContext.d.ts.map