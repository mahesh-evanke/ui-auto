"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";
import { Textarea } from "../../../components/ui/textarea.js";
import { Label } from "../../../components/ui/label.js";
import { Badge } from "../../../components/ui/badge.js";
import { Switch } from "../../../components/ui/checkbox.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs.js";
import { Stepper, type StepDef } from "../../../components/ui/stepper.js";
import { TaskProgress, type ProgressEvent } from "../../../components/task-progress.js";
import { RunTestsPanel } from "../../jobs/[jobId]/page.js";

// --- Shared shapes -----------------------------------------------------

interface Observation {
  id: string;
  requirementId?: string;
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
}

interface Requirement {
  id: string;
  description: string;
  priority: string;
  acceptanceCriteria: { id: string; description: string }[];
}

interface AnalysisResult {
  requirements: { requirements: Requirement[] };
  observations: Observation[];
  unreadableLinks: string[];
  isModernization: boolean;
}

interface TestScenario {
  id: string;
  category: string;
  description: string;
}

interface TestPlanItem {
  requirementId: string;
  scenarios: TestScenario[];
}

interface TestPlan {
  items: TestPlanItem[];
}

interface GeneratedArtifact {
  kind: "playwright-spec" | "feature" | "step-definitions" | "api-step-definitions";
  fileName: string;
  relativePath: string;
}

interface TestGenerationReport {
  scenarioCount: number;
  reusedStepsCount: number;
  newStepsCount: number;
  requirementsCoveredCount: number;
  requirementsTotalCount: number;
  artifacts: GeneratedArtifact[];
  gaps: string[];
}

interface Project {
  id: string;
  name: string;
  owner: string;
  repo: string;
  cloneUrl: string;
  defaultBranch: string;
  jobIds: string[];
}

const STEPS: StepDef[] = [
  { id: 1, label: "Requirements", icon: "fact_check" },
  { id: 2, label: "Manual Scenarios", icon: "checklist" },
  { id: 3, label: "Automated Tests", icon: "rocket_launch" },
];

const SEVERITY_VARIANT: Record<Observation["severity"], "destructive" | "warning" | "success"> = {
  high: "destructive",
  medium: "warning",
  low: "success",
};

/** One background task + its SSE stream - shared shape across all three steps. */
function useTask<T>(onDone: (result: T) => void) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;
    const es = new EventSource(`/api/tasks/${taskId}/events`);
    es.addEventListener("progress", (e) => setEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data)]));
    es.addEventListener("done", (e) => {
      onDone(JSON.parse((e as MessageEvent).data) as T);
      // Every "active" line is a start-of-phase message paired with a later,
      // differently-worded "done" line for that phase's completion - not an
      // update to the same line. Once the whole task is done, nothing is
      // still in progress, so close out any spinner left dangling because its
      // phase never got its own explicit completion event.
      setEvents((prev) => prev.map((ev) => (ev.status === "active" ? { ...ev, status: "done" } : ev)));
      setStatus("done");
      es.close();
    });
    es.addEventListener("failed", (e) => {
      setError(JSON.parse((e as MessageEvent).data));
      setEvents((prev) => prev.map((ev) => (ev.status === "active" ? { ...ev, status: "failed" } : ev)));
      setStatus("failed");
      es.close();
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  function start(id: string) {
    setTaskId(id);
    setStatus("running");
    setEvents([]);
    setError(null);
  }

  return { status, events, error, start, reset: () => setStatus("idle") };
}

interface LogGroup {
  label: string;
  events: ProgressEvent[];
  error: string | null;
}

/** Progress + error for one or more background tasks, in a single terminal-style container separate from the form(s) that trigger them. Groups with no events/error yet are omitted, so an idle group never shows an empty heading. */
function ExecutionLog({ title, groups }: { title: string; groups: LogGroup[] }) {
  const visible = groups.filter((g) => g.events.length > 0 || g.error);
  if (visible.length === 0) return null;
  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle>
          <span className="material-symbols-outlined">terminal</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        {visible.map((g) => (
          <div key={g.label}>
            {visible.length > 1 && <p className="mb-xs font-label-caps text-label-caps text-on-surface-variant">{g.label}</p>}
            <TaskProgress events={g.events} />
            {g.error && <p className="mt-sm font-body-sm text-body-sm text-error">{g.error}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** A full card-sized collapsible section (Repository, Requirement Intake) - same visual weight as a Card, just openable/closable. */
function CollapsibleCard({
  icon,
  title,
  description,
  defaultOpen,
  children,
}: {
  icon: string;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-outline-variant bg-surface-container-low">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-sm p-md [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined text-on-surface">{icon}</span>
          <div>
            <p className="font-headline-sm text-headline-sm text-on-surface">{title}</p>
            {description && <p className="font-body-sm text-body-sm text-on-surface-variant">{description}</p>}
          </div>
        </div>
        <span className="material-symbols-outlined shrink-0 text-on-surface-variant transition-transform group-open:rotate-180">
          expand_more
        </span>
      </summary>
      <div className="flex flex-col gap-md border-t border-outline-variant p-md">{children}</div>
    </details>
  );
}

/** A single collapsible row - closed by default so a long requirements/observations list stays scannable, open on click for whichever ones the user wants detail on. */
function CollapsibleItem({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-outline-variant bg-surface-container open:bg-surface-container-lowest">
      <summary className="flex cursor-pointer list-none items-center gap-sm p-sm [&::-webkit-details-marker]:hidden">
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant transition-transform group-open:rotate-90">
          chevron_right
        </span>
        <div className="flex-1">{summary}</div>
      </summary>
      <div className="px-sm pb-sm pl-[34px]">{children}</div>
    </details>
  );
}

function Wizard() {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get("projectId");

  // The wizard is always reached with a projectId now (every repo entry
  // point creates a Project first) - the owner/repo/cloneUrl/defaultBranch
  // query params are kept only as a fallback for any old bookmarked link
  // from before Projects existed.
  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(Boolean(projectId));
  const [projectError, setProjectError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setProjectLoading(true);
    setProjectError(null);
    fetch(`/api/projects/${encodeURIComponent(projectId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setProject(data);
      })
      .catch((err) => setProjectError(err instanceof Error ? err.message : String(err)))
      .finally(() => setProjectLoading(false));
  }, [projectId]);

  const owner = project?.owner ?? params.get("owner") ?? "";
  const repo = project?.repo ?? params.get("repo") ?? "";
  const cloneUrl = project?.cloneUrl ?? params.get("cloneUrl") ?? "";
  const defaultBranch = project?.defaultBranch ?? params.get("defaultBranch") ?? "main";
  const projectName = project?.name ?? (owner ? `${owner}/${repo}` : repo);

  const [step, setStep] = useState(1);

  // Step 1: requirement sources
  const [documentText, setDocumentText] = useState("");
  const [documentFileName, setDocumentFileName] = useState<string | null>(null);
  const [linksText, setLinksText] = useState("");
  const [notes, setNotes] = useState("");
  const [isModernization, setIsModernization] = useState(false);
  const [legacyRepo, setLegacyRepo] = useState("");
  const [legacyBranch, setLegacyBranch] = useState("");
  const [legacyDocumentText, setLegacyDocumentText] = useState("");
  const [legacyDocumentFileName, setLegacyDocumentFileName] = useState<string | null>(null);
  const [legacyLinksText, setLegacyLinksText] = useState("");
  const [legacyNotes, setLegacyNotes] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const analysisTask = useTask<{ result: AnalysisResult }>((r) => setAnalysisResult(r.result));

  // Step 2: manual scenarios
  const [manualNotes, setManualNotes] = useState("");
  const [testPlan, setTestPlan] = useState<TestPlan | null>(null);
  const manualTask = useTask<{ testPlan: TestPlan }>((r) => setTestPlan(r.testPlan));

  // Step 3: automated tests
  const [outputFormat, setOutputFormat] = useState<"gherkin" | "spec" | "both">("gherkin");
  const [report, setReport] = useState<TestGenerationReport | null>(null);
  const automationTask = useTask<{ report: TestGenerationReport }>((r) => setReport(r.report));
  const [runEvents, setRunEvents] = useState<ProgressEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  async function handleDocumentUpload(file: File) {
    const text = await file.text();
    setDocumentText(text);
    setDocumentFileName(file.name);
  }

  async function handleLegacyDocumentUpload(file: File) {
    const text = await file.text();
    setLegacyDocumentText(text);
    setLegacyDocumentFileName(file.name);
  }

  async function handleAnalyze() {
    const links = linksText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!documentText.trim() && links.length === 0 && !notes.trim()) {
      setSourceError("Provide at least one requirement source: a document, a link, or notes.");
      return;
    }
    if (isModernization && !legacyRepo.trim()) {
      setSourceError("Legacy modernization is on - provide the legacy repository.");
      return;
    }
    setSourceError(null);

    const legacyLinks = legacyLinksText.split("\n").map((l) => l.trim()).filter(Boolean);
    const sources = {
      documentText: documentText.trim() || undefined,
      links: links.length > 0 ? links : undefined,
      notes: notes.trim() || undefined,
      isModernization,
      legacyRepo: isModernization ? legacyRepo.trim() : undefined,
      legacyBranch: isModernization ? legacyBranch.trim() || undefined : undefined,
      legacyDocumentText: isModernization ? legacyDocumentText.trim() || undefined : undefined,
      legacyLinks: isModernization && legacyLinks.length > 0 ? legacyLinks : undefined,
      legacyNotes: isModernization ? legacyNotes.trim() || undefined : undefined,
    };

    const endpoint = jobId ? `/api/analysis/${jobId}/reanalyze` : "/api/analysis";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        jobId ? { sources } : { repo: cloneUrl, branch: defaultBranch, sources, projectId: projectId ?? undefined }
      ),
    });
    const data = await res.json();
    if (!res.ok) {
      setSourceError(data.error ?? `HTTP ${res.status}`);
      return;
    }
    if (data.jobId) setJobId(data.jobId);
    analysisTask.start(data.taskId);
  }

  async function handleBuildScenarios() {
    if (!jobId) return;
    const res = await fetch(`/api/analysis/${jobId}/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: manualNotes.trim() || undefined, testScope: "both" }),
    });
    const data = await res.json();
    if (res.ok) manualTask.start(data.taskId);
  }

  async function handleGenerateAutomation() {
    if (!jobId) return;
    const res = await fetch(`/api/analysis/${jobId}/automation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testPlan: testPlan ?? undefined, outputFormat, testScope: "both" }),
    });
    const data = await res.json();
    if (res.ok) automationTask.start(data.taskId);
  }

  if (projectLoading) {
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <p className="font-body-sm text-body-sm text-on-surface-variant">Loading project...</p>
      </div>
    );
  }

  if (projectError || !repo || !cloneUrl) {
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <Card>
          <CardContent className="pt-lg">
            <p className="mb-md font-body-md text-body-md text-on-surface-variant">
              {projectError ?? "No repository selected."}
            </p>
            <Button onClick={() => router.push("/repositories")}>Choose a repository</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const analyzing = analysisTask.status === "running";
  const buildingScenarios = manualTask.status === "running";
  const generatingAutomation = automationTask.status === "running";
  const scenarioCount = testPlan?.items.reduce((n, i) => n + i.scenarios.length, 0) ?? 0;
  const coveragePct = report ? Math.round((report.requirementsCoveredCount / Math.max(report.requirementsTotalCount, 1)) * 100) : 0;
  const stepReusePct = report ? Math.round((report.reusedStepsCount / Math.max(report.reusedStepsCount + report.newStepsCount, 1)) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-lg flex items-center justify-between">
        <div>
          <div className="flex items-center gap-xs font-label-caps text-label-caps text-primary">
            <span className="material-symbols-outlined text-[16px]">folder</span>
            Project
          </div>
          <h1 className="mt-1 font-headline-md text-headline-md text-on-surface">{projectName}</h1>
        </div>
        {jobId && <Badge variant="outline" className="font-code-sm">{jobId}</Badge>}
      </div>

      <Card className="mb-lg p-lg">
        <Stepper steps={STEPS} current={step} onSelect={setStep} />
      </Card>

      {/* ---------- Step 1: Requirements ---------- */}
      {step === 1 && (
        <div className="flex animate-fade-in flex-col gap-lg">
        <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
          <div className="flex flex-col gap-lg">
            <CollapsibleCard
              icon="folder"
              title="Repository"
              description={`${owner ? `${owner}/${repo}` : repo} · ${defaultBranch}`}
            >
              <div className="flex flex-col gap-xs font-body-sm text-body-sm">
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">Repository</span>
                  <span className="text-on-surface">{owner ? `${owner}/${repo}` : repo}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">Clone URL</span>
                  <span className="truncate font-code-sm text-code-sm text-on-surface" title={cloneUrl}>{cloneUrl}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">Branch</span>
                  <span className="text-on-surface">{defaultBranch}</span>
                </div>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Set when this project was created. To point it at a different repository,{" "}
                <button type="button" onClick={() => router.push("/repositories")} className="text-primary underline underline-offset-2">
                  start a new project
                </button>
                .
              </p>
            </CollapsibleCard>

            <CollapsibleCard
              icon="inbox"
              title="Requirement Intake"
              description="Fill in any combination - all optional, but at least one is required."
              defaultOpen
            >
              <Tabs defaultValue="document">
                <TabsList>
                  <TabsTrigger value="document">
                    <span className="material-symbols-outlined">upload_file</span>
                    Upload Document
                  </TabsTrigger>
                  <TabsTrigger value="links">
                    <span className="material-symbols-outlined">link</span>
                    Paste Links
                  </TabsTrigger>
                  <TabsTrigger value="notes">
                    <span className="material-symbols-outlined">sticky_note_2</span>
                    Notes
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="document">
                  <label
                    htmlFor="doc-upload-input"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) void handleDocumentUpload(file);
                    }}
                    className="flex cursor-pointer flex-col items-center gap-sm rounded-lg border-2 border-dashed border-outline-variant bg-surface-container p-lg text-center transition-colors hover:border-primary"
                  >
                    <span className="material-symbols-outlined text-[32px] text-on-surface-variant">cloud_upload</span>
                    <p className="font-body-sm text-body-sm text-on-surface">Drag and drop a requirements file here</p>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">Supports .txt, .md, .csv, .json</p>
                    <span className="mt-xs rounded-lg border border-outline-variant px-md py-2 font-body-sm text-body-sm text-on-surface">
                      Browse Files
                    </span>
                    <input
                      id="doc-upload-input"
                      type="file"
                      accept=".txt,.md,.csv,.json"
                      disabled={analyzing}
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleDocumentUpload(e.target.files[0])}
                    />
                  </label>

                  {documentFileName && (
                    <div className="mt-sm flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container p-sm">
                      <span className="flex items-center gap-sm font-body-sm text-body-sm text-on-surface">
                        <span className="material-symbols-outlined text-primary">description</span>
                        {documentFileName}
                      </span>
                      <button
                        type="button"
                        disabled={analyzing}
                        onClick={() => {
                          setDocumentFileName(null);
                          setDocumentText("");
                        }}
                        className="text-on-surface-variant transition-colors hover:text-error disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  )}

                  <p className="mt-sm font-body-sm text-body-sm text-on-surface-variant">
                    Only plain-text formats (.txt, .md, .csv...) are read correctly. Or paste directly:
                  </p>
                  <Textarea
                    value={documentText}
                    onChange={(e) => setDocumentText(e.target.value)}
                    disabled={analyzing}
                    placeholder="Paste requirements document text here..."
                    className="mt-2 min-h-[90px]"
                  />
                </TabsContent>

                <TabsContent value="links">
                  <Textarea
                    value={linksText}
                    onChange={(e) => setLinksText(e.target.value)}
                    disabled={analyzing}
                    placeholder={"https://example.com/spec\nhttps://example.com/policy"}
                    className="min-h-[120px]"
                  />
                  <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">
                    Plain unauthenticated fetch - a page behind sign-in (most internal wikis) will fail to read and be reported, not silently skipped.
                  </p>
                </TabsContent>

                <TabsContent value="notes">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={analyzing}
                    placeholder="Any additional detail, business rules, or context..."
                    className="min-h-[120px]"
                  />
                </TabsContent>
              </Tabs>

              {sourceError && <p className="font-body-sm text-body-sm text-error">{sourceError}</p>}

              <Button size="lg" disabled={analyzing} onClick={handleAnalyze} className="w-full sm:w-auto">
                {analyzing ? "Analyzing..." : jobId ? "Re-analyze" : "Analyze"}
              </Button>
            </CollapsibleCard>
          </div>

          <div className="flex flex-col gap-lg">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="material-symbols-outlined">tune</span>
                  Execution Context
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container p-sm">
                  <div>
                    <p className="font-body-sm text-body-sm text-on-surface">Legacy Modernization</p>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      Treated as the ground truth of current behavior - requirements matched against it too.
                    </p>
                  </div>
                  <Switch checked={isModernization} onCheckedChange={(v) => setIsModernization(v === true)} disabled={analyzing} />
                </div>

                {isModernization && (
                  <div className="rounded-lg border border-outline-variant bg-surface-container p-md">
                    <Tabs defaultValue="repo">
                      <TabsList>
                        <TabsTrigger value="repo">
                          <span className="material-symbols-outlined">history</span>
                          Legacy codebase
                        </TabsTrigger>
                        <TabsTrigger value="document">
                          <span className="material-symbols-outlined">upload_file</span>
                          Upload Document
                        </TabsTrigger>
                        <TabsTrigger value="links">
                          <span className="material-symbols-outlined">link</span>
                          Paste Links
                        </TabsTrigger>
                        <TabsTrigger value="notes">
                          <span className="material-symbols-outlined">sticky_note_2</span>
                          Notes
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="repo">
                        <Label className="mb-1 block text-xs">Legacy repository (git URL or local path)</Label>
                        <Input value={legacyRepo} onChange={(e) => setLegacyRepo(e.target.value)} disabled={analyzing} placeholder="https://github.com/org/legacy-app.git" className="mb-3" />
                        <Label className="mb-1 block text-xs">Legacy branch (optional)</Label>
                        <Input value={legacyBranch} onChange={(e) => setLegacyBranch(e.target.value)} disabled={analyzing} placeholder="main" />
                      </TabsContent>

                      <TabsContent value="document">
                        <label
                          htmlFor="legacy-doc-upload-input"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files?.[0];
                            if (file) void handleLegacyDocumentUpload(file);
                          }}
                          className="flex cursor-pointer flex-col items-center gap-sm rounded-lg border-2 border-dashed border-outline-variant bg-surface-container-lowest p-md text-center transition-colors hover:border-primary"
                        >
                          <span className="material-symbols-outlined text-[28px] text-on-surface-variant">cloud_upload</span>
                          <p className="font-body-sm text-body-sm text-on-surface">Drag and drop a file here</p>
                          <span className="rounded-lg border border-outline-variant px-md py-2 font-body-sm text-body-sm text-on-surface">
                            Browse Files
                          </span>
                          <input
                            id="legacy-doc-upload-input"
                            type="file"
                            accept=".txt,.md,.csv,.json"
                            disabled={analyzing}
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleLegacyDocumentUpload(e.target.files[0])}
                          />
                        </label>

                        {legacyDocumentFileName && (
                          <div className="mt-sm flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest p-sm">
                            <span className="flex items-center gap-sm font-body-sm text-body-sm text-on-surface">
                              <span className="material-symbols-outlined text-primary">description</span>
                              {legacyDocumentFileName}
                            </span>
                            <button
                              type="button"
                              disabled={analyzing}
                              onClick={() => {
                                setLegacyDocumentFileName(null);
                                setLegacyDocumentText("");
                              }}
                              className="text-on-surface-variant transition-colors hover:text-error disabled:opacity-50"
                            >
                              <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                          </div>
                        )}

                        <Textarea
                          value={legacyDocumentText}
                          onChange={(e) => setLegacyDocumentText(e.target.value)}
                          disabled={analyzing}
                          placeholder="Paste legacy spec/doc text here..."
                          className="mt-2 min-h-[70px]"
                        />
                      </TabsContent>

                      <TabsContent value="links">
                        <Textarea
                          value={legacyLinksText}
                          onChange={(e) => setLegacyLinksText(e.target.value)}
                          disabled={analyzing}
                          placeholder={"https://example.com/legacy-spec"}
                          className="min-h-[70px]"
                        />
                      </TabsContent>

                      <TabsContent value="notes">
                        <Textarea
                          value={legacyNotes}
                          onChange={(e) => setLegacyNotes(e.target.value)}
                          disabled={analyzing}
                          placeholder="Any notes on how the legacy system currently behaves..."
                          className="min-h-[70px]"
                        />
                      </TabsContent>
                    </Tabs>
                  </div>
                )}
              </CardContent>
            </Card>

            <ExecutionLog title="Execution Log" groups={[{ label: "Analysis", events: analysisTask.events, error: analysisTask.error }]} />
          </div>
        </div>

        {analysisResult && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>
                <span className="material-symbols-outlined">rule</span>
                Gap Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-md">
              <div className="flex flex-col gap-xs">
                {analysisResult.requirements.requirements.map((r) => (
                  <CollapsibleItem
                    key={r.id}
                    summary={
                      <p className="font-body-sm text-body-sm text-on-surface">
                        <span className="font-semibold text-primary">{r.id}</span> — {r.description}
                      </p>
                    }
                  >
                    <ul className="list-inside list-disc font-body-sm text-body-sm text-on-surface-variant">
                      {r.acceptanceCriteria.map((ac) => (
                        <li key={ac.id}>{ac.description}</li>
                      ))}
                    </ul>
                  </CollapsibleItem>
                ))}
              </div>

              {analysisResult.unreadableLinks.length > 0 && (
                <p className="font-body-sm text-body-sm text-tertiary">
                  Could not read {analysisResult.unreadableLinks.length} link(s): {analysisResult.unreadableLinks.join("; ")}
                </p>
              )}

              <div>
                <h4 className="mb-1 font-body-md text-body-md font-semibold text-on-surface">Observations (Unimplemented Code)</h4>
                <p className="mb-sm font-body-sm text-body-sm text-on-surface-variant">Things that appear not properly implemented in the repository.</p>
                {analysisResult.observations.length === 0 ? (
                  <p className="font-body-sm text-body-sm text-log-success">No gaps found - the repository appears to satisfy the requirements identified.</p>
                ) : (
                  <div className="flex flex-col gap-xs">
                    {analysisResult.observations.map((o) => (
                      <CollapsibleItem
                        key={o.id}
                        summary={
                          <div className="flex items-center gap-sm">
                            <Badge variant={SEVERITY_VARIANT[o.severity]} className="shrink-0">{o.severity}</Badge>
                            <p className="font-body-sm text-body-sm font-medium text-on-surface">{o.title}</p>
                          </div>
                        }
                      >
                        <p className="font-body-sm text-body-sm text-on-surface-variant">{o.description}</p>
                      </CollapsibleItem>
                    ))}
                  </div>
                )}
              </div>

              <p className="font-body-sm text-body-sm text-on-surface-variant">Not everything captured? Add more detail above and click Re-analyze.</p>

              <Button onClick={() => setStep(2)} className="gap-2">
                Continue to Test Scenarios
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Button>
            </CardContent>
          </Card>
        )}
        </div>
      )}

      {/* ---------- Step 2: Manual scenarios ---------- */}
      {step === 2 && (
        <div className="flex animate-fade-in flex-col gap-lg">
        <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                <span className="material-symbols-outlined">auto_stories</span>
                Generated Scenarios {testPlan ? `(${scenarioCount})` : ""}
              </CardTitle>
              <CardDescription>Generated from the requirements and observations.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-md">
              {!testPlan && !buildingScenarios && (
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  No scenarios yet - use Refine &amp; Action on the right to generate them.
                </p>
              )}
              {testPlan && (
                <div className="flex flex-col gap-md">
                  {testPlan.items.map((item) => (
                    <div key={item.requirementId} className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                      <p className="mb-sm font-body-sm text-body-sm font-semibold text-primary">{item.requirementId}</p>
                      <ul className="flex flex-col gap-sm">
                        {item.scenarios.map((s) => (
                          <li key={s.id} className="flex items-start gap-sm font-code-sm text-code-sm text-on-surface">
                            <Badge variant="secondary">{s.category}</Badge>
                            <span>{s.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="material-symbols-outlined">edit_note</span>
                Refine &amp; Action
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-md">
              <div>
                <Label className="mb-1 block">Refinement Notes</Label>
                <Textarea
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  disabled={buildingScenarios}
                  placeholder="Additional detail for this scenario pass (optional)..."
                  className="min-h-[100px]"
                />
              </div>
              <Button variant="outline" disabled={buildingScenarios} onClick={handleBuildScenarios}>
                {buildingScenarios ? "Generating..." : testPlan ? "Regenerate Scenarios" : "Generate manual scenarios"}
              </Button>
              {testPlan && (
                <Button onClick={() => setStep(3)}>
                  Approve Scenarios
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <ExecutionLog title="Execution Log" groups={[{ label: "Manual Scenarios", events: manualTask.events, error: manualTask.error }]} />
        </div>
      )}

      {/* ---------- Step 3: Automated tests ---------- */}
      {step === 3 && (
        <div className="animate-fade-in">
          {!testPlan && !report ? (
            <Card>
              <CardContent className="pt-lg font-body-sm text-body-sm text-on-surface-variant">
                Approve manual scenarios first, in the Manual Scenarios step.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-lg lg:grid-cols-12">
              <div className="flex flex-col gap-lg lg:col-span-7">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <span className="material-symbols-outlined">code_blocks</span>
                      Test Generation Options
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-md">
                    <div className="flex flex-wrap gap-xs">
                      {(["gherkin", "spec", "both"] as const).map((v) => (
                        <Button key={v} variant={outputFormat === v ? "default" : "outline"} disabled={generatingAutomation} onClick={() => setOutputFormat(v)} size="sm">
                          {v === "gherkin" ? ".feature (Cucumber)" : v === "spec" ? ".spec.ts (Playwright)" : "Both"}
                        </Button>
                      ))}
                    </div>
                    <Button disabled={generatingAutomation} onClick={handleGenerateAutomation}>
                      {generatingAutomation ? "Generating..." : report ? "Regenerate" : "Generate Code"}
                    </Button>
                  </CardContent>
                </Card>

                {report && (
                  <Card className="animate-fade-in">
                    <CardHeader>
                      <CardTitle>
                        <span className="material-symbols-outlined">query_stats</span>
                        Coverage Analysis
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-md">
                      <div className="grid grid-cols-2 gap-sm sm:grid-cols-4">
                        <div className="rounded-lg border border-outline-variant bg-surface-container p-sm">
                          <p className="font-label-caps text-label-caps text-on-surface-variant">Scenarios Covered</p>
                          <p className="font-headline-md text-headline-md text-on-surface">
                            {report.requirementsCoveredCount}/{report.requirementsTotalCount}
                          </p>
                        </div>
                        <div className="rounded-lg border border-outline-variant bg-surface-container p-sm">
                          <p className="font-label-caps text-label-caps text-on-surface-variant">Step Reuse Rate</p>
                          <p className="font-headline-md text-headline-md text-on-surface">{stepReusePct}%</p>
                        </div>
                        <div className="rounded-lg border border-outline-variant bg-surface-container p-sm">
                          <p className="font-label-caps text-label-caps text-on-surface-variant">Scenarios</p>
                          <p className="font-headline-md text-headline-md text-on-surface">{report.scenarioCount}</p>
                        </div>
                        <div className="rounded-lg border border-outline-variant bg-surface-container p-sm">
                          <p className="font-label-caps text-label-caps text-on-surface-variant">Coverage</p>
                          <p className="font-headline-md text-headline-md text-on-surface">{coveragePct}%</p>
                        </div>
                      </div>

                      <div>
                        <h4 className="mb-1 font-body-md text-body-md font-semibold text-on-surface">Generated artifacts</h4>
                        <ul className="flex flex-col gap-xs">
                          {report.artifacts.map((a) => (
                            <li key={a.relativePath} className="flex items-center gap-sm font-code-sm text-code-sm text-on-surface">
                              {a.relativePath}
                              <Badge variant="secondary">{a.kind}</Badge>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {report.gaps.length > 0 && (
                        <div>
                          <h4 className="mb-1 font-body-md text-body-md font-semibold text-on-surface">Potential gaps</h4>
                          <ul className="list-inside list-disc font-body-sm text-body-sm text-on-surface-variant">
                            {report.gaps.map((g, i) => (
                              <li key={i}>{g}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <ExecutionLog
                  title="Execution Log"
                  groups={[
                    { label: "Test Generation", events: automationTask.events, error: automationTask.error },
                    { label: "Test Run", events: runEvents, error: runError },
                  ]}
                />
              </div>

              <div className="lg:col-span-5">
                {jobId && (
                  <RunTestsPanel
                    jobId={jobId}
                    onEventsChange={(events, error) => {
                      setRunEvents(events);
                      setRunError(error);
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NewAnalysisPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Wizard />
    </Suspense>
  );
}
