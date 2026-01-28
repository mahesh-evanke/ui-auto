"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFeatureFile = parseFeatureFile;
/**
 * SDK copy of the lightweight feature-file parser.
 *
 * We only parse what the SDK needs: feature/scenario tags for tag-based selection.
 */
const fs_1 = __importDefault(require("fs"));
const messages_1 = require("@cucumber/messages");
const gherkin_1 = require("@cucumber/gherkin");
function tagsToStrings(tagNodes) {
    if (!tagNodes || tagNodes.length === 0)
        return [];
    return tagNodes.map((t) => t.name).filter(Boolean);
}
function parseFeatureFile(filePath) {
    const content = fs_1.default.readFileSync(filePath, 'utf8');
    const uuidFn = messages_1.IdGenerator.uuid();
    const parser = new gherkin_1.Parser(new gherkin_1.AstBuilder(uuidFn), new gherkin_1.GherkinClassicTokenMatcher());
    const gherkinDocument = parser.parse(content);
    const feature = gherkinDocument.feature;
    if (!feature)
        return { featureName: '', featureTags: [], scenarios: [] };
    const featureName = (feature.name || '').trim();
    const featureTags = tagsToStrings(feature.tags);
    const scenarios = [];
    for (const child of feature.children || []) {
        const scenario = child.scenario;
        if (!scenario)
            continue;
        const scenarioName = (scenario.name || '').trim();
        const scenarioTags = tagsToStrings(scenario.tags);
        const steps = scenario.steps || [];
        scenarios.push({ name: scenarioName, tags: scenarioTags, stepCount: steps.length });
    }
    return { featureName, featureTags, scenarios };
}
//# sourceMappingURL=gherkin-parser.js.map