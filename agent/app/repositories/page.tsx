"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { RepoUrlForm } from "../../components/RepoUrlForm.js";

interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  isOrg: boolean;
  description: string | null;
  language: string | null;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
  htmlUrl: string;
  cloneUrl: string;
  sizeKb: number;
}

type VisibilityFilter = "all" | "public" | "private";
type SortMode = "updated" | "name";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function RepositoriesPage() {
  const router = useRouter();
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  const [language, setLanguage] = useState("all");
  const [sort, setSort] = useState<SortMode>("updated");

  useEffect(() => {
    fetch("/api/github/repos")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setRepos(data.repos))
      .catch((err) => setError(err.message ?? String(err)));
  }, []);

  const owners = useMemo(() => Array.from(new Set((repos ?? []).map((r) => r.owner))).sort(), [repos]);
  const languages = useMemo(
    () => Array.from(new Set((repos ?? []).map((r) => r.language).filter((l): l is string => Boolean(l)))).sort(),
    [repos]
  );

  const filtered = useMemo(() => {
    let list = repos ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.fullName.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q));
    }
    if (owner !== "all") list = list.filter((r) => r.owner === owner);
    if (visibility !== "all") list = list.filter((r) => r.visibility === visibility);
    if (language !== "all") list = list.filter((r) => r.language === language);
    list = [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return list;
  }, [repos, search, owner, visibility, language, sort]);

  const [creatingId, setCreatingId] = useState<number | null>(null);

  async function selectRepo(r: GithubRepo) {
    setCreatingId(r.id);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: r.owner, repo: r.name, cloneUrl: r.cloneUrl, defaultBranch: r.defaultBranch }),
      });
      const project = await res.json();
      if (!res.ok) throw new Error(project.error ?? `HTTP ${res.status}`);
      router.push(`/analysis/new?projectId=${encodeURIComponent(project.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreatingId(null);
    }
  }

  if (error) {
    // Not signed in (the common case for a guest visiting the dashboard) is
    // expected, not a failure worth alarming the user about - just fall
    // through to the "Analyze by URL" card below without the GitHub list.
    return (
      <div className="mx-auto flex max-w-md flex-col gap-lg">
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">TestPilot</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Sign in with GitHub above to browse your repositories, or analyze one by URL below.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="material-symbols-outlined">link</span>
              Analyze by URL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RepoUrlForm />
          </CardContent>
        </Card>
      </div>
    );
  }

  const featured = filtered[0];
  const rest = filtered.slice(1);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-lg">
      <div>
        <h1 className="font-headline-md text-headline-md text-on-surface">Select Repository</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Choose a repository to analyze requirements and generate test coverage.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="material-symbols-outlined">link</span>
            Analyze by URL
          </CardTitle>
          <CardDescription>Not one of your GitHub repos? Paste a git URL (public repo) or a local path instead.</CardDescription>
        </CardHeader>
        <CardContent>
          <RepoUrlForm className="max-w-lg" />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-sm">
        <div className="min-w-[240px] flex-1">
          <Input
            type="search"
            placeholder="Search repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-auto min-w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {owners.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={visibility} onValueChange={(v) => setVisibility(v as VisibilityFilter)}>
          <SelectTrigger className="w-auto min-w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="private">Private</SelectItem>
          </SelectContent>
        </Select>
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className="w-auto min-w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All languages</SelectItem>
            {languages.map((l) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
          <SelectTrigger className="w-auto min-w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Sort: recently updated</SelectItem>
            <SelectItem value="name">Sort: alphabetical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!repos && !error && <p className="font-body-sm text-body-sm text-on-surface-variant">Loading repositories...</p>}

      {repos && filtered.length === 0 && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">No repositories match.</p>
      )}

      {repos && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
          {featured && (
            <button
              type="button"
              disabled={creatingId !== null}
              onClick={() => selectRepo(featured)}
              className="group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low p-lg text-left transition-colors hover:border-primary disabled:opacity-50 sm:col-span-2"
            >
              <div className="flex items-start justify-between gap-sm">
                <div className="flex items-center gap-sm">
                  <span className="material-symbols-outlined text-primary">folder_open</span>
                  <div>
                    <div className="font-headline-sm text-headline-sm text-on-surface">{featured.fullName}</div>
                    <div className="font-body-sm text-body-sm text-on-surface-variant">
                      {featured.description ?? "No description"}
                    </div>
                  </div>
                </div>
                <Badge variant={featured.visibility === "private" ? "outline" : "success"}>{featured.visibility}</Badge>
              </div>
              <div className="mt-lg flex items-center justify-between">
                <div className="flex items-center gap-md font-body-sm text-body-sm text-on-surface-variant">
                  {featured.language && (
                    <span className="flex items-center gap-xs">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      {featured.language}
                    </span>
                  )}
                  <span>{featured.defaultBranch}</span>
                  <span>Updated {timeAgo(featured.updatedAt)}</span>
                </div>
                <span className="rounded-lg bg-primary px-md py-2 font-body-sm text-body-sm font-medium text-on-primary transition-colors group-hover:bg-primary-fixed">
                  {creatingId === featured.id ? "Setting up..." : "Select & Analyze"}
                </span>
              </div>
            </button>
          )}

          {rest.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={creatingId !== null}
              onClick={() => selectRepo(r)}
              className="group flex flex-col justify-between rounded-xl border border-outline-variant bg-surface-container-low p-md text-left transition-colors hover:border-primary disabled:opacity-50"
            >
              <div className="flex items-start justify-between gap-sm">
                <div className="flex items-center gap-sm">
                  <span className="material-symbols-outlined text-on-surface-variant">folder</span>
                  <div className="font-body-md text-body-md font-medium text-on-surface">{r.name}</div>
                </div>
                <Badge variant={r.visibility === "private" ? "outline" : "success"}>{r.visibility}</Badge>
              </div>
              <p className="mt-sm line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">
                {r.description ?? "No description"}
              </p>
              <div className="mt-md flex items-center justify-between">
                <div className="flex items-center gap-sm font-body-sm text-body-sm text-on-surface-variant">
                  {r.language && (
                    <span className="flex items-center gap-xs">
                      <span className="h-2 w-2 rounded-full bg-tertiary" />
                      {r.language}
                    </span>
                  )}
                  <span>{timeAgo(r.updatedAt)}</span>
                </div>
                <span className="rounded border border-outline-variant px-sm py-1 font-body-sm text-body-sm text-on-surface transition-colors group-hover:border-primary group-hover:text-primary">
                  {creatingId === r.id ? "Setting up..." : "Select"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
