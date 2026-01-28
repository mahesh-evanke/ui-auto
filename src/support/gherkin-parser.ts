/**
 * SDK copy of the lightweight feature-file parser.
 *
 * We only parse what the SDK needs: feature/scenario tags for tag-based selection.
 */
import * as fs from 'fs';
import { IdGenerator } from '@cucumber/messages';
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';

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

function tagsToStrings(tagNodes: readonly { name: string }[] | undefined): string[] {
  if (!tagNodes || tagNodes.length === 0) return [];
  return tagNodes.map((t) => t.name).filter(Boolean);
}

export function parseFeatureFile(filePath: string): ParsedFeatureFile {
  const content = fs.readFileSync(filePath, 'utf8');
  const uuidFn = IdGenerator.uuid();
  const parser = new Parser(new AstBuilder(uuidFn), new GherkinClassicTokenMatcher());
  const gherkinDocument = parser.parse(content);
  const feature = gherkinDocument.feature;
  if (!feature) return { featureName: '', featureTags: [], scenarios: [] };

  const featureName = (feature.name || '').trim();
  const featureTags = tagsToStrings(feature.tags);
  const scenarios: ParsedScenario[] = [];

  for (const child of feature.children || []) {
    const scenario = child.scenario;
    if (!scenario) continue;
    const scenarioName = (scenario.name || '').trim();
    const scenarioTags = tagsToStrings(scenario.tags);
    const steps = scenario.steps || [];
    scenarios.push({ name: scenarioName, tags: scenarioTags, stepCount: steps.length });
  }

  return { featureName, featureTags, scenarios };
}
