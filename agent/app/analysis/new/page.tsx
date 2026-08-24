"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileSearch, ListChecks, Rocket, Upload, Link2, StickyNote, History, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";
import { Textarea } from "../../../components/ui/textarea.js";
import { Label } from "../../../components/ui/label.js";
import { Badge } from "../../../components/ui/badge.js";
import { Checkbox } from "../../../components/ui/checkbox.js";
import { Select } from "../../../components/ui/select.js";
import { Stepper, type StepDef } from "../../../components/ui/stepper.js";
import { TaskProgress, type ProgressEvent } from "../../../components/task-progress.js";
import { RunTestsPanel } from "../../jobs/[jobId]/page.js";

// --- Shared shapes -----------------------------------------------------

interface GithubBranch {
  name: string;
  protected: boolean;
}

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

const STEPS: StepDef[] = [
  { id: 1, label: "Requirements", description: "Sources + gap analysis", icon: <FileSearch className="h-5 w-5" /> },
  { id: 2, label: "Manual scenarios", description: "Review & approve", icon: <ListChecks className="h-5 w-5" /> },
  { id: 3, label: "Automated tests", description: "Generate & run", icon: <Rocket className="h-5 w-5" /> },
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
      setStatus("done");
      es.close();
    });
    es.addEventListener("failed", (e) => {
      setError(JSON.parse((e as MessageEvent).data));
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

function SourceCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function Wizard() {
  const router = useRouter();
  const params = useSearchParams();
  const owner = params.get("owner") ?? "";
  const repo = params.get("repo") ?? "";
  const cloneUrl = params.get("cloneUrl") ?? "";
  const defaultBranch = params.get("defaultBranch") ?? "main";

  const [step, setStep] = useState(1);
  const [branches, setBranches] = useState<GithubBranch[] | null>(null);
  const [branch, setBranch] = useState(defaultBranch);

  // Step 1: requirement sources
  const [documentText, setDocumentText] = useState("");
  const [documentFileName, setDocumentFileName] = useState<string | null>(null);
  const [linksText, setLinksText] = useState("");
  const [notes, setNotes] = useState("");
  const [isModernization, setIsModernization] = useState(false);
  const [legacyRepo, setLegacyRepo] = useState("");
  const [legacyBranch, setLegacyBranch] = useState("");
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

  useEffect(() => {
    if (!owner || !repo) return;
    fetch(`/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`)
      .then((res) => res.json())
      .then((data) => setBranches(data.branches ?? []))
      .catch(() => setBranches([]));
  }, [owner, repo]);

  async function handleDocumentUpload(file: File) {
    const text = await file.text();
    setDocumentText(text);
    setDocumentFileName(file.name);
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

    const sources = {
      documentText: documentText.trim() || undefined,
      links: links.length > 0 ? links : undefined,
      notes: notes.trim() || undefined,
      isModernization,
      legacyRepo: isModernization ? legacyRepo.trim() : undefined,
      legacyBranch: isModernization ? legacyBranch.trim() || undefined : undefined,
    };

    const endpoint = jobId ? `/api/analysis/${jobId}/reanalyze` : "/api/analysis";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jobId ? { sources } : { repo: cloneUrl, branch, sources }),
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

  if (!owner || !repo || !cloneUrl) {
    return (
      <div className="hud-backdrop min-h-screen">
        <div className="container max-w-lg py-24 text-center">
          <Card>
            <CardContent className="pt-6">
              <p className="mb-4 text-muted-foreground">No repository selected.</p>
              <Button onClick={() => router.push("/repositories")}>Choose a repository</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const analyzing = analysisTask.status === "running";
  const buildingScenarios = manualTask.status === "running";
  const generatingAutomation = automationTask.status === "running";
  const scenarioCount = testPlan?.items.reduce((n, i) => n + i.scenarios.length, 0) ?? 0;

  return (
    <div className="hud-backdrop min-h-screen">
      <div className="container max-w-4xl py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              TestPilot workflow
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {owner}/{repo}
            </h1>
          </div>
          {jobId && <Badge variant="outline" className="font-mono">{jobId}</Badge>}
        </div>

        <Card className="mb-8 border-primary/20 bg-card/60 p-6 backdrop-blur">
          <Stepper steps={STEPS} current={step} onSelect={setStep} />
        </Card>

        {/* ---------- Step 1: Requirements ---------- */}
        {step === 1 && (
          <div className="animate-fade-in space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Requirement sources</CardTitle>
                <CardDescription>Fill in any combination - all optional, but at least one is required.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="mb-2 block">Branch</Label>
                  <Select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={analyzing || Boolean(jobId)} className="max-w-xs">
                    {(branches ?? [{ name: defaultBranch, protected: false }]).map((b) => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </Select>
                </div>

                <SourceCard icon={<Upload className="h-4 w-4" />} title="Requirements document">
                  <Input type="file" accept=".txt,.md,.csv,.json" disabled={analyzing} onChange={(e) => e.target.files?.[0] && handleDocumentUpload(e.target.files[0])} />
                  {documentFileName && <p className="mt-1 text-xs text-muted-foreground">Loaded: {documentFileName}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">Only plain-text formats (.txt, .md, .csv...) are read correctly. Or paste directly:</p>
                  <Textarea value={documentText} onChange={(e) => setDocumentText(e.target.value)} disabled={analyzing} placeholder="Paste requirements document text here..." className="mt-2 min-h-[90px]" />
                </SourceCard>

                <SourceCard icon={<Link2 className="h-4 w-4" />} title="Links">
                  <Textarea
                    value={linksText}
                    onChange={(e) => setLinksText(e.target.value)}
                    disabled={analyzing}
                    placeholder={"https://example.com/spec\nhttps://example.com/policy"}
                    className="min-h-[60px]"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Plain unauthenticated fetch - a page behind sign-in (most internal wikis) will fail to read and be reported, not silently skipped.
                  </p>
                </SourceCard>

                <SourceCard icon={<StickyNote className="h-4 w-4" />} title="Notes">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={analyzing} placeholder="Any additional detail, business rules, or context..." className="min-h-[80px]" />
                </SourceCard>

                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-4">
                  <Checkbox id="modernization" checked={isModernization} onCheckedChange={(v) => setIsModernization(v === true)} disabled={analyzing} />
                  <Label htmlFor="modernization" className="cursor-pointer text-foreground">
                    This is a legacy modernization project
                  </Label>
                </div>

                {isModernization && (
                  <SourceCard icon={<History className="h-4 w-4" />} title="Legacy codebase">
                    <p className="mb-3 text-xs text-muted-foreground">
                      Treated as the ground truth of current behavior - requirements are matched against it too, not just the sources above.
                    </p>
                    <Label className="mb-1 block text-xs">Legacy repository (git URL or local path)</Label>
                    <Input value={legacyRepo} onChange={(e) => setLegacyRepo(e.target.value)} disabled={analyzing} placeholder="https://github.com/org/legacy-app.git" className="mb-3" />
                    <Label className="mb-1 block text-xs">Legacy branch (optional)</Label>
                    <Input value={legacyBranch} onChange={(e) => setLegacyBranch(e.target.value)} disabled={analyzing} placeholder="main" />
                  </SourceCard>
                )}

                {sourceError && <p className="text-sm text-destructive">{sourceError}</p>}

                <Button size="lg" disabled={analyzing} onClick={handleAnalyze} className="w-full sm:w-auto">
                  {analyzing ? "Analyzing..." : jobId ? "Re-analyze" : "Analyze"}
                </Button>

                <TaskProgress events={analysisTask.events} />
                {analysisTask.error && <p className="text-sm text-destructive">{analysisTask.error}</p>}
              </CardContent>
            </Card>

            {analysisResult && (
              <Card className="border-primary/30 hud-glow animate-fade-in">
                <CardHeader>
                  <CardTitle>Requirements identified</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {analysisResult.requirements.requirements.map((r) => (
                    <div key={r.id} className="border-l-2 border-primary/40 pl-3">
                      <p><span className="font-semibold text-primary">{r.id}</span> — {r.description}</p>
                      <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                        {r.acceptanceCriteria.map((ac) => (
                          <li key={ac.id}>{ac.description}</li>
                        ))}
                      </ul>
                    </div>
                  ))}

                  {analysisResult.unreadableLinks.length > 0 && (
                    <p className="text-sm text-warning">Could not read {analysisResult.unreadableLinks.length} link(s): {analysisResult.unreadableLinks.join("; ")}</p>
                  )}

                  <div>
                    <h4 className="mb-1 text-sm font-semibold">Observations</h4>
                    <p className="mb-3 text-xs text-muted-foreground">Things that appear not properly implemented in the repository.</p>
                    {analysisResult.observations.length === 0 ? (
                      <p className="text-sm text-success">No gaps found - the repository appears to satisfy the requirements identified.</p>
                    ) : (
                      <div className="space-y-2">
                        {analysisResult.observations.map((o) => (
                          <div key={o.id} className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                            <Badge variant={SEVERITY_VARIANT[o.severity]} className="mt-0.5 shrink-0">{o.severity}</Badge>
                            <div>
                              <p className="text-sm font-medium">{o.title}</p>
                              <p className="text-sm text-muted-foreground">{o.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">Not everything captured? Add more detail above and click Re-analyze.</p>

                  <Button onClick={() => setStep(2)} className="gap-2">
                    Continue to Test Scenarios <ArrowRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ---------- Step 2: Manual scenarios ---------- */}
        {step === 2 && (
          <div className="animate-fade-in space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Manual scenarios</CardTitle>
                <CardDescription>
                  Generated from the requirements and observations. Review them, add notes and regenerate if something&apos;s missing, then approve.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} disabled={buildingScenarios} placeholder="Additional detail for this scenario pass (optional)..." className="min-h-[60px]" />
                <Button disabled={buildingScenarios} onClick={handleBuildScenarios}>
                  {buildingScenarios ? "Generating..." : testPlan ? "Regenerate" : "Generate manual scenarios"}
                </Button>
                <TaskProgress events={manualTask.events} />
                {manualTask.error && <p className="text-sm text-destructive">{manualTask.error}</p>}
              </CardContent>
            </Card>

            {testPlan && (
              <Card className="border-primary/30 hud-glow animate-fade-in">
                <CardHeader>
                  <CardTitle>{scenarioCount} scenario(s)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {testPlan.items.map((item) => (
                    <div key={item.requirementId} className="border-l-2 border-primary/40 pl-3">
                      <p className="font-semibold text-primary">{item.requirementId}</p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {item.scenarios.map((s) => (
                          <li key={s.id}>
                            <Badge variant="secondary" className="mr-2 align-middle text-[10px]">{s.category}</Badge>
                            {s.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <Button onClick={() => setStep(3)} className="gap-2">
                    Approve <ArrowRight className="h-4 w-4" /> Generate Automated Tests
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ---------- Step 3: Automated tests ---------- */}
        {step === 3 && (
          <div className="animate-fade-in space-y-6">
            {!testPlan && !report ? (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">Approve manual scenarios first, in the Manual scenarios step.</CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Generate automated tests</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {(["gherkin", "spec", "both"] as const).map((v) => (
                        <Button key={v} variant={outputFormat === v ? "default" : "outline"} disabled={generatingAutomation} onClick={() => setOutputFormat(v)} size="sm">
                          {v === "gherkin" ? "Gherkin (.feature)" : v === "spec" ? "Playwright spec (.ts)" : "Both"}
                        </Button>
                      ))}
                    </div>
                    <Button disabled={generatingAutomation} onClick={handleGenerateAutomation}>
                      {generatingAutomation ? "Generating..." : report ? "Regenerate" : "Generate"}
                    </Button>
                    <TaskProgress events={automationTask.events} />
                    {automationTask.error && <p className="text-sm text-destructive">{automationTask.error}</p>}
                  </CardContent>
                </Card>

                {report && (
                  <>
                    <Card className="border-primary/30 hud-glow animate-fade-in">
                      <CardHeader>
                        <CardTitle>Generated artifacts</CardTitle>
                        <CardDescription>
                          {report.scenarioCount} scenario(s), {report.reusedStepsCount} step(s) reused, {report.newStepsCount} new,{" "}
                          {report.requirementsCoveredCount}/{report.requirementsTotalCount} requirement(s) covered.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1 text-sm">
                          {report.artifacts.map((a) => (
                            <li key={a.relativePath} className="flex items-center gap-2">
                              <span className="font-mono text-xs">{a.relativePath}</span>
                              <Badge variant="secondary" className="text-[10px]">{a.kind}</Badge>
                            </li>
                          ))}
                        </ul>
                        {report.gaps.length > 0 && (
                          <div className="mt-4">
                            <h4 className="mb-1 text-sm font-semibold">Potential gaps</h4>
                            <ul className="list-inside list-disc text-sm text-muted-foreground">
                              {report.gaps.map((g, i) => (
                                <li key={i}>{g}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    {jobId && <RunTestsPanel jobId={jobId} />}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function NewAnalysisPage() {
  return (
    <Suspense fallback={<div className="hud-backdrop min-h-screen" />}>
      <Wizard />
    </Suspense>
  );
}
