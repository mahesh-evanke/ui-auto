"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";
import { deriveRepoLabel, useGithubBranches } from "../lib/githubRepo.js";

export function RepoUrlForm({ className }: { className?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { branches, defaultBranch, loading: loadingBranches } = useGithubBranches(url);

  useEffect(() => {
    if (defaultBranch) setBranch((prev) => prev || defaultBranch);
  }, [defaultBranch]);

  async function handleSubmit() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter a git repository URL or local path.");
      return;
    }
    setError(null);
    setCreating(true);
    const { owner, repo } = deriveRepoLabel(trimmed);
    const resolvedBranch = branch.trim() || "main";
    try {
      // Every repo picked here becomes its own Project - "no extra ceremony"
      // means this single step (paste URL, hit Continue) is the entire
      // creation flow; the wizard is reached with a real projectId, not raw
      // repo params, so it can show the project name and group this and
      // every future run against this repo together.
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, cloneUrl: trimmed, defaultBranch: resolvedBranch }),
      });
      const project = await res.json();
      if (!res.ok) throw new Error(project.error ?? `HTTP ${res.status}`);
      router.push(`/analysis/new?projectId=${encodeURIComponent(project.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-sm">
        <div>
          <Label className="mb-1 block" htmlFor="repo-url">Git Repository URL</Label>
          <Input
            id="repo-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="https://github.com/org/repo.git or a local path"
          />
        </div>
        <div>
          <Label className="mb-1 block" htmlFor="repo-branch">Branch{branches ? "" : " (optional)"}</Label>
          {branches && branches.length > 0 ? (
            <Select value={branch} onValueChange={setBranch}>
              <SelectTrigger id="repo-branch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="repo-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={loadingBranches ? "Loading branches..." : "main"}
              disabled={loadingBranches}
            />
          )}
        </div>
        {error && <p className="font-body-sm text-body-sm text-error">{error}</p>}
        <Button variant="outline" className="w-full" disabled={creating} onClick={handleSubmit}>
          {creating ? "Setting up project..." : "Continue with this repository"}
        </Button>
      </div>
    </div>
  );
}
