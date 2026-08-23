"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

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

interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  tests: ExecutedTestResult[];
}

function RunTestsPanel({ jobId }: { jobId: string }) {
  const [baseUrl, setBaseUrl] = useState("");
  // A browser window opens by default so the run can be watched; uncheck to run headless.
  const [headed, setHeaded] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [runEvents, setRunEvents] = useState<ProgressEvent[]>([]);
  const [runResult, setRunResult] = useState<TestRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/jobs/${jobId}/run/${runId}/events`);
    es.addEventListener("progress", (e) => {
      setRunEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data)]);
    });
    es.addEventListener("done", (e) => {
      setRunResult(JSON.parse((e as MessageEvent).data));
      setRunStatus("done");
      es.close();
    });
    es.addEventListener("failed", (e) => {
      setRunError(JSON.parse((e as MessageEvent).data));
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
      body: JSON.stringify({ baseUrl: baseUrl.trim(), headed }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRunStatus("failed");
      setRunError(data.error ?? `HTTP ${res.status}`);
      return;
    }
    setRunId(data.runId);
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Run Tests</h3>
      <p className="muted">
        Optional, explicit step: point at an already-running instance of the app and execute the generated tests against it.
        This installs test-runner dependencies in the target repo if missing, and is the only point where TestPilot runs anything.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="http://localhost:3000"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
          disabled={runStatus === "running"}
        />
        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} disabled={runStatus === "running"} />
          Headed
        </label>
        <button className="btn" disabled={runStatus === "running" || !baseUrl.trim()} onClick={handleRun}>
          {runStatus === "running" ? "Running..." : "Run Tests"}
        </button>
      </div>

      {runEvents.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {runEvents.map((e, i) => (
            <div className="checklist-item" key={i}>
              <span className={`checklist-marker ${e.status}`}>{e.status === "done" ? "✓" : e.status === "failed" ? "✕" : "●"}</span>
              <span>{linkifyUrl(e.label)}</span>
            </div>
          ))}
        </div>
      )}

      {runStatus === "failed" && runError && (
        <p style={{ color: "var(--bad)", marginTop: 12 }}>{runError}</p>
      )}

      {runStatus === "done" && runResult && (
        <div style={{ marginTop: 16 }}>
          <p>
            <span className="badge pass">{runResult.passed} passed</span>{" "}
            {runResult.failed > 0 && <span className="badge fail" style={{ marginLeft: 8 }}>{runResult.failed} failed</span>}{" "}
            {runResult.skipped > 0 && <span className="badge blocked" style={{ marginLeft: 8 }}>{runResult.skipped} skipped</span>}
          </p>
          <table>
            <thead>
              <tr>
                <th>Test</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runResult.tests.map((t, i) => (
                <tr key={i}>
                  <td>{t.title}</td>
                  <td>
                    <span className={`badge ${t.status === "passed" ? "pass" : t.status === "failed" ? "fail" : "blocked"}`}>{t.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
      setStatus("done");
      es.close();
    });
    es.addEventListener("failed", (e) => {
      setFailError(JSON.parse((e as MessageEvent).data));
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
