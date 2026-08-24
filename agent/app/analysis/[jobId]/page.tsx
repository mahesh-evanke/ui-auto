"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RunTestsPanel } from "../../jobs/[jobId]/page.js";

interface ProgressEvent {
  label: string;
  status: "done" | "active" | "failed";
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

  return { status, events, error, start };
}

function ManualScenarios({ jobId, onApproved }: { jobId: string; onApproved: (plan: TestPlan) => void }) {
  const [testPlan, setTestPlan] = useState<TestPlan | null>(null);
  const [notes, setNotes] = useState("");
  const [loaded, setLoaded] = useState(false);
  const task = useTask<{ testPlan: TestPlan }>((result) => setTestPlan(result.testPlan));

  useEffect(() => {
    fetch(`/api/analysis/${jobId}/scenarios`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setTestPlan(data.testPlan))
      .finally(() => setLoaded(true));
  }, [jobId]);

  async function build() {
    const res = await fetch(`/api/analysis/${jobId}/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes.trim() || undefined, testScope: "both" }),
    });
    const data = await res.json();
    if (res.ok) task.start(data.taskId);
  }

  const running = task.status === "running";
  const scenarioCount = testPlan?.items.reduce((n, i) => n + i.scenarios.length, 0) ?? 0;

  if (!loaded) return <p className="muted">Loading...</p>;

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Manual scenarios</h3>
        <p className="muted">
          Generated from the requirements and observations identified earlier. Review them, add notes and regenerate if something&apos;s
          missing, then approve to generate automated tests.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={running}
          placeholder="Additional detail for this scenario pass (optional)..."
          style={{ minHeight: 60, marginBottom: 8 }}
        />
        <button className="btn" disabled={running} onClick={build}>
          {running ? "Generating..." : testPlan ? "Regenerate" : "Generate manual scenarios"}
        </button>

        {task.events.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {task.events.map((e, i) => (
              <div className="checklist-item" key={i}>
                <span className={`checklist-marker ${e.status}`}>{e.status === "done" ? "✓" : e.status === "failed" ? "✕" : "●"}</span>
                <span>{e.label}</span>
              </div>
            ))}
          </div>
        )}
        {task.error && <p style={{ color: "var(--bad)" }}>{task.error}</p>}
      </div>

      {testPlan && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{scenarioCount} scenario(s)</h3>
          {testPlan.items.map((item) => (
            <div key={item.requirementId} style={{ marginBottom: 16 }}>
              <strong>{item.requirementId}</strong>
              <ul>
                {item.scenarios.map((s) => (
                  <li key={s.id}>
                    <span className="muted">[{s.category}]</span> {s.description}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button className="btn" onClick={() => onApproved(testPlan)}>
            Approve → Generate Automated Tests
          </button>
        </div>
      )}
    </div>
  );
}

function AutomatedTests({ jobId, testPlan }: { jobId: string; testPlan: TestPlan | null }) {
  const [report, setReport] = useState<TestGenerationReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"gherkin" | "spec" | "both">("gherkin");
  const task = useTask<{ report: TestGenerationReport }>((result) => setReport(result.report));

  useEffect(() => {
    fetch(`/api/analysis/${jobId}/automation`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setReport(data.report))
      .finally(() => setLoaded(true));
  }, [jobId]);

  async function generate() {
    const res = await fetch(`/api/analysis/${jobId}/automation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testPlan: testPlan ?? undefined, outputFormat, testScope: "both" }),
    });
    const data = await res.json();
    if (res.ok) task.start(data.taskId);
  }

  const running = task.status === "running";

  if (!loaded) return <p className="muted">Loading...</p>;

  if (!testPlan && !report) {
    return (
      <div className="card">
        <p className="muted">Approve manual scenarios first, in the Manual tab.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Generate automated tests</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["gherkin", "spec", "both"] as const).map((v) => (
            <button key={v} className={outputFormat === v ? "btn" : "btn secondary"} disabled={running} onClick={() => setOutputFormat(v)}>
              {v === "gherkin" ? "Gherkin (.feature)" : v === "spec" ? "Playwright spec (.ts)" : "Both"}
            </button>
          ))}
        </div>
        <button className="btn" disabled={running} onClick={generate}>
          {running ? "Generating..." : report ? "Regenerate" : "Generate"}
        </button>

        {task.events.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {task.events.map((e, i) => (
              <div className="checklist-item" key={i}>
                <span className={`checklist-marker ${e.status}`}>{e.status === "done" ? "✓" : e.status === "failed" ? "✕" : "●"}</span>
                <span>{e.label}</span>
              </div>
            ))}
          </div>
        )}
        {task.error && <p style={{ color: "var(--bad)" }}>{task.error}</p>}
      </div>

      {report && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Generated artifacts</h3>
            <p className="muted">
              {report.scenarioCount} scenario(s), {report.reusedStepsCount} step(s) reused, {report.newStepsCount} new,{" "}
              {report.requirementsCoveredCount}/{report.requirementsTotalCount} requirement(s) covered.
            </p>
            <ul>
              {report.artifacts.map((a) => (
                <li key={a.relativePath}>
                  {a.relativePath} <span className="muted">({a.kind})</span>
                </li>
              ))}
            </ul>
            {report.gaps.length > 0 && (
              <>
                <h4>Potential gaps</h4>
                <ul>
                  {report.gaps.map((g, i) => (
                    <li key={i} className="muted">{g}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <RunTestsPanel jobId={jobId} />
        </>
      )}
    </div>
  );
}

export default function AnalysisJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [subTab, setSubTab] = useState<"manual" | "automated">("manual");
  const [approvedPlan, setApprovedPlan] = useState<TestPlan | null>(null);

  return (
    <div>
      <h1>Test Scenarios</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={subTab === "manual" ? "btn" : "btn secondary"} onClick={() => setSubTab("manual")}>
          Manual
        </button>
        <button className={subTab === "automated" ? "btn" : "btn secondary"} onClick={() => setSubTab("automated")}>
          Automated
        </button>
      </div>

      {subTab === "manual" ? (
        <ManualScenarios
          jobId={jobId}
          onApproved={(plan) => {
            setApprovedPlan(plan);
            setSubTab("automated");
          }}
        />
      ) : (
        <AutomatedTests jobId={jobId} testPlan={approvedPlan} />
      )}
    </div>
  );
}
