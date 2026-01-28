export type ExecutionMode = 'LOCAL' | 'GRID' | 'SELENIUMBOX';
export interface FrameworkConfig {
    executionMode: string;
    browserName: string;
    environment: string;
    tags: string;
    retryOnFail?: string | number;
    shardTestFiles?: boolean;
    edgedriverpath?: string;
    chromedriverpath?: string;
    maxInstances?: number;
    reportFolder?: string;
    seleniumLocalAddress?: string;
    seleniumAddress?: string;
    seleniumBoxAddress?: string;
    allScriptsTimeout?: number;
    getPageTimeout?: number;
    features?: string;
    standaloneUrl?: string;
    valUrl?: string;
    devUrl?: string;
    practiceUrl?: string;
    testDataDir?: string;
    appName?: string;
    seleniumBoxId?: string;
    seleniumBoxToken?: string;
    seleniumBoxTestName?: string;
    seleniumBoxProjectName?: string;
    seleniumBoxCredential?: string;
    seleniumBoxVideoSw?: boolean;
    [key: string]: unknown;
}
export declare function resolveDefaultConfigPath(consumerRoot: string): string;
export declare function loadFrameworkConfig(opts?: {
    consumerRoot?: string;
    configPath?: string;
    bustCache?: boolean;
}): FrameworkConfig;
export declare function getExecutionMode(config: FrameworkConfig): ExecutionMode;
export declare function getEnvironment(config: FrameworkConfig): string;
//# sourceMappingURL=loadConfig.d.ts.map