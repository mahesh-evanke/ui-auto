export interface RunOptions {
  repo: string;
  requirement: string;
  branch?: string;
  model: string;
  ollamaHost: string;
  referenceFrameworkPath: string;
  /** GitHub access token used only transiently to clone a private repo; never persisted or logged. */
  githubToken?: string;
  /**
   * Which harness the generated artifacts are meant for. "bundled" (default)
   * always produces Gherkin targeting this repo's own step definitions, so a
   * target repo with no test framework of its own is still fully supported.
   */
  harness?: HarnessKind;
  /**
   * Which LLM backend runs generation. "ollama" (default) is local and needs
   * nothing configured. "openai"/"openrouter" use an API key connected from
   * Settings (see src/llm/openAiCompatibleClient.ts).
   */
  provider?: "ollama" | "openai" | "openrouter";
  openaiToken?: string;
  openaiModel?: string;
  openrouterToken?: string;
  openrouterModel?: string;
  /**
   * Which artifact(s) to generate. Unset preserves the original auto-selected
   * behavior (Gherkin under the bundled harness or a Cucumber target repo,
   * Playwright spec otherwise) - set explicitly to force one or both.
   */
  outputFormat?: OutputFormat;
  /**
   * What the generated scenarios cover. "web" (UI only) and "api" (API only)
   * each restrict the step catalog and the model's step choices to that
   * kind. "both" (default) additionally instructs the planner to interleave
   * them in real navigation order - a UI action that triggers a backend call
   * gets a following API assertion step, not two separate scenarios.
   */
  testScope?: TestScope;
}

export type OutputFormat = "gherkin" | "spec" | "both";
export type TestScope = "web" | "api" | "both";

export type ProgressStatus = "done" | "active" | "failed";

export interface ProgressEvent {
  label: string;
  status: ProgressStatus;
}

export interface PackageJsonInfo {
  name?: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface RepoAnalysis {
  rootDir: string;
  framework: string;
  language: string;
  packageManager: "npm" | "pnpm" | "yarn";
  packageJson: PackageJsonInfo | null;
  devScript: string | null;
  buildScript: string | null;
  lintScript: string | null;
  testScript: string | null;
  hasPlaywright: boolean;
  hasPlaywrightConfig: boolean;
  fileTree: string[];
  candidateFiles: CandidateFile[];
}

export interface CandidateFile {
  path: string;
  kind: "page" | "component" | "route" | "test" | "config" | "other";
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface Requirement {
  id: string;
  description: string;
  priority: "high" | "medium" | "low";
  acceptanceCriteria: AcceptanceCriterion[];
  relatedUi: string[];
}

export interface RequirementSet {
  requirements: Requirement[];
}

export interface TestScenario {
  id: string;
  category: string;
  description: string;
}

export interface TestPlanItem {
  requirementId: string;
  relevantFiles: string[];
  scenarios: TestScenario[];
}

export interface TestPlan {
  items: TestPlanItem[];
}

export interface GeneratedSpec {
  fileName: string;
  content: string;
}

// --- Test framework detection (target repo) -----------------------------

export type TestFrameworkKind = "playwright-cucumber" | "playwright" | "other" | "none";

export interface TargetFrameworkAnalysis {
  kind: TestFrameworkKind;
  configFiles: string[];
  existingSpecFiles: string[];
  existingFeatureFiles: string[];
  existingStepDefFiles: string[];
  existingLocatorFiles: string[];
}

// --- Reference framework conventions -------------------------------------

export interface StepDefinitionEntry {
  stepText: string;
  keyword: "Given" | "When" | "Then";
  kind: "ui" | "api";
  sourceFile: string;
  /**
   * True when the step's handler takes a Cucumber DataTable/DocString. The
   * generator has no way to invent a meaningful table, and calling such a
   * step without one fails at runtime ("table.hashes is not a function"), so
   * these are excluded from the reusable vocabulary.
   */
  requiresDataTable?: boolean;
}

export interface ReferenceFrameworkProfile {
  rootDir: string;
  steps: StepDefinitionEntry[];
  locatorExample: string | null;
  notes: string[];
}

export interface FrameworkAnalysis {
  target: TargetFrameworkAnalysis;
  reference: ReferenceFrameworkProfile;
}

// --- Existing-test discovery (coverage gap analysis) ----------------------

export interface ExistingTestMatch {
  path: string;
  kind: "spec" | "feature" | "stepdef";
  matchedOn: string;
}

// --- Step reuse ------------------------------------------------------------

export interface StepIntent {
  description: string;
  keyword: "Given" | "When" | "Then";
  kind: "ui" | "api";
}

export interface ResolvedStep {
  text: string;
  keyword: "Given" | "When" | "Then";
  reused: boolean;
  sourceFile?: string;
}

export interface GeneratedScenarioSteps {
  requirementId: string;
  scenarioId: string;
  title: string;
  steps: ResolvedStep[];
}

// --- Generated artifacts -----------------------------------------------

export type ArtifactKind = "playwright-spec" | "feature" | "step-definitions" | "api-step-definitions";

export interface GeneratedArtifact {
  kind: ArtifactKind;
  fileName: string;
  /** Display-friendly path relative to the job's generated-tests/ dir. */
  relativePath: string;
  /** Absolute filesystem path - what the Run step actually executes. */
  absolutePath: string;
  content: string;
}

export interface CoverageRow {
  requirementId: string;
  scenarioId: string;
  artifactFileName: string;
}

export interface TestGenerationReport {
  repo: string;
  branch: string;
  requirement: string;
  frameworkKind: TestFrameworkKind;
  filesAnalyzedCount: number;
  relevantFilesCount: number;
  existingTestFilesCount: number;
  scenarioCount: number;
  artifacts: GeneratedArtifact[];
  reusedStepsCount: number;
  newStepsCount: number;
  requirementsCoveredCount: number;
  requirementsTotalCount: number;
  coverage: CoverageRow[];
  assumptions: string[];
  gaps: string[];
  startedAt: string;
  finishedAt: string;
}

// --- Run step (executes already-generated artifacts, explicit/opt-in) -----

export interface RunContext {
  jobId: string;
  repo: string;
  branch: string;
  resolvedRootDir: string;
  clonedByTool: boolean;
  frameworkKind: TestFrameworkKind;
  generatedArtifacts: GeneratedArtifact[];
}

/**
 * Which harness executes the generated tests.
 * - "bundled" (default): this repository's own Playwright + Cucumber framework
 *   (e2e/stepdefinitions). The target only needs to be an app reachable at a URL.
 * - "target": the target repository's own test framework, which must already
 *   be a Playwright/Cucumber project with its own step definitions.
 */
export type HarnessKind = "bundled" | "target";

/**
 * chromium/chrome/edge launch through Playwright's chromium browser type
 * (chromium = bundled default, chrome/edge = installed-browser "channel").
 * firefox is listed because e2e/config/config.yaml documents it as a
 * supported value, but e2e/stepdefinitions/hooks.ts only ever calls
 * chromium.launch(...) - there is no firefox.launch() branch today. Picking
 * it here still runs (falls back to Chromium with a warning) rather than
 * being rejected, since fixing that is a framework change out of this
 * agent's scope, not something to silently paper over either.
 */
export type BrowserName = "chromium" | "chrome" | "edge" | "firefox";

export interface RunOptionsForTests {
  jobId: string;
  baseUrl: string;
  headed: boolean;
  harness?: HarnessKind;
  /** Only honored by the bundled harness (env vars PW_CHANNEL/VIEWPORT_DEVICE - see e2e/stepdefinitions/hooks.ts). */
  browserName?: BrowserName;
  /** A Playwright device name (e.g. "iPhone 12 Pro"), or unset/empty for desktop full window. */
  viewportDevice?: string;
  /**
   * When a run has failures, rewrite just the failing scenario(s) and re-run
   * - up to maxFixAttempts times. Default true. Only applies to the bundled
   * harness (needs an LLM call and rewrites the canonical .feature artifact,
   * neither of which the "target" harness's own-repo execution path does).
   */
  autoFix?: boolean;
  /** Correction rounds to attempt before giving up. Default 2. Each round re-runs the WHOLE feature, not just the scenarios it touched. */
  maxFixAttempts?: number;
  /** Which LLM backend powers auto-fix corrections - same shape as RunOptions, only read when autoFix is on. */
  provider?: "ollama" | "openai" | "openrouter";
  model?: string;
  ollamaHost?: string;
  openaiToken?: string;
  openaiModel?: string;
  openrouterToken?: string;
  openrouterModel?: string;
}

export interface ExecutedTestResult {
  title: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  error?: string;
  durationMs: number;
  /** The exact Gherkin line that failed (keyword + text), when known - what a correction pass needs to target the right step. */
  failedStepKeyword?: string;
  failedStepText?: string;
}

export interface TestRunResult {
  ran: boolean;
  passed: number;
  failed: number;
  skipped: number;
  tests: ExecutedTestResult[];
  rawOutput: string;
  /** Present only when autoFix ran - the history of correction rounds leading to this final result. */
  fixAttempts?: FixAttempt[];
}

/** One correction round of the auto-fix loop - what was rewritten and what the re-run then produced. */
export interface FixAttempt {
  attempt: number;
  correctedScenarioTitles: string[];
  /** A scenario whose failure the fixer couldn't diagnose into a corrected step list - left as-is. */
  unfixableScenarioTitles: string[];
  result: TestRunResult;
}

export interface JobPaths {
  jobId: string;
  root: string;
  repository: string;
  /** A second, separate read-only clone for legacy-modernization mode - see RequirementSourceInputs.isModernization. Never written to. */
  legacyRepository: string;
  analysis: string;
  generatedTests: string;
  reports: string;
  logs: string;
  runResults: string;
}

// --- Requirements intake (multi-source) + gap analysis ---------------------

/**
 * Every field is optional and independent - a user fills in whichever
 * sources they have (a pasted/uploaded doc, links, free-text notes) and any
 * combination gets merged into one requirement text before the existing
 * requirementAgent ever runs.
 */
export interface RequirementSourceInputs {
  /** Text extracted from an uploaded requirements document (.txt/.md read client-side; other formats aren't parsed - see app/jobs/new/page.tsx). */
  documentText?: string;
  /** URLs to fetch and extract text from - best-effort; auth-walled pages (most Confluence/internal wikis) will fail and are reported, not silently dropped. */
  links?: string[];
  /** Free-text notes typed directly by the user. */
  notes?: string;
  /**
   * When true, requirements are matched against BOTH the requirement
   * sources above AND a legacy codebase (legacyRepo) - the legacy code is
   * treated as the ground truth of current behavior, since a requirement
   * doc can be incomplete or stale in a way old, still-running code isn't.
   */
  isModernization?: boolean;
  /** Local path or git URL to the legacy codebase. Required when isModernization is true. */
  legacyRepo?: string;
  legacyBranch?: string;
}

export type ObservationSeverity = "high" | "medium" | "low";

/** One thing the gap-analysis pass judged as not properly implemented in the target repo relative to the requirements (and legacy code, if modernization). */
export interface Observation {
  id: string;
  requirementId?: string;
  title: string;
  description: string;
  severity: ObservationSeverity;
}

export interface AnalysisResult {
  requirements: RequirementSet;
  observations: Observation[];
  /** Links that failed to fetch (auth-walled, unreachable, etc.) - surfaced rather than silently ignored. */
  unreadableLinks: string[];
  isModernization: boolean;
  legacyRepo?: string;
}

export interface AnalysisOptions {
  repo: string;
  branch?: string;
  githubToken?: string;
  sources: RequirementSourceInputs;
  provider?: "ollama" | "openai" | "openrouter";
  model?: string;
  ollamaHost?: string;
  openaiToken?: string;
  openaiModel?: string;
  openrouterToken?: string;
  openrouterModel?: string;
}

export interface JobResult {
  jobId: string;
  repo: string;
  branch: string;
  feature: string;
  requirements: RequirementSet;
  testPlan: TestPlan;
  frameworkAnalysis: FrameworkAnalysis;
  generatedArtifacts: GeneratedArtifact[];
  report: TestGenerationReport;
  startedAt: string;
  finishedAt: string;
}
