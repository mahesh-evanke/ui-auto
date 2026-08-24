"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

  if (error) {
    return (
      <div className="card">
        <p>Could not load repositories: {error}</p>
        <p className="muted">Make sure GITHUB_ID/GITHUB_SECRET are set and you're signed in.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Select Repository</h1>

      <input
        type="search"
        placeholder="Search repositories..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      <div className="filters">
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="all">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as VisibilityFilter)}>
          <option value="all">All visibility</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="all">All languages</option>
          {languages.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          <option value="updated">Sort: recently updated</option>
          <option value="name">Sort: alphabetical</option>
        </select>
      </div>

      {!repos && !error && <p className="muted">Loading repositories...</p>}

      {repos && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Repository</th>
                <th>Language</th>
                <th>Visibility</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.fullName}</div>
                    {r.description && <div className="muted">{r.description}</div>}
                  </td>
                  <td>{r.language ?? "-"}</td>
                  <td>
                    <span className={`badge ${r.visibility === "private" ? "private" : "pass"}`}>{r.visibility}</span>
                  </td>
                  <td className="muted">{timeAgo(r.updatedAt)}</td>
                  <td>
                    <button
                      className="btn secondary"
                      onClick={() =>
                        router.push(
                          `/analysis/new?owner=${encodeURIComponent(r.owner)}&repo=${encodeURIComponent(r.name)}&cloneUrl=${encodeURIComponent(
                            r.cloneUrl
                          )}&defaultBranch=${encodeURIComponent(r.defaultBranch)}`
                        )
                      }
                    >
                      Select
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">No repositories match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
