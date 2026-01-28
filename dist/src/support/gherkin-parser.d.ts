export type ParsedScenario = {
    name: string;
    tags: string[];
    stepCount: number;
};
export type ParsedFeatureFile = {
    featureName: string;
    featureTags: string[];
    scenarios: ParsedScenario[];
};
export declare function parseFeatureFile(filePath: string): ParsedFeatureFile;
//# sourceMappingURL=gherkin-parser.d.ts.map