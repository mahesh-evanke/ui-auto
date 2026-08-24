import fs from "node:fs";
import { createLlmClient } from "./llm/createLlmClient.js";
import { getJobPaths, writeLog } from "./workspace/jobWorkspace.js";
import { analyzeRepository } from "./agents/codebaseAnalysisAgent.js";
import { detectTargetFramework } from "./agents/testFrameworkDetector.js";
import { analyzeReferenceFramework } from "./agents/referenceFrameworkAgent.js";
import { buildTestPlan } from "./agents/testPlanningAgent.js";
import { planStepIntents } from "./agents/stepIntentAgent.js";
import { generateFeatureFile } from "./agents/gherkinGeneratorAgent.js";
import { generateStepDefinitions } from "./agents/stepDefinitionGeneratorAgent.js";
import { generatePlaywrightSpec } from "./agents/specGeneratorAgent.js";
import { retrieveRelevantFiles } from "./retrieval/codeSearch.js";
import { extractUiElements, renderUiElements } from "./retrieval/uiElements.js";
import { findExistingTests } from "./retrieval/existingTestSearch.js";
import { indexTargetRepoSteps, findReusableStep, shortlistSteps } from "./retrieval/stepDefinitionIndex.js";
import { writeGeneratedTestFile, writeAnalysisFile } from "./guard.js";
import { buildTestGenerationReport } from "./report/testGenerationReport.js";
import { loadAnalysisResult, loadAnalysisInputs } from "./analysisPipeline.js";
import { DEFAULT_REFERENCE_FRAMEWORK_PATH } from "./config.js";
import type {
  CoverageRow,
  GeneratedArtifact,
  GeneratedScenarioSteps,
  JobPaths,
  OutputFormat,
  ProgressEvent,
  ResolvedStep,
  RunContext,
  StepDefinitionEntry,
  TestGenerationReport,
  TestPlan,
  TestScope,
} from "./types.js";

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "generated-feature"
  );
}

interface LlmSettings {
  provider?: "ollama" | "openai" | "openrouter";
  model?: string;
  ollamaHost?: string;
  openaiToken?: string;
  openaiModel?: string;
  openrouterToken?: string;
  openrouterModel?: string;
}

function buildClient(opts: LlmSettings) {
  return createLlmClient({
    provider: opts.provider ?? "ollama",
    ollamaHost: opts.ollamaHost ?? "http://localhost:11434",
    ollamaModel: opts.model ?? "llama3.2",
    openaiToken: opts.openaiToken,
    openaiModel: opts.openaiModel,
    openrouterToken: opts.openrouterToken,
    openrouterModel: opts.openrouterModel,
  });
}

/**
 * Stage 2a of the staged workflow (Manual sub-tab): builds the reviewable
 * scenario list from an already-completed requirements analysis job. Never
 * generates any Gherkin/spec/step-definition artifact - that only happens
 * once the user approves these scenarios and moves to the Automated
 * sub-tab (generateAutomationFromScenarios below).
 *
 * `notes` is the "regenerate with more detail" input: appended to every
 * requirement's own description before planning, so the model sees it as
 * extra context without needing analysis to be re-run.
 */
export async function buildManualScenarios(
  jobId: string,
  opts: LlmSettings & { notes?: string; testScope?: TestScope },
  onProgress: (event: ProgressEvent) => void
): Promise<{ paths: JobPaths; testPlan: TestPlan }> {
  const emit = (label: string, status: ProgressEvent["status"] = "done") => onProgress({ label, status });
  const paths = getJobPaths(jobId);
  const analysisResult = loadAnalysisResult(jobId);
  const inputs = loadAnalysisInputs(jobId);

  const client = buildClient(opts);
  const reachable = await client.ping();
  if (!reachable) throw new Error(`Cannot reach the configured LLM backend (${opts.provider ?? "ollama"}).`);

  const analysis = analyzeRepository(inputs.resolvedRootDir);
  const scope = opts.testScope ?? "both";

  const notesSuffix = opts.notes?.trim() ? `\n\nAdditional notes for this scenario pass: ${opts.notes.trim()}` : "";
  const requirementsWithNotes = {
    requirements: analysisResult.requirements.requirements.map((r) => ({ ...r, description: r.description + notesSuffix })),
  };

  emit("Building manual test scenarios...", "active");
  const testPlan = await buildTestPlan(
    client,
    requirementsWithNotes,
    (req) => retrieveRelevantFiles(inputs.resolvedRootDir, analysis.candidateFiles, req.description),
    scope
  );
  const scenarioCount = testPlan.items.reduce((n, i) => n + i.scenarios.length, 0);
  emit(`Manual scenarios generated: ${scenarioCount}`);

  writeAnalysisFile(paths, "manual-scenarios.json", JSON.stringify(testPlan, null, 2));
  return { paths, testPlan };
}

export function loadManualScenarios(jobId: string): TestPlan {
  const paths = getJobPaths(jobId);
  const p = paths.analysis + "/manual-scenarios.json";
  if (!fs.existsSync(p)) throw new Error(`No manual-scenarios.json found for job ${jobId} - build manual scenarios first.`);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as TestPlan;
}

/**
 * Stage 2b (Automated sub-tab): takes the (possibly user-edited) approved
 * scenario list and generates Gherkin/spec artifacts - the same step-reuse
 * matching and generation logic as pipeline.ts's one-shot runJob, just
 * driven by an already-built TestPlan instead of building one internally.
 * Kept as its own implementation rather than refactoring runJob's internals
 * to share code, since runJob is the existing, already-verified one-shot
 * path (CLI + original web flow) and this stays additive to it.
 */
export async function generateAutomationFromScenarios(
  jobId: string,
  testPlan: TestPlan,
  opts: LlmSettings & { outputFormat?: OutputFormat; testScope?: TestScope; referenceFrameworkPath?: string },
  onProgress: (event: ProgressEvent) => void
): Promise<{ paths: JobPaths; artifacts: GeneratedArtifact[]; report: TestGenerationReport }> {
  const emit = (label: string, status: ProgressEvent["status"] = "done") => onProgress({ label, status });
  const startedAt = new Date().toISOString();
  const paths = getJobPaths(jobId);
  const analysisResult = loadAnalysisResult(jobId);
  const inputs = loadAnalysisInputs(jobId);

  const client = buildClient(opts);
  const reachable = await client.ping();
  if (!reachable) throw new Error(`Cannot reach the configured LLM backend (${opts.provider ?? "ollama"}).`);

  const analysis = analyzeRepository(inputs.resolvedRootDir);
  const targetFramework = detectTargetFramework(analysis);
  const referenceProfile = analyzeReferenceFramework(opts.referenceFrameworkPath ?? DEFAULT_REFERENCE_FRAMEWORK_PATH);
  const testScope = opts.testScope ?? "both";

  emit("Matching scenario steps against existing step definitions...", "active");
  const stepPool: StepDefinitionEntry[] = [...referenceProfile.steps, ...indexTargetRepoSteps(analysis, targetFramework)];
  const scenarioSteps: GeneratedScenarioSteps[] = [];
  let reusedCount = 0;
  let newCount = 0;
  // Bundled harness is the only execution path the staged workflow's Run
  // step wires up (see app/api routes) - existing-steps-only, same as
  // pipeline.ts's default, so the generated .feature is always runnable
  // as-is against this repo's own step definitions.
  const existingStepsOnly = true;
  const unsupportedSteps: string[] = [];
  const allRelevantPaths = new Set<string>();
  const existingTestsFound = new Set<string>();

  for (const item of testPlan.items) {
    const req = analysisResult.requirements.requirements.find((r) => r.id === item.requirementId);
    const queryText = req?.description ?? item.requirementId;
    const relevantFiles = retrieveRelevantFiles(inputs.resolvedRootDir, analysis.candidateFiles, queryText);
    for (const f of relevantFiles) allRelevantPaths.add(f.path);
    for (const m of findExistingTests(inputs.resolvedRootDir, targetFramework, queryText)) existingTestsFound.add(m.path);
    const uiElements = renderUiElements(extractUiElements(relevantFiles));

    for (const scenario of item.scenarios) {
      const catalog = shortlistSteps(scenario.description, stepPool, testScope);
      const intents = await planStepIntents(client, scenario, catalog, uiElements, testScope);
      const steps: ResolvedStep[] = [];
      for (const intent of intents) {
        const reused = findReusableStep(intent, stepPool);
        if (reused) {
          steps.push(reused);
          reusedCount++;
        } else if (existingStepsOnly) {
          unsupportedSteps.push(`${intent.keyword} ${intent.description}`);
        } else {
          steps.push({ text: intent.description, keyword: intent.keyword, reused: false });
          newCount++;
        }
      }
      scenarioSteps.push({ requirementId: item.requirementId, scenarioId: scenario.id, title: scenario.description, steps });
    }
  }

  const emptyScenarioCount = scenarioSteps.filter((s) => s.steps.length === 0).length;
  const usableScenarioSteps = scenarioSteps.filter((s) => s.steps.length > 0);
  if (emptyScenarioCount > 0) emit(`Dropped ${emptyScenarioCount} scenario(s) with no usable steps`);
  if (unsupportedSteps.length > 0) emit(`Dropped ${unsupportedSteps.length} step(s) with no existing step definition`);
  emit(`Step matching complete: ${reusedCount} reused, ${newCount} new step(s) needed`);

  const feature = analysisResult.requirements.requirements[0]?.description ?? "Generated tests";
  const featureSlug = slugify(feature);
  const artifacts: GeneratedArtifact[] = [];
  const coverage: CoverageRow[] = [];
  const toArtifact = (
    kind: GeneratedArtifact["kind"],
    fileName: string,
    relativePath: string,
    absPath: string,
    content: string
  ): GeneratedArtifact => ({ kind, fileName, relativePath, absolutePath: absPath, content });

  const outputFormat = opts.outputFormat ?? "gherkin";
  const wantGherkin = outputFormat === "gherkin" || outputFormat === "both";
  const wantSpec = outputFormat === "spec" || outputFormat === "both";

  if (wantGherkin) {
    emit("Generating .feature file...", "active");
    const featureContent = generateFeatureFile(feature, analysisResult.requirements, usableScenarioSteps);
    const featureFileName = `${featureSlug}.feature`;
    const featureRelPath = `cucumber/${featureFileName}`;
    const featureAbsPath = writeGeneratedTestFile(paths, featureRelPath, featureContent);
    artifacts.push(toArtifact("feature", featureFileName, featureRelPath, featureAbsPath, featureContent));
    for (const s of usableScenarioSteps) coverage.push({ requirementId: s.requirementId, scenarioId: s.scenarioId, artifactFileName: featureFileName });
    emit(`Feature file generated: ${featureRelPath}`);

    const newUiSteps = usableScenarioSteps.flatMap((s) => s.steps).filter((s) => !s.reused);
    if (newUiSteps.length > 0) {
      emit("Generating new step definitions...", "active");
      const content = await generateStepDefinitions(client, newUiSteps);
      const fileName = `${featureSlug}.steps.ts`;
      const relPath = `cucumber/step-definitions/${fileName}`;
      const absPath = writeGeneratedTestFile(paths, relPath, content);
      writeGeneratedTestFile(paths, "cucumber/step-definitions/package.json", `{ "type": "commonjs" }\n`);
      artifacts.push(toArtifact("step-definitions", fileName, relPath, absPath, content));
      emit(`New step definitions generated: ${relPath} (${newUiSteps.length} step(s))`);
    }
  }

  if (wantSpec) {
    emit("Generating Playwright spec...", "active");
    const excerpts = testPlan.items
      .flatMap((item) => {
        const req = analysisResult.requirements.requirements.find((r) => r.id === item.requirementId);
        return retrieveRelevantFiles(inputs.resolvedRootDir, analysis.candidateFiles, req?.description ?? item.requirementId);
      })
      .slice(0, 8)
      .map((f) => `- ${f.path} (${f.kind})\n${f.excerpt.slice(0, 400)}`)
      .join("\n\n");
    const spec = await generatePlaywrightSpec(client, feature, analysisResult.requirements, usableScenarioSteps, analysis, excerpts);
    const relPath = `playwright/${spec.fileName}`;
    const absPath = writeGeneratedTestFile(paths, relPath, spec.content);
    artifacts.push(toArtifact("playwright-spec", spec.fileName, relPath, absPath, spec.content));
    for (const s of usableScenarioSteps) coverage.push({ requirementId: s.requirementId, scenarioId: s.scenarioId, artifactFileName: spec.fileName });
    emit(`Playwright spec generated: ${relPath}`);
  }

  const requirementsCovered = new Set(coverage.map((c) => c.requirementId)).size;
  const finishedAt = new Date().toISOString();

  const report: TestGenerationReport = {
    repo: inputs.repo,
    branch: inputs.branch ?? "(default)",
    requirement: feature,
    frameworkKind: targetFramework.kind,
    filesAnalyzedCount: analysis.fileTree.length,
    relevantFilesCount: allRelevantPaths.size,
    existingTestFilesCount: existingTestsFound.size,
    scenarioCount: usableScenarioSteps.length,
    artifacts,
    reusedStepsCount: reusedCount,
    newStepsCount: newCount,
    requirementsCoveredCount: requirementsCovered,
    requirementsTotalCount: analysisResult.requirements.requirements.length,
    coverage,
    assumptions: [
      "Selectors/step text for reused steps come from the reference framework's existing step definitions and/or the target repo's own existing tests.",
      "Selectors for newly-generated steps or spec files are inferred from static source excerpts - review before running.",
    ],
    gaps: [
      ...referenceProfile.notes,
      ...(unsupportedSteps.length > 0
        ? [
            `${unsupportedSteps.length} step(s) were dropped because no existing step definition matched:`,
            ...[...new Set(unsupportedSteps)].map((s) => `  - ${s}`),
          ]
        : []),
    ],
    startedAt,
    finishedAt,
  };

  const { mdPath } = buildTestGenerationReport(report, paths);
  emit(`Test generation report: ${mdPath}`);
  writeLog(paths, "automation-generated-at.txt", finishedAt);

  const runContext: RunContext = {
    jobId: paths.jobId,
    repo: inputs.repo,
    branch: inputs.branch ?? "(default)",
    resolvedRootDir: inputs.resolvedRootDir,
    clonedByTool: true,
    frameworkKind: targetFramework.kind,
    generatedArtifacts: artifacts,
  };
  writeAnalysisFile(paths, "run-context.json", JSON.stringify(runContext, null, 2));

  return { paths, artifacts, report };
}
