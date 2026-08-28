"use client";

import { useEffect, useState } from "react";

/** Best-effort owner/repo for display (page headings, job listings) - not used for cloning, so a wrong guess is harmless. GitHub URLs get a real owner; anything else (a bare local path, a non-GitHub host) falls back to just the last path segment as the repo name. */
export function deriveRepoLabel(raw: string): { owner: string; repo: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const withoutGitSuffix = trimmed.replace(/\.git$/i, "");
  const githubMatch = withoutGitSuffix.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (githubMatch) return { owner: githubMatch[1], repo: githubMatch[2] };
  const segments = withoutGitSuffix.split(/[\\/]/).filter(Boolean);
  return { owner: "", repo: segments[segments.length - 1] || "repository" };
}

/**
 * A public GitHub URL's branch list and default branch can be read straight
 * from GitHub's own unauthenticated REST API, client-side - no server
 * round-trip and no sign-in needed. Debounced so it doesn't fire on every
 * keystroke; any URL that isn't a recognizable github.com owner/repo (a
 * local path, another host) just resolves to `branches: null`, and callers
 * fall back to a plain text branch field.
 */
export function useGithubBranches(url: string): { branches: string[] | null; defaultBranch: string | null; loading: boolean } {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { owner, repo } = deriveRepoLabel(url);
    if (!owner || !repo) {
      setBranches(null);
      setDefaultBranch(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
        setBranches(branchesData.map((b) => b.name));
        setDefaultBranch(repoData.default_branch ?? null);
      } catch {
        if (!cancelled) {
          setBranches(null);
          setDefaultBranch(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  return { branches, defaultBranch, loading };
}
