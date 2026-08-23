import { createLlmClient } from "./llm/createLlmClient.js";
import { createJobWorkspace, writeLog } from "./workspace/jobWorkspace.js";
import { resolveRepository, type ResolvedRepo } from "./agents/repositoryAgent.js";
import { analyzeRepository } from "./agents/codebaseAnalysisAgent.js";
import { detectTargetFramework } from "./agents/testFrameworkDetector.js";
import { analyzeReferenceFramework } from "./agents/referenceFrameworkAgent.js";
import { generateRequirements } from "./agents/requirementAgent.js";
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
import type {
  CoverageRow,
  GeneratedArtifact,
  GeneratedScenarioSteps,
  JobPaths,
  JobResult,
  ProgressEvent,
  ResolvedStep,
  RunContext,
  RunOptions,
  StepDefinitionEntry,
  TestGenerationReport,
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

/**
 * Runs the full test-GENERATION pipeline: repo resolve -> analyze -> detect
 * target test framework -> analyze reference framework -> requirements ->
 * retrieval (relevant files + existing tests) -> test plan -> per-scenario
 * step reuse matching -> generate artifacts -> write to generated-tests/ ->
 * coverage report. There is no app launch, no browser, no test execution
 * anywhere in this pipeline - see the plan doc for why.
 */
export async function runJob(
  opts: RunOptions,
  onProgress: (event: ProgressEvent) => void,
  onLog: (line: string) => void = () => {}
): Promise<{ paths: JobPaths; job: JobResult; resolvedRepo: ResolvedRepo }> {
  const emit = (label: string, status: ProgressEvent["status"] = "done") => onProgress({ label, status });

  const startedAt = new Date().toISOString();
  const client = createLlmClient({
    provider: opts.provider ?? "ollama",
    ollamaHost: opts.ollamaHost,
    ollamaModel: opts.model,
    openaiToken: opts.openaiToken,
    openaiModel: opts.openaiModel,
    openrouterToken: opts.openrouterToken,
    openrouterModel: opts.openrouterModel,
  });

  const reachable = await client.ping();
  if (!reachable) {
    if (opts.provider === "openai") {
      throw new Error(`Could not reach OpenAI with the connected API key. Reconnect it from Settings - it may be invalid or revoked.`);
    }
    if (opts.provider === "openrouter") {
      throw new Error(`Could not reach OpenRouter with the connected API key. Reconnect it from Settings - it may be invalid or revoked.`);
    }
    throw new Error(
      `Cannot reach Ollama at ${opts.ollamaHost}. Is it running? Try: ollama serve  (and ensure "${opts.model}" is pulled: ollama pull ${opts.model})`
    );
  }
  emit(
    opts.provider === "openai"
      ? `OpenAI connected (model: ${opts.openaiModel || "gpt-4o-mini"})`
      : opts.provider === "openrouter"
        ? `OpenRouter connected (model: ${opts.openrouterModel || "openai/gpt-4o-mini"})`
        : `Ollama reachable at ${opts.ollamaHost} (model: ${opts.model})`
  );

  const paths = createJobWorkspace();
  emit(`Job workspace created: ${paths.root}`);

  const resolved = resolveRepository(opts.repo, opts.branch, paths, opts.githubToken);
  emit(`Repository resolved (read-only): ${resolved.rootDir} (branch: ${resolved.branch})`);

  const analysis = analyzeRepository(resolved.rootDir);
  emit(`Repository analyzed: ${analysis.framework}, ${analysis.language}, ${analysis.fileTree.length} files`);
  writeAnalysisFile(
    paths,
    "repository-map.json",
    JSON.stringify({ framework: analysis.framework, language: analysis.language, fileTree: analysis.fileTree }, null, 2)
  );

  const targetFramework = detectTargetFramework(analysis);
  emit(
    `Target test framework detected: ${targetFramework.kind} (${targetFramework.existingSpecFiles.length} existing spec(s), ${targetFramework.existingFeatureFiles.length} existing feature(s))`
  );

  emit("Studying reference test framework conventions...", "active");
  const referenceProfile = analyzeReferenceFramework(opts.referenceFrameworkPath);
  emit(`Reference framework studied: ${referenceProfile.steps.length} reusable step pattern(s) found`);
  writeAnalysisFile(paths, "framework-analysis.json", JSON.stringify({ target: targetFramework, reference: referenceProfile }, null, 2));

  emit("Analyzing requirement...", "active");
  const requirements = await generateRequirements(client, opts.requirement, analysis);
  emit(`Requirement analyzed: ${requirements.requirements.length} requirement(s) identified`);
  writeAnalysisFile(paths, "requirement-analysis.json", JSON.stringify(requirements, null, 2));

  emit("Finding relevant files and existing tests...", "active");
  const relevantFilesByReq = new Map<string, ReturnType<typeof retrieveRelevantFiles>>();
  const existingTestsFound = new Set<string>();
  for (const req of requirements.requirements) {
    const relevant = retrieveRelevantFiles(analysis.rootDir, analysis.candidateFiles, req.description);
    relevantFilesByReq.set(req.id, relevant);
    for (const m of findExistingTests(analysis.rootDir, targetFramework, req.description)) {
      existingTestsFound.add(m.path);
    }
  }
  const relevantFilesCount = new Set([...relevantFilesByReq.values()].flat().map((f) => f.path)).size;
  emit(`Found ${relevantFilesCount} relevant file(s), ${existingTestsFound.size} existing test file(s) related to the requirement`);
  writeAnalysisFile(
    paths,
    "relevant-files.json",
    JSON.stringify({ relevantFiles: Object.fromEntries(relevantFilesByReq), existingTests: [...existingTestsFound] }, null, 2)
  );

  emit("Building QA test plan...", "active");
  const testPlan = await buildTestPlan(client, requirements, (req) => relevantFilesByReq.get(req.id) ?? []);
  const scenarioCount = testPlan.items.reduce((n, i) => n + i.scenarios.length, 0);
  emit(`QA test plan created: ${scenarioCount} scenario(s)`);

  emit("Matching scenario steps against existing step definitions...", "active");
  const stepPool: StepDefinitionEntry[] = [...referenceProfile.steps, ...indexTargetRepoSteps(analysis, targetFramework)];
  const scenarioSteps: GeneratedScenarioSteps[] = [];
  let reusedCount = 0;
  let newCount = 0;

  // With the bundled harness the framework already implements the vocabulary
  // (UI, API and DB step definitions), so a step it cannot express is dropped
  // rather than invented. That keeps every generated .feature runnable as-is
  // against the existing step definitions, and avoids emitting a generated
  // .steps.ts - which cucumber could not load anyway, since this agent
  // package is ESM ("type": "module") while the framework requires CommonJS.
  // Dropped steps are reported as gaps instead of silently disappearing.
  const existingStepsOnly = (opts.harness ?? "bundled") === "bundled";
  const unsupportedSteps: string[] = [];
  for (const item of testPlan.items) {
    // The real, concrete UI elements from the application's own source. Step
    // text is written against these so it names things that actually exist,
    // instead of being invented from the requirement wording alone.
    const uiElements = renderUiElements(extractUiElements(relevantFilesByReq.get(item.requirementId) ?? []));

    for (const scenario of item.scenarios) {
      // Show the model the framework's own steps that best fit this scenario,
      // so it reuses them instead of inventing prose no step definition
      // implements (post-hoc matching alone reused only ~11% of steps).
      const catalog = shortlistSteps(scenario.description, stepPool);
      const intents = await planStepIntents(client, scenario, catalog, uiElements);
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
  // Drop scenarios the planner produced no usable steps for, in one place, so
  // the feature file, the coverage matrix and test-plan.md can't disagree
  // about what was actually generated.
  const emptyScenarioCount = scenarioSteps.filter((s) => s.steps.length === 0).length;
  const usableScenarioSteps = scenarioSteps.filter((s) => s.steps.length > 0);
  if (emptyScenarioCount > 0) {
    emit(`Dropped ${emptyScenarioCount} scenario(s) with no usable steps`);
  }
  if (unsupportedSteps.length > 0) {
    emit(`Dropped ${unsupportedSteps.length} step(s) with no existing step definition (see report gaps)`);
  }
  emit(`Step matching complete: ${reusedCount} reused, ${newCount} new step(s) needed`);

  const feature = requirements.requirements[0]?.description ?? opts.requirement;
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

  // With the bundled harness (the default), this repository's own framework
  // executes the tests, and it is Cucumber-based - so we always emit Gherkin
  // plus any new step definitions, even when the target repo has no test
  // framework of its own. Only an explicit --harness target defers to
  // whatever the target repo itself uses.
  const harness = opts.harness ?? "bundled";
  const emitGherkin = harness === "bundled" || targetFramework.kind === "playwright-cucumber";

  if (emitGherkin) {
    emit("Generating .feature file...", "active");
    const featureContent = generateFeatureFile(feature, requirements, usableScenarioSteps);
    const featureFileName = `${featureSlug}.feature`;
    const featureRelPath = `cucumber/${featureFileName}`;
    const featureAbsPath = writeGeneratedTestFile(paths, featureRelPath, featureContent);
    artifacts.push(toArtifact("feature", featureFileName, featureRelPath, featureAbsPath, featureContent));
    for (const s of usableScenarioSteps) coverage.push({ requirementId: s.requirementId, scenarioId: s.scenarioId, artifactFileName: featureFileName });
    emit(`Feature file generated: ${featureRelPath}`);

    const newUiSteps = usableScenarioSteps.flatMap((s) => s.steps).filter((s) => !s.reused);
    // Steps were resolved without tracking kind post-hoc; re-derive by keyword heuristics is
    // unnecessary here since stepIntentAgent's "kind" only affects the reuse pool filter above -
    // all newly-generated steps are written together as one UI step-definitions file, which the
    // reference framework's own convention also does today (flat web.ts covering all UI steps).
    if (newUiSteps.length > 0) {
      emit("Generating new step definitions...", "active");
      const content = await generateStepDefinitions(client, newUiSteps);
      const fileName = `${featureSlug}.steps.ts`;
      const relPath = `cucumber/step-definitions/${fileName}`;
      const absPath = writeGeneratedTestFile(paths, relPath, content);
      // This agent package is ESM ("type": "module"), and the job workspace
      // lives inside it - so Node would treat a generated .ts step file as an
      // ES module and cucumber's --require (CommonJS) fails with
      // "expected a CommonJS module but found an ES module". Scoping the
      // containing directory back to CommonJS makes the file loadable.
      writeGeneratedTestFile(paths, "cucumber/step-definitions/package.json", `{ "type": "commonjs" }\n`);
      artifacts.push(toArtifact("step-definitions", fileName, relPath, absPath, content));
      emit(`New step definitions generated: ${relPath} (${newUiSteps.length} step(s))`);
    }
  } else {
    emit("Generating Playwright spec...", "active");
    const excerpts = [...relevantFilesByReq.values()]
      .flat()
      .slice(0, 8)
      .map((f) => `- ${f.path} (${f.kind})\n${f.excerpt.slice(0, 400)}`)
      .join("\n\n");
    const spec = await generatePlaywrightSpec(client, feature, requirements, usableScenarioSteps, analysis, excerpts);
    const relPath = `playwright/${spec.fileName}`;
    const absPath = writeGeneratedTestFile(paths, relPath, spec.content);
    artifacts.push(toArtifact("playwright-spec", spec.fileName, relPath, absPath, spec.content));
    for (const s of usableScenarioSteps) coverage.push({ requirementId: s.requirementId, scenarioId: s.scenarioId, artifactFileName: spec.fileName });
    emit(`Playwright spec generated: ${relPath}`);
  }

  const testPlanMd = renderTestPlanMarkdown(feature, usableScenarioSteps);
  writeGeneratedTestFile(paths, "test-plan.md", testPlanMd);

  const requirementsCovered = new Set(coverage.map((c) => c.requirementId)).size;
  const finishedAt = new Date().toISOString();

  const report: TestGenerationReport = {
    repo: opts.repo,
    branch: resolved.branch,
    requirement: opts.requirement,
    frameworkKind: targetFramework.kind,
    filesAnalyzedCount: analysis.fileTree.length,
    relevantFilesCount,
    existingTestFilesCount: existingTestsFound.size,
    // What actually made it into the artifacts, not what was planned - the two
    // differ when a scenario yielded no usable steps and was dropped above.
    scenarioCount: usableScenarioSteps.length,
    artifacts,
    reusedStepsCount: reusedCount,
    newStepsCount: newCount,
    requirementsCoveredCount: requirementsCovered,
    requirementsTotalCount: requirements.requirements.length,
    coverage,
    assumptions: [
      "Selectors/step text for reused steps come from the reference framework's existing step definitions and/or the target repo's own existing tests.",
      "Selectors for newly-generated steps or spec files are inferred from static source excerpts - review before running.",
    ],
    gaps: [
      ...referenceProfile.notes,
      ...(unsupportedSteps.length > 0
        ? [
            `${unsupportedSteps.length} step(s) were dropped because no existing step definition matched. ` +
              `Add a step definition for these in the framework (e2e/stepdefinitions/) if the behavior needs covering:`,
            ...[...new Set(unsupportedSteps)].map((s) => `  - ${s}`),
          ]
        : []),
    ],
    startedAt,
    finishedAt,
  };

  const { mdPath } = buildTestGenerationReport(report, paths);
  emit(`Test generation report: ${mdPath}`);

  writeLog(paths, "requirements-summary.txt", requirements.requirements.map((r) => `${r.id}: ${r.description}`).join("\n"));

  // Persisted for the separate, explicit Run step (src/runPipeline.ts) - it
  // needs to find the target repo and generated files again without redoing
  // any analysis/generation.
  const runContext: RunContext = {
    jobId: paths.jobId,
    repo: opts.repo,
    branch: resolved.branch,
    resolvedRootDir: resolved.rootDir,
    clonedByTool: resolved.clonedByTool,
    frameworkKind: targetFramework.kind,
    generatedArtifacts: artifacts,
  };
  writeAnalysisFile(paths, "run-context.json", JSON.stringify(runContext, null, 2));

  const job: JobResult = {
    jobId: paths.jobId,
    repo: opts.repo,
    branch: resolved.branch,
    feature,
    requirements,
    testPlan,
    frameworkAnalysis: { target: targetFramework, reference: referenceProfile },
    generatedArtifacts: artifacts,
    report,
    startedAt,
    finishedAt,
  };

  return { paths, job, resolvedRepo: resolved };
}

function renderTestPlanMarkdown(feature: string, scenarioSteps: GeneratedScenarioSteps[]): string {
  const lines = [`# Test Plan — ${feature}`, ""];
  for (const s of scenarioSteps) {
    lines.push(`## ${s.requirementId} / ${s.scenarioId}: ${s.title}`);
    for (const step of s.steps) {
      lines.push(`- ${step.keyword} ${step.text}${step.reused ? " _(reused)_" : " _(new)_"}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
