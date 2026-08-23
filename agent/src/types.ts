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
}

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

export interface RunOptionsForTests {
  jobId: string;
  baseUrl: string;
  headed: boolean;
  harness?: HarnessKind;
}

export interface ExecutedTestResult {
  title: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  error?: string;
  durationMs: number;
}

export interface TestRunResult {
  ran: boolean;
  passed: number;
  failed: number;
  skipped: number;
  tests: ExecutedTestResult[];
  rawOutput: string;
}

export interface JobPaths {
  jobId: string;
  root: string;
  repository: string;
  analysis: string;
  generatedTests: string;
  reports: string;
  logs: string;
  runResults: string;
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
