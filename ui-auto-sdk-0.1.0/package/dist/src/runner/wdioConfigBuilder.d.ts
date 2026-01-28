export interface BuildWdioConfigOptions {
    configPath?: string;
    consumerRoot?: string;
    overrides?: {
        env?: string;
        tags?: string;
        browser?: string;
        maxInstances?: number;
        headless?: boolean;
    };
}
export declare function buildWdioConfig(opts?: BuildWdioConfigOptions): any;
//# sourceMappingURL=wdioConfigBuilder.d.ts.map