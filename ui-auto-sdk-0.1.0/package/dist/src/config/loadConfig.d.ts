export declare function resolveDefaultConfigPath(consumerRoot: string): string;
export interface LoadConfigOptions {
    configPath?: string;
    consumerRoot?: string;
    bustCache?: boolean;
}
export declare function loadFrameworkConfig(opts?: LoadConfigOptions): Record<string, any>;
export declare function getExecutionMode(config: Record<string, any>): string;
export declare function getEnvironment(config: Record<string, any>): string;
//# sourceMappingURL=loadConfig.d.ts.map