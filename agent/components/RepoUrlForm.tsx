"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";

/** Best-effort owner/repo for the page heading and job listing - not used for cloning, so a wrong guess is harmless. GitHub URLs get a real owner; anything else (a bare local path, a non-GitHub host) falls back to just the last path segment as the repo name. */
function deriveRepoLabel(raw: string): { owner: string; repo: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const withoutGitSuffix = trimmed.replace(/\.git$/i, "");
  const githubMatch = withoutGitSuffix.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (githubMatch) return { owner: githubMatch[1], repo: githubMatch[2] };
  const segments = withoutGitSuffix.split(/[\\/]/).filter(Boolean);
  return { owner: "", repo: segments[segments.length - 1] || "repository" };
}

export function RepoUrlForm({ className }: { className?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // A public GitHub URL's branch list can be read straight from GitHub's own
  // unauthenticated REST API, client-side - no server round-trip and no
  // sign-in needed, since this is exactly the "I don't want to sign in"
  // path. Debounced so it doesn't fire on every keystroke; any URL that
  // isn't a recognizable github.com owner/repo (a local path, another host)
  // just falls back to the plain branch text field below.
  useEffect(() => {
    const { owner, repo } = deriveRepoLabel(url);
    if (!owner || !repo) {
      setBranches(null);
      return;
    }
    let cancelled = false;
    setLoadingBranches(true);
    const timer = setTimeout(async () => {
      try {
        const [repoRes, branchesRes] = await Promise.all([
          fetch(`https://api.github.com/repos/${owner}/${repo}`),
          fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`),
        ]);
        if (!repoRes.ok || !branchesRes.ok) throw new Error("not found");
        const repoData = await repoRes.json();
        const branchesData: { name: string }[] = await branchesRes.json();
        if (cancelled) return;
        const names = branchesData.map((b) => b.name);
        setBranches(names);
        setBranch((prev) => prev || repoData.default_branch || names[0] || "");
      } catch {
        if (!cancelled) setBranches(null);
      } finally {
        if (!cancelled) setLoadingBranches(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  async function handleSubmit() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter a git repository URL or local path.");
      return;
    }
    setError(null);
    setCreating(true);
    const { owner, repo } = deriveRepoLabel(trimmed);
    const defaultBranch = branch.trim() || "main";
    try {
      // Every repo picked here becomes its own Project - "no extra ceremony"
      // means this single step (paste URL, hit Continue) is the entire
      // creation flow; the wizard is reached with a real projectId, not raw
      // repo params, so it can show the project name and group this and
      // every future run against this repo together.
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, cloneUrl: trimmed, defaultBranch }),
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
