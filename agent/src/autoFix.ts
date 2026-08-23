import fs from "node:fs";
import { analyzeReferenceFramework } from "./agents/referenceFrameworkAgent.js";
import { analyzeRepository } from "./agents/codebaseAnalysisAgent.js";
import { detectTargetFramework } from "./agents/testFrameworkDetector.js";
import { retrieveRelevantFiles } from "./retrieval/codeSearch.js";
import { extractUiElements, renderUiElements } from "./retrieval/uiElements.js";
import { indexTargetRepoSteps, findReusableStep, shortlistSteps } from "./retrieval/stepDefinitionIndex.js";
import { fixScenarioSteps } from "./agents/testFixerAgent.js";
import { getScenarioSteps, replaceScenarioSteps } from "./runner/featureScenarioEditor.js";
import { runInBundledFramework } from "./runner/bundledFrameworkRunner.js";
import { createLlmClient } from "./llm/createLlmClient.js";
import { DEFAULT_REFERENCE_FRAMEWORK_PATH } from "./config.js";
import type { FixAttempt, ProgressEvent, ResolvedStep, RunContext, RunOptionsForTests, StepDefinitionEntry, TestRunResult } from "./types.js";

/**
 * When the just-completed bundled-harness run has failures, rewrites the
 * failing scenario(s) in the canonical .feature artifact and re-runs the
 * whole feature, up to opts.maxFixAttempts times. Bundled-harness only: it
 * needs an LLM call and rewrites the artifact on disk, neither of which the
 * "target" harness's own-repo execution path does.
 *
 * Never invents a brand-new step definition, same constraint as generation
 * under the bundled harness - a corrected step either resolves to one of
 * this repo's existing step definitions or that scenario is left unfixed
 * this round (reported, not silently dropped).
 */
export async function runBundledWithAutoFix(
  opts: RunOptionsForTests,
  runContext: RunContext,
  featureAbsPath: string,
  newStepDefsAbsPath: string | null,
  reportDir: string,
  initialResult: TestRunResult,
  emit: (label: string, status?: ProgressEvent["status"]) => void,
  onLog: (line: string) => void
): Promise<TestRunResult> {
  if (initialResult.failed === 0) return initialResult;

  const maxAttempts = opts.maxFixAttempts ?? 2;
  const client = createLlmClient({
    provider: opts.provider ?? "ollama",
    ollamaHost: opts.ollamaHost ?? "http://localhost:11434",
    ollamaModel: opts.model ?? "llama3.2",
    openaiToken: opts.openaiToken,
    openaiModel: opts.openaiModel,
    openrouterToken: opts.openrouterToken,
    openrouterModel: opts.openrouterModel,
  });
  const reachable = await client.ping();
  if (!reachable) {
    emit("Auto-fix skipped: LLM backend unreachable - showing the original failures instead", "failed");
    return initialResult;
  }

  const referenceProfile = analyzeReferenceFramework(DEFAULT_REFERENCE_FRAMEWORK_PATH);
  let repoAnalysis: ReturnType<typeof analyzeRepository> | null = null;
  let targetSteps: StepDefinitionEntry[] = [];
  // The clone persists under the job's own workspace for its lifetime (it's
  // only ever cleaned up if something external removes it), so re-deriving
  // UI elements/target steps here is normally available - degrade to
  // catalog-only fixing (still useful) rather than failing outright if not.
  if (fs.existsSync(runContext.resolvedRootDir)) {
    repoAnalysis = analyzeRepository(runContext.resolvedRootDir);
    targetSteps = indexTargetRepoSteps(repoAnalysis, detectTargetFramework(repoAnalysis));
  }
  const stepPool: StepDefinitionEntry[] = [...referenceProfile.steps, ...targetSteps];

  const attempts: FixAttempt[] = [];
  let current = initialResult;

  for (let attempt = 1; attempt <= maxAttempts && current.failed > 0; attempt++) {
    const failing = current.tests.filter((t) => t.status === "failed");
    emit(`Auto-fix attempt ${attempt}/${maxAttempts}: correcting ${failing.length} failing scenario(s)...`, "active");

    let featureContent = fs.readFileSync(featureAbsPath, "utf-8");
    const correctedTitles: string[] = [];
    const unfixableTitles: string[] = [];

    for (const test of failing) {
      const originalSteps = getScenarioSteps(featureContent, test.title);
      if (originalSteps.length === 0) {
        // Title didn't match anything in the current file - can't happen
        // for a genuinely-just-ran scenario, but guards against acting on
        // stale data if the file changed unexpectedly between rounds.
        unfixableTitles.push(test.title);
        continue;
      }

      const uiElements = repoAnalysis
        ? renderUiElements(extractUiElements(retrieveRelevantFiles(runContext.resolvedRootDir, repoAnalysis.candidateFiles, test.title, 8)))
        : "";
      const catalog = shortlistSteps(test.title, stepPool);

      let intents: Awaited<ReturnType<typeof fixScenarioSteps>>;
      try {
        intents = await fixScenarioSteps(client, {
          scenarioTitle: test.title,
          originalSteps,
          failedStepKeyword: test.failedStepKeyword,
          failedStepText: test.failedStepText,
          errorMessage: test.error ?? "(no error message captured)",
          catalog,
          uiElements,
        });
      } catch {
        unfixableTitles.push(test.title);
        continue;
      }

      const resolved: ResolvedStep[] = [];
      for (const intent of intents) {
        const reused = findReusableStep(intent, stepPool);
        if (reused) resolved.push(reused);
      }

      if (resolved.length === 0) {
        unfixableTitles.push(test.title);
        continue;
      }

      featureContent = replaceScenarioSteps(
        featureContent,
        test.title,
        resolved.map((s) => ({ keyword: s.keyword, text: s.text }))
      );
      correctedTitles.push(test.title);
    }

    if (correctedTitles.length === 0) {
      emit(`Auto-fix attempt ${attempt}: could not diagnose a fix for any failing scenario - stopping`, "failed");
      break;
    }

    // Overwrites the canonical artifact, not a throwaway copy - the fix is
    // meant to stick, the same way a human editing the generated feature
    // by hand would expect their edit to persist.
    fs.writeFileSync(featureAbsPath, featureContent, "utf-8");
    emit(`Rewrote ${correctedTitles.length} scenario(s), re-running...`, "active");

    const rerun = await runInBundledFramework(
      featureAbsPath,
      newStepDefsAbsPath,
      reportDir,
      opts.baseUrl,
      opts.headed,
      onLog,
      opts.browserName,
      opts.viewportDevice
    );

    attempts.push({ attempt, correctedScenarioTitles: correctedTitles, unfixableScenarioTitles: unfixableTitles, result: rerun });
    current = rerun;
  }

  return { ...current, fixAttempts: attempts };
}
