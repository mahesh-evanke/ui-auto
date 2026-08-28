import fs from "node:fs";
import { createLlmClient } from "./llm/createLlmClient.js";
import { createJobWorkspace, getJobPaths, writeLog } from "./workspace/jobWorkspace.js";
import { resolveRepository, type ResolvedRepo } from "./agents/repositoryAgent.js";
import { analyzeRepository } from "./agents/codebaseAnalysisAgent.js";
import { generateRequirements, combineRequirementSources } from "./agents/requirementAgent.js";
import { analyzeRequirementGap } from "./agents/gapAnalysisAgent.js";
import { retrieveRelevantFiles } from "./retrieval/codeSearch.js";
import { fetchLinks } from "./retrieval/linkFetcher.js";
import { writeAnalysisFile } from "./guard.js";
import type { AnalysisOptions, AnalysisResult, JobPaths, Observation, ProgressEvent, RequirementSourceInputs } from "./types.js";

export interface PersistedInputs {
  repo: string;
  branch?: string;
  sources: RequirementSourceInputs;
  /**
   * Where the target repo actually lives on disk - NOT always paths.repository.
   * resolveRepository only clones (into paths.repository) for a git URL; a
   * local path input is used in place at its original location instead.
   * Every later stage must read the repo from here, never assume
   * paths.repository, or it silently operates on an empty/nonexistent
   * directory for any job started from a local path.
   */
  resolvedRootDir: string;
}

/**
 * Stage 1 of the staged workflow (Requirements tab): resolve the repo(s),
 * merge every requirement source the user filled in, generate structured
 * requirements, then run gap analysis against the target repo (and the
 * legacy repo too, in modernization mode) to produce observations.
 *
 * Deliberately does NOT generate any test artifacts - that's the separate,
 * later Manual -> Automated stage (src/scenarioPipeline.ts), gated on the
 * user reviewing requirements/observations first, same as the described
 * two-tab workflow.
 *
 * Pass `existingJobId` to re-analyze an already-resolved job (adding notes
 * and re-running) without re-cloning the repo(s).
 */
export async function runRequirementsAnalysis(
  opts: AnalysisOptions,
  onProgress: (event: ProgressEvent) => void,
  onLog: (line: string) => void = () => {},
  existingJobId?: string
): Promise<{ paths: JobPaths; result: AnalysisResult; resolvedRepo: ResolvedRepo }> {
  const emit = (label: string, status: ProgressEvent["status"] = "done", promptId?: string) =>
    onProgress({ label, status, promptId });

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
    throw new Error(`Cannot reach the configured LLM backend (${opts.provider ?? "ollama"}). Check it's running / connected in Settings.`);
  }
  emit(`LLM backend reachable (${opts.provider ?? "ollama"})`);

  const paths = existingJobId ? getJobPaths(existingJobId) : createJobWorkspace();
  emit(existingJobId ? `Re-analyzing job ${paths.jobId}` : `Job workspace created: ${paths.root}`);

  // Skip re-cloning on a re-analyze pass - the repo doesn't change between rounds of refining requirements.
  const alreadyCloned = fs.existsSync(paths.repository) && fs.readdirSync(paths.repository).length > 0;
  const resolved = alreadyCloned
    ? { rootDir: paths.repository, branch: opts.branch ?? "unknown", clonedByTool: true }
    : resolveRepository(opts.repo, opts.branch, paths.repository, opts.githubToken);
  emit(`Repository resolved (read-only): ${resolved.rootDir} (branch: ${resolved.branch})`);

  const analysis = analyzeRepository(resolved.rootDir);
  emit(`Repository analyzed: ${analysis.framework}, ${analysis.language}, ${analysis.fileTree.length} files`);

  let legacyAnalysis: ReturnType<typeof analyzeRepository> | null = null;
  if (opts.sources.isModernization) {
    if (!opts.sources.legacyRepo) {
      throw new Error("Legacy modernization is on but no legacy repository was given.");
    }
    const legacyAlreadyCloned = fs.existsSync(paths.legacyRepository) && fs.readdirSync(paths.legacyRepository).length > 0;
    const legacyResolved = legacyAlreadyCloned
      ? { rootDir: paths.legacyRepository, branch: opts.sources.legacyBranch ?? "unknown", clonedByTool: true }
      : resolveRepository(opts.sources.legacyRepo, opts.sources.legacyBranch, paths.legacyRepository, opts.githubToken);
    legacyAnalysis = analyzeRepository(legacyResolved.rootDir);
    emit(`Legacy codebase resolved (read-only): ${legacyResolved.rootDir} (${legacyAnalysis.fileTree.length} files)`);
  }

  emit("Fetching link sources...", "active");
  const { fetched: fetchedLinks, failed: unreadableLinks } = await fetchLinks(opts.sources.links ?? []);
  if (unreadableLinks.length > 0) emit(`${unreadableLinks.length} link(s) could not be read (see report)`, "failed");
  if (fetchedLinks.length > 0) emit(`Read ${fetchedLinks.length} link(s)`);

  const combinedText = combineRequirementSources(opts.sources, fetchedLinks);
  if (!combinedText.trim()) {
    throw new Error("No requirement source given - provide a document, at least one readable link, or notes.");
  }

  // Same doc/links/notes idea, but describing the legacy system itself -
  // kept separate from combinedText above since it feeds the gap-analysis
  // prompt's legacy section, not requirement generation.
  let legacyContextText = "";
  if (opts.sources.isModernization) {
    const { fetched: fetchedLegacyLinks, failed: unreadableLegacyLinks } = await fetchLinks(opts.sources.legacyLinks ?? []);
    if (unreadableLegacyLinks.length > 0) emit(`${unreadableLegacyLinks.length} legacy link(s) could not be read`, "failed");
    legacyContextText = combineRequirementSources(
      { documentText: opts.sources.legacyDocumentText, notes: opts.sources.legacyNotes },
      fetchedLegacyLinks
    );
  }

  emit("Sending prompt to Requirement Agent...", "active", "requirement-agent.system");
  const requirements = await generateRequirements(client, combinedText, analysis);
  emit(`Requirements identified: ${requirements.requirements.length}`);

  emit("Running gap analysis against the repository...", "active");
  const observations: Observation[] = [];
  for (const req of requirements.requirements) {
    const relevantFiles = retrieveRelevantFiles(resolved.rootDir, analysis.candidateFiles, req.description);
    const legacyExcerpts = legacyAnalysis
      ? retrieveRelevantFiles(legacyAnalysis.rootDir, legacyAnalysis.candidateFiles, req.description, 5)
      : [];
    emit(`Sending prompt to Gap Analysis Agent (${req.id})...`, "active", "gap-analysis.system");
    const obs = await analyzeRequirementGap(client, {
      requirement: req,
      relevantFiles,
      isModernization: Boolean(opts.sources.isModernization),
      legacyExcerpts,
      legacyContextText,
    });
    observations.push(...obs);
    emit(`${req.id}: ${obs.length} observation(s)`);
  }

  const result: AnalysisResult = {
    requirements,
    observations,
    unreadableLinks,
    isModernization: Boolean(opts.sources.isModernization),
    legacyRepo: opts.sources.legacyRepo,
  };

  writeAnalysisFile(paths, "analysis-result.json", JSON.stringify(result, null, 2));
  const persistedInputs: PersistedInputs = {
    repo: opts.repo,
    branch: opts.branch,
    sources: opts.sources,
    resolvedRootDir: resolved.rootDir,
  };
  writeAnalysisFile(paths, "analysis-inputs.json", JSON.stringify(persistedInputs, null, 2));
  writeLog(
    paths,
    "requirements-summary.txt",
    requirements.requirements.map((r) => `${r.id}: ${r.description}`).join("\n")
  );

  emit(`Analysis complete: ${requirements.requirements.length} requirement(s), ${observations.length} observation(s)`);
  return { paths, result, resolvedRepo: resolved };
}

/** Loads a previously-run analysis job's inputs, for a "re-analyze with more notes" UI action. */
export function loadAnalysisInputs(jobId: string): PersistedInputs {
  const paths = getJobPaths(jobId);
  const p = paths.analysis + "/analysis-inputs.json";
  if (!fs.existsSync(p)) throw new Error(`No analysis-inputs.json found for job ${jobId}`);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as PersistedInputs;
}

export function loadAnalysisResult(jobId: string): AnalysisResult {
  const paths = getJobPaths(jobId);
  const p = paths.analysis + "/analysis-result.json";
  if (!fs.existsSync(p)) throw new Error(`No analysis-result.json found for job ${jobId}`);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as AnalysisResult;
}
