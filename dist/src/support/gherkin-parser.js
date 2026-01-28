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
exports.parseFeatureFile = parseFeatureFile;
/**
 * SDK copy of the lightweight feature-file parser.
 *
 * We only parse what the SDK needs: feature/scenario tags for tag-based selection.
 */
const fs = __importStar(require("fs"));
const messages_1 = require("@cucumber/messages");
const gherkin_1 = require("@cucumber/gherkin");
function tagsToStrings(tagNodes) {
    if (!tagNodes || tagNodes.length === 0)
        return [];
    return tagNodes.map((t) => t.name).filter(Boolean);
}
function parseFeatureFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
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