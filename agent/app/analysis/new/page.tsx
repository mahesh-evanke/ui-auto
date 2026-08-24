"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface GithubBranch {
  name: string;
  protected: boolean;
}

interface ProgressEvent {
  label: string;
  status: "done" | "active" | "failed";
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

const SEVERITY_BADGE: Record<Observation["severity"], string> = { high: "fail", medium: "blocked", low: "pass" };

function NewAnalysisForm() {
  const router = useRouter();
  const params = useSearchParams();
  const owner = params.get("owner") ?? "";
  const repo = params.get("repo") ?? "";
  const cloneUrl = params.get("cloneUrl") ?? "";
  const defaultBranch = params.get("defaultBranch") ?? "main";

  const [branches, setBranches] = useState<GithubBranch[] | null>(null);
  const [branch, setBranch] = useState(defaultBranch);

  const [documentText, setDocumentText] = useState("");
  const [documentFileName, setDocumentFileName] = useState<string | null>(null);
  const [linksText, setLinksText] = useState("");
  const [notes, setNotes] = useState("");
  const [isModernization, setIsModernization] = useState(false);
  const [legacyRepo, setLegacyRepo] = useState("");
  const [legacyBranch, setLegacyBranch] = useState("");

  const [jobId, setJobId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo) return;
    fetch(`/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`)
      .then((res) => res.json())
      .then((data) => setBranches(data.branches ?? []))
      .catch(() => setBranches([]));
  }, [owner, repo]);

  useEffect(() => {
    if (!taskId) return;
    const es = new EventSource(`/api/tasks/${taskId}/events`);
    es.addEventListener("progress", (e) => setEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data)]));
    es.addEventListener("done", (e) => {
      setResult((JSON.parse((e as MessageEvent).data) as { result: AnalysisResult }).result);
      setStatus("done");
      es.close();
    });
    es.addEventListener("failed", (e) => {
      setError(JSON.parse((e as MessageEvent).data));
      setStatus("failed");
      es.close();
    });
    return () => es.close();
  }, [taskId]);

  async function handleDocumentUpload(file: File) {
    // Only plain-text formats are actually parsed client-side (.txt/.md/.csv/
    // etc) - anything else (PDF, DOCX) is read as raw bytes decoded as UTF-8,
    // which will look like garbage. Flagged rather than silently mis-parsed.
    const text = await file.text();
    setDocumentText(text);
    setDocumentFileName(file.name);
  }

  async function handleAnalyze() {
    const links = linksText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!documentText.trim() && links.length === 0 && !notes.trim()) {
      setError("Provide at least one requirement source: a document, a link, or notes.");
      return;
    }
    if (isModernization && !legacyRepo.trim()) {
      setError("Legacy modernization is on - provide the legacy repository.");
      return;
    }
    setStatus("running");
    setEvents([]);
    setError(null);

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
      setStatus("failed");
      setError(data.error ?? `HTTP ${res.status}`);
      return;
    }
    if (data.jobId) setJobId(data.jobId);
    setTaskId(data.taskId);
  }

  if (!owner || !repo || !cloneUrl) {
    return (
      <div className="card">
        <p>No repository selected.</p>
        <button className="btn" onClick={() => router.push("/repositories")}>Choose a repository</button>
      </div>
    );
  }

  const running = status === "running";

  return (
    <div>
      <h1>Requirements</h1>
      <p className="muted">
        Repository: <strong>{owner}/{repo}</strong>
      </p>

      <div className="card">
        <label className="muted" style={{ display: "block", marginBottom: 6 }}>Branch</label>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={running || Boolean(jobId)} style={{ marginBottom: 16 }}>
          {(branches ?? [{ name: defaultBranch, protected: false }]).map((b) => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>

        <h3>Requirement sources</h3>
        <p className="muted">Fill in any combination - all optional, but at least one is required.</p>

        <label className="muted" style={{ display: "block", marginTop: 12, marginBottom: 6 }}>
          Requirements document {documentFileName && <span>— {documentFileName}</span>}
        </label>
        <input
          type="file"
          accept=".txt,.md,.csv,.json"
          disabled={running}
          onChange={(e) => e.target.files?.[0] && handleDocumentUpload(e.target.files[0])}
          style={{ marginBottom: 6 }}
        />
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Only plain-text formats (.txt, .md, .csv...) are read correctly - PDF/DOCX aren&apos;t parsed. Or paste text directly below.
        </p>
        <textarea
          value={documentText}
          onChange={(e) => setDocumentText(e.target.value)}
          disabled={running}
          placeholder="Paste requirements document text here..."
          style={{ minHeight: 100, marginBottom: 16 }}
        />

        <label className="muted" style={{ display: "block", marginBottom: 6 }}>
          Links (one per line) — Confluence, docs, policy pages, etc.
        </label>
        <textarea
          value={linksText}
          onChange={(e) => setLinksText(e.target.value)}
          disabled={running}
          placeholder={"https://example.com/spec\nhttps://example.com/policy"}
          style={{ minHeight: 60, marginBottom: 6 }}
        />
        <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 12 }}>
          Plain unauthenticated fetch - a page behind sign-in (most internal wikis) will fail to read and be reported, not silently skipped.
        </p>

        <label className="muted" style={{ display: "block", marginBottom: 6 }}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={running}
          placeholder="Any additional detail, business rules, or context..."
          style={{ minHeight: 80, marginBottom: 16 }}
        />

        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <input type="checkbox" checked={isModernization} onChange={(e) => setIsModernization(e.target.checked)} disabled={running} />
          This is a legacy modernization project
        </label>

        {isModernization && (
          <div style={{ marginBottom: 16, paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
            <p className="muted" style={{ marginTop: 0 }}>
              The legacy codebase is treated as the ground truth of current behavior - requirements are matched against it too, not just
              the sources above.
            </p>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>Legacy repository (git URL or local path)</label>
            <input
              type="text"
              value={legacyRepo}
              onChange={(e) => setLegacyRepo(e.target.value)}
              disabled={running}
              placeholder="https://github.com/org/legacy-app.git"
              style={{ marginBottom: 8 }}
            />
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>Legacy branch (optional)</label>
            <input type="text" value={legacyBranch} onChange={(e) => setLegacyBranch(e.target.value)} disabled={running} placeholder="main" />
          </div>
        )}

        {error && <p style={{ color: "var(--bad)" }}>{error}</p>}

        <button className="btn" disabled={running} onClick={handleAnalyze}>
          {running ? "Analyzing..." : jobId ? "Re-analyze" : "Analyze"}
        </button>
      </div>

      {events.length > 0 && (
        <div className="card">
          {events.map((e, i) => (
            <div className="checklist-item" key={i}>
              <span className={`checklist-marker ${e.status}`}>{e.status === "done" ? "✓" : e.status === "failed" ? "✕" : "●"}</span>
              <span>{e.label}</span>
            </div>
          ))}
        </div>
      )}

      {status === "done" && result && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Requirements identified</h3>
          {result.requirements.requirements.map((r) => (
            <div key={r.id} style={{ marginBottom: 12 }}>
              <strong>{r.id}</strong>: {r.description}
              <ul style={{ marginTop: 4 }}>
                {r.acceptanceCriteria.map((ac) => (
                  <li key={ac.id} className="muted">{ac.description}</li>
                ))}
              </ul>
            </div>
          ))}

          {result.unreadableLinks.length > 0 && (
            <p style={{ color: "var(--warn, #d9a441)" }}>
              Could not read {result.unreadableLinks.length} link(s): {result.unreadableLinks.join("; ")}
            </p>
          )}

          <h3>Observations</h3>
          <p className="muted">Things that appear not properly implemented in the repository, based on the requirements above.</p>
          {result.observations.length === 0 ? (
            <p className="muted">No gaps found - the repository appears to satisfy the requirements identified.</p>
          ) : (
            result.observations.map((o) => (
              <div key={o.id} className="checklist-item" style={{ alignItems: "flex-start" }}>
                <span className={`badge ${SEVERITY_BADGE[o.severity]}`} style={{ marginTop: 2 }}>{o.severity}</span>
                <span>
                  <strong>{o.title}</strong>
                  <br />
                  <span className="muted">{o.description}</span>
                </span>
              </div>
            ))
          )}

          <p className="muted" style={{ marginTop: 16 }}>
            Not everything captured? Add more detail above and click Re-analyze.
          </p>

          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => router.push(`/analysis/${jobId}`)}>
              Continue to Test Scenarios →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewAnalysisPage() {
  return (
    <Suspense fallback={<p className="muted">Loading...</p>}>
      <NewAnalysisForm />
    </Suspense>
  );
}
