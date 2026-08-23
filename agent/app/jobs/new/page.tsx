"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface GithubBranch {
  name: string;
  protected: boolean;
}

function NewJobForm() {
  const router = useRouter();
  const params = useSearchParams();
  const owner = params.get("owner") ?? "";
  const repo = params.get("repo") ?? "";
  const cloneUrl = params.get("cloneUrl") ?? "";
  const defaultBranch = params.get("defaultBranch") ?? "main";

  const [branches, setBranches] = useState<GithubBranch[] | null>(null);
  const [branch, setBranch] = useState(defaultBranch);
  const [requirement, setRequirement] = useState("");
  const [outputFormat, setOutputFormat] = useState<"gherkin" | "spec" | "both">("gherkin");
  const [testScope, setTestScope] = useState<"web" | "api" | "both">("both");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo) return;
    fetch(`/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`)
      .then((res) => res.json())
      .then((data) => setBranches(data.branches ?? []))
      .catch(() => setBranches([]));
  }, [owner, repo]);

  async function handleSubmit() {
    if (!requirement.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloneUrl, branch, requirement, outputFormat, testScope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/jobs/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  if (!owner || !repo || !cloneUrl) {
    return (
      <div className="card">
        <p>No repository selected.</p>
        <button className="btn" onClick={() => router.push("/repositories")}>Choose a repository</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Requirement</h1>
      <p className="muted">
        Repository: <strong>{owner}/{repo}</strong>
      </p>

      <div className="card">
        <label className="muted" style={{ display: "block", marginBottom: 6 }}>Branch</label>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} style={{ marginBottom: 16 }}>
          {(branches ?? [{ name: defaultBranch, protected: false }]).map((b) => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>

        <label className="muted" style={{ display: "block", marginBottom: 6 }}>
          Feature, business rule, or acceptance criteria (plain English)
        </label>
        <textarea
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          placeholder={
            "Example: Add a Save button to the profile page. It should save the user's changes, show a loading state, prevent duplicate submissions, and show success/error feedback."
          }
        />

        <div style={{ marginTop: 16 }}>
          <label className="muted" style={{ display: "block", marginBottom: 6 }}>Output format</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {(["gherkin", "spec", "both"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={outputFormat === v ? "btn" : "btn secondary"}
                onClick={() => setOutputFormat(v)}
              >
                {v === "gherkin" ? "Gherkin (.feature)" : v === "spec" ? "Playwright spec (.ts)" : "Both"}
              </button>
            ))}
          </div>

          <label className="muted" style={{ display: "block", marginBottom: 6 }}>Test scope</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {(["web", "api", "both"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={testScope === v ? "btn" : "btn secondary"}
                onClick={() => setTestScope(v)}
              >
                {v === "web" ? "Web only" : v === "api" ? "API only" : "Both (web + API)"}
              </button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
            {testScope === "both"
              ? "Scenarios follow real navigation order: a UI action that triggers a backend call is followed by that call's result, then the next screen."
              : testScope === "web"
                ? "Scenarios describe only what happens on screen - no API assertions."
                : "Scenarios describe only requests and responses - no UI interaction."}
          </p>
        </div>

        {error && <p style={{ color: "var(--bad)" }}>{error}</p>}

        <div style={{ marginTop: 16 }}>
          <button className="btn" disabled={submitting || !requirement.trim()} onClick={handleSubmit}>
            {submitting ? "Starting job..." : "Run QA Job"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NewJobPage() {
  return (
    <Suspense fallback={<p className="muted">Loading...</p>}>
      <NewJobForm />
    </Suspense>
  );
}
