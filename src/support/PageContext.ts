/**
 * Lightweight SDK-owned page/scenario context.
 *
 * Keeps only what the SDK needs across hooks and step definitions.
 */
export class PageContext {
  static currentPage = '';
  static scenarioName = '';
  static sameScenarioSwitch = false;

  static setCurrentPage(pageName: string): void {
    this.currentPage = pageName;
  }

  static getCurrentPage(): string {
    return this.currentPage;
  }

  static setScenarioName(scenarioName: string): void {
    this.scenarioName = scenarioName;
  }

  static getScenarioName(): string {
    return this.scenarioName;
  }
}
