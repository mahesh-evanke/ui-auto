/**
 * Lightweight feature-file parser using maintained Cucumber packages.
 *
 * Replaces deprecated `gherkin-parse` (which depends on deprecated `gherkin@5`).
 * We only parse what this repo needs: feature/scenario names and tags.
 */
import fs from 'fs'
import { IdGenerator } from '@cucumber/messages'
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin'

export type ParsedScenario = {
    name: string
    tags: string[]
    stepCount: number
}

export type ParsedFeatureFile = {
    featureName: string
    featureTags: string[]
    scenarios: ParsedScenario[]
}

function tagsToStrings(tagNodes?: Array<{ name: string }>): string[] {
    if (!tagNodes || tagNodes.length === 0) return []
    return tagNodes.map(t => t.name).filter(Boolean)
}

/**
 * Parse a `.feature` file into a minimal representation.
 */
export function parseFeatureFile(filePath: string): ParsedFeatureFile {
    const content = fs.readFileSync(filePath, 'utf8')
    const uuidFn = IdGenerator.uuid()
    const parser = new Parser(new AstBuilder(uuidFn), new GherkinClassicTokenMatcher())
    const gherkinDocument = parser.parse(content)

    const feature = gherkinDocument.feature
    if (!feature) {
        return { featureName: '', featureTags: [], scenarios: [] }
    }

    const featureName = (feature.name || '').trim()
    const featureTags = tagsToStrings(feature.tags as any)

    const scenarios: ParsedScenario[] = []
    for (const child of feature.children || []) {
        // We only care about Scenario / Scenario Outline nodes
        const scenario: any = (child as any).scenario
        if (!scenario) continue

        const scenarioName = (scenario.name || '').trim()
        const scenarioTags = tagsToStrings(scenario.tags as any)
        const steps = scenario.steps || []

        scenarios.push({
            name: scenarioName,
            tags: scenarioTags,
            stepCount: steps.length,
        })
    }

    return { featureName, featureTags, scenarios }
}