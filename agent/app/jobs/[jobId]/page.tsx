"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select.js";
import { Switch } from "../../../components/ui/checkbox.js";
import { Badge } from "../../../components/ui/badge.js";
import { cn } from "../../../lib/utils.js";

interface ProgressEvent {
  label: string;
  status: "done" | "active" | "failed";
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;

function linkifyUrl(text: string) {
  // URL_RE is stateful (global flag) - only ever call .split() on it here,
  // never .test(); reusing a global regex's .test() across calls advances
  // its lastIndex and silently gives alternating wrong results.
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

interface GeneratedArtifact {
  kind: "playwright-spec" | "feature" | "step-definitions" | "api-step-definitions";
  fileName: string;
  relativePath: string;
}

interface CoverageRow {
  requirementId: string;
  scenarioId: string;
  artifactFileName: string;
}

interface TestGenerationReport {
  frameworkKind: string;
  filesAnalyzedCount: number;
  relevantFilesCount: number;
  existingTestFilesCount: number;
  scenarioCount: number;
  reusedStepsCount: number;
  newStepsCount: number;
  requirementsCoveredCount: number;
  requirementsTotalCount: number;
  coverage: CoverageRow[];
  gaps: string[];
}

interface JobResult {
  jobId: string;
  requirements: { requirements: { id: string; description: string }[] };
  generatedArtifacts: GeneratedArtifact[];
  report: TestGenerationReport;
}

const KIND_LABEL: Record<GeneratedArtifact["kind"], string> = {
  "playwright-spec": "Playwright spec",
  feature: "Gherkin feature",
  "step-definitions": "Step definitions",
  "api-step-definitions": "API step definitions",
};

interface ExecutedTestResult {
  title: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  error?: string;
  durationMs: number;
}

interface FixAttempt {
  attempt: number;
  correctedScenarioTitles: string[];
  unfixableScenarioTitles: string[];
  result: { passed: number; failed: number; skipped: number };
}

interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  tests: ExecutedTestResult[];
  fixAttempts?: FixAttempt[];
}

const DEVICES = [
  "", "iPhone SE", "iPhone XR", "iPhone 12 Pro", "iPhone 14 Pro Max", "Pixel 7",
  "Samsung Galaxy S8+", "Samsung Galaxy S20 Ultra", "iPad Mini", "iPad Air", "iPad Pro",
  "Surface Pro 7", "Surface Duo", "Galaxy Z Fold 5", "Asus Zenbook Fold",
  "Samsung Galaxy A51/71", "Nest Hub", "Nest Hub Max",
];
// Radix Select reserves "" as its internal "no selection" sentinel, so the
// "Desktop (full window)" / no-emulation option needs a real value here -
// translated back to "" at the state boundary.
const DESKTOP_DEVICE = "__desktop__";

export function RunTestsPanel({
  jobId,
  onEventsChange,
}: {
  jobId: string;
  /** When provided, the run's progress events are reported here instead of being rendered inline - lets a host page (e.g. the analysis wizard) show them in its own consolidated execution log rather than duplicating them inside this card. */
  onEventsChange?: (events: ProgressEvent[], error: string | null) => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  // A browser window opens by default so the run can be watched; uncheck to run headless.
  const [headed, setHeaded] = useState(true);
  const [browserName, setBrowserName] = useState<"chromium" | "chrome" | "edge" | "firefox">("chromium");
  const [viewportDevice, setViewportDevice] = useState("");
  // On failure, the failing scenario(s) get corrected and re-run automatically by default.
  const [autoFix, setAutoFix] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [runEvents, setRunEvents] = useState<ProgressEvent[]>([]);
  const [runResult, setRunResult] = useState<TestRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    onEventsChange?.(runEvents, runError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runEvents, runError]);

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/jobs/${jobId}/run/${runId}/events`);
    es.addEventListener("progress", (e) => {
      setRunEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data)]);
    });
    es.addEventListener("done", (e) => {
      setRunResult(JSON.parse((e as MessageEvent).data));
      setRunEvents((prev) => prev.map((ev) => (ev.status === "active" ? { ...ev, status: "done" } : ev)));
      setRunStatus("done");
      es.close();
    });
    es.addEventListener("failed", (e) => {
      setRunError(JSON.parse((e as MessageEvent).data));
      setRunEvents((prev) => prev.map((ev) => (ev.status === "active" ? { ...ev, status: "failed" } : ev)));
      setRunStatus("failed");
      es.close();
    });
    return () => es.close();
  }, [jobId, runId]);

  async function handleRun() {
    if (!baseUrl.trim()) return;
    setRunStatus("running");
    setRunEvents([]);
    setRunResult(null);
    setRunError(null);
    const res = await fetch(`/api/jobs/${jobId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: baseUrl.trim(), headed, browserName, viewportDevice: viewportDevice || undefined, autoFix }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRunStatus("failed");
      setRunError(data.error ?? `HTTP ${res.status}`);
      return;
    }
    setRunId(data.runId);
  }

  const STATUS_VARIANT = { passed: "success", failed: "destructive", skipped: "warning", unknown: "outline" } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="material-symbols-outlined">play_circle</span>
          Run Configuration
        </CardTitle>
        <CardDescription>
          Optional, explicit step: point at an already-running instance of the app and execute the generated tests
          against it. Installs test-runner dependencies in the target repo if missing - the only point where
          TestPilot runs anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        <div>
          <Label className="mb-1 block" htmlFor="run-base-url">Target URL</Label>
          <Input
            id="run-base-url"
            type="text"
            placeholder="http://localhost:3000"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={runStatus === "running"}
          />
        </div>

        <div>
          <Label className="mb-1 block">Browser</Label>
          <div className="flex flex-wrap gap-xs">
            {(["chromium", "chrome", "edge", "firefox"] as const).map((b) => (
              <Button
                key={b}
                type="button"
                size="sm"
                variant={browserName === b ? "default" : "outline"}
                disabled={runStatus === "running"}
                onClick={() => setBrowserName(b)}
                title={b === "firefox" ? "Not wired into hooks.ts yet - falls back to Chromium" : undefined}
              >
                {b === "chromium" ? "Chromium" : b === "chrome" ? "Chrome" : b === "edge" ? "Edge" : "Firefox"}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-1 block" htmlFor="run-device">Device Emulation</Label>
          <Select
            value={viewportDevice || DESKTOP_DEVICE}
            onValueChange={(v) => setViewportDevice(v === DESKTOP_DEVICE ? "" : v)}
            disabled={runStatus === "running"}
          >
            <SelectTrigger id="run-device">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEVICES.map((d) => (
                <SelectItem key={d || DESKTOP_DEVICE} value={d || DESKTOP_DEVICE}>
                  {d || "Desktop (full window)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container p-sm">
          <div>
            <p className="font-body-sm text-body-sm text-on-surface">Headed</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Opens a visible browser window for the run.</p>
          </div>
          <Switch checked={headed} onCheckedChange={(v) => setHeaded(v === true)} disabled={runStatus === "running"} />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container p-sm">
          <div>
            <p className="font-body-sm text-body-sm text-on-surface">Auto-fix Selectors</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              On failure, corrects the failing scenario(s) and re-runs automatically (bundled harness only).
            </p>
          </div>
          <Switch checked={autoFix} onCheckedChange={(v) => setAutoFix(v === true)} disabled={runStatus === "running"} />
        </div>

        <Button disabled={runStatus === "running" || !baseUrl.trim()} onClick={handleRun}>
          {runStatus === "running" ? "Running..." : "Run Test Suite"}
        </Button>

        {!onEventsChange && runEvents.length > 0 && (
          <div className="flex flex-col gap-xs rounded-lg border border-outline-variant bg-surface-container-lowest p-sm font-code-sm text-code-sm">
            {runEvents.map((e, i) => (
              <div key={i} className="flex items-start gap-sm">
                <span
                  className={cn(
                    e.status === "done" && "text-log-success",
                    e.status === "failed" && "text-error",
                    e.status === "active" && "text-primary"
                  )}
                >
                  {e.status === "done" ? "✓" : e.status === "failed" ? "✕" : "●"}
                </span>
                <span className="text-on-surface-variant">{linkifyUrl(e.label)}</span>
              </div>
            ))}
          </div>
        )}

        {!onEventsChange && runStatus === "failed" && runError && <p className="font-body-sm text-body-sm text-error">{runError}</p>}

        {runStatus === "done" && runResult && (
          <div className="flex flex-col gap-md">
            <div className="flex flex-wrap gap-xs">
              <Badge variant="success">{runResult.passed} passed</Badge>
              {runResult.failed > 0 && <Badge variant="destructive">{runResult.failed} failed</Badge>}
              {runResult.skipped > 0 && <Badge variant="warning">{runResult.skipped} skipped</Badge>}
            </div>

            {runResult.fixAttempts && runResult.fixAttempts.length > 0 && (
              <div className="rounded-lg border border-outline-variant bg-surface-container p-sm">
                <p className="font-body-md text-body-md font-medium text-on-surface">Auto-fix history</p>
                <p className="mb-sm font-body-sm text-body-sm text-on-surface-variant">
                  Failing scenarios were rewritten in the generated .feature file and re-run. Only scenarios that
                  were still failing at the start of each round were touched.
                </p>
                <div className="flex flex-col gap-xs">
                  {runResult.fixAttempts.map((a) => (
                    <div key={a.attempt} className="flex items-start gap-sm font-body-sm text-body-sm">
                      <span className="material-symbols-outlined text-[16px] text-log-success">check</span>
                      <span className="text-on-surface-variant">
                        Attempt {a.attempt}: corrected {a.correctedScenarioTitles.length} scenario(s)
                        {a.unfixableScenarioTitles.length > 0 && `, could not diagnose ${a.unfixableScenarioTitles.length}`} →{" "}
                        {a.result.passed} passed, {a.result.failed} failed, {a.result.skipped} skipped
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-xs">
              {runResult.tests.map((t, i) => (
                <div key={i} className="flex items-center justify-between rounded border border-outline-variant px-sm py-1.5 font-body-sm text-body-sm">
                  <span className="text-on-surface">{t.title}</span>
                  <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function JobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [status, setStatus] = useState<"running" | "done" | "failed">("running");
  const [result, setResult] = useState<JobResult | null>(null);
  const [failError, setFailError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.addEventListener("progress", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setEvents((prev) => [...prev, data]);
    });
    es.addEventListener("log", (e) => {
      const line = JSON.parse((e as MessageEvent).data) as string;
      setLogLines((prev) => [...prev.slice(-300), line]);
    });
    es.addEventListener("done", (e) => {
      setResult(JSON.parse((e as MessageEvent).data));
      setEvents((prev) => prev.map((ev) => (ev.status === "active" ? { ...ev, status: "done" } : ev)));
      setStatus("done");
      es.close();
    });
    es.addEventListener("failed", (e) => {
      setFailError(JSON.parse((e as MessageEvent).data));
      setEvents((prev) => prev.map((ev) => (ev.status === "active" ? { ...ev, status: "failed" } : ev)));
      setStatus("failed");
      es.close();
    });
    return () => es.close();
  }, [jobId]);

  useEffect(() => {
    if (status === "done") {
      fetch(`/api/jobs/${jobId}/report`)
        .then((res) => (res.ok ? res.text() : null))
        .then(setReport)
        .catch(() => {});
    }
  }, [status, jobId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logLines]);

  return (
    <div>
      <h1>Test Generation</h1>

      <div className="card">
        {events.map((e, i) => (
          <div className="checklist-item" key={i}>
            <span className={`checklist-marker ${e.status}`}>
              {e.status === "done" ? "✓" : e.status === "failed" ? "✕" : "●"}
            </span>
            <span>{linkifyUrl(e.label)}</span>
          </div>
        ))}
        {status === "running" && events.length === 0 && <p className="muted">Starting...</p>}
      </div>

      {logLines.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer" }}>Logs</summary>
          <pre className="log" ref={logRef}>{logLines.join("")}</pre>
        </details>
      )}

      {status === "failed" && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <h3 style={{ color: "var(--bad)", marginTop: 0 }}>Job failed</h3>
          <p>{failError}</p>
        </div>
      )}

      {status === "done" && result && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Test Generation Complete</h2>
            <p className="muted">
              Detected framework: <strong>{result.report.frameworkKind}</strong> · Files analyzed: {result.report.filesAnalyzedCount} ·
              Relevant files: {result.report.relevantFilesCount} · Existing tests found: {result.report.existingTestFilesCount}
            </p>
            <p className="muted">
              Scenarios generated: {result.report.scenarioCount} · Reused steps: {result.report.reusedStepsCount} · New steps: {result.report.newStepsCount} ·
              Requirements covered: {result.report.requirementsCoveredCount}/{result.report.requirementsTotalCount}
            </p>
            <p style={{ marginTop: 12 }}>
              <span className="badge pass">Application source modified: NO</span>{" "}
              <span className="badge pass" style={{ marginLeft: 8 }}>Tests executed: NO</span>
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Generated Artifacts</h3>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {result.generatedArtifacts.map((a) => (
                  <tr key={a.relativePath}>
                    <td>
                      <code>{a.relativePath}</code>
                    </td>
                    <td className="muted">{KIND_LABEL[a.kind]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Coverage Matrix</h3>
            <table>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Scenario</th>
                  <th>Artifact</th>
                </tr>
              </thead>
              <tbody>
                {result.report.coverage.map((row, i) => {
                  const req = result.requirements.requirements.find((q) => q.id === row.requirementId);
                  return (
                    <tr key={i}>
                      <td>
                        {row.requirementId}
                        {req ? `: ${req.description}` : ""}
                      </td>
                      <td className="muted">{row.scenarioId}</td>
                      <td className="muted">{row.artifactFileName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <RunTestsPanel jobId={jobId} />

          {result.report.gaps.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Notes / Potential Gaps</h3>
              {result.report.gaps.map((g, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  {g}
                </div>
              ))}
            </div>
          )}

          {report && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Full Report</h3>
              <pre className="log" style={{ maxHeight: 480 }}>{report}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
