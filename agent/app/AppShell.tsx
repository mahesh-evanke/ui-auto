"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { cn } from "../lib/utils.js";

interface ProjectSummary {
  id: string;
  name: string;
}

const NAV_ITEMS = [
  { href: "/repositories", label: "Repositories", icon: "database" },
  { href: "/prompts", label: "Prompts", icon: "psychology" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function ProjectRow({
  project,
  active,
  onRenamed,
  onDeleted,
}: {
  project: ProjectSummary;
  active: boolean;
  onRenamed: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [busy, setBusy] = useState(false);

  async function saveRename() {
    const name = draft.trim();
    if (!name || name === project.name) {
      setEditing(false);
      setDraft(project.name);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onRenamed(project.id, data.name);
      setEditing(false);
    } catch {
      setDraft(project.name);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDeleted(project.id);
      if (active) router.push("/repositories");
    } catch {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  if (confirmingDelete) {
    return (
      <div className="flex items-center gap-xs rounded-lg border-l-2 border-error bg-error/10 px-sm py-1.5">
        <span className="material-symbols-outlined shrink-0 text-[18px] text-error">warning</span>
        <span className="min-w-0 flex-1 truncate font-body-sm text-body-sm text-error">Delete "{project.name}"?</span>
        <button type="button" disabled={busy} onClick={confirmDelete} className="shrink-0 font-body-sm text-body-sm text-error underline underline-offset-2" title="Confirm delete">
          {busy ? "..." : "Delete"}
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirmingDelete(false)} className="shrink-0 text-error" title="Cancel">
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-xs rounded-lg border-l-2 border-primary bg-secondary-container px-sm py-1.5">
        <span className="material-symbols-outlined shrink-0 text-[18px] text-on-secondary-container">folder</span>
        <input
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveRename();
            if (e.key === "Escape") {
              setEditing(false);
              setDraft(project.name);
            }
          }}
          className="w-0 flex-1 bg-transparent font-body-sm text-body-sm text-on-secondary-container outline-none"
        />
        <button type="button" disabled={busy} onClick={saveRename} className="shrink-0 text-on-secondary-container" title="Save">
          <span className="material-symbols-outlined text-[16px]">check</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setDraft(project.name);
          }}
          className="shrink-0 text-on-secondary-container"
          title="Cancel"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-xs rounded-lg border-l-2 border-transparent transition-colors",
        active ? "border-primary bg-secondary-container text-on-secondary-container" : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
      )}
    >
      <Link
        href={`/analysis/new?projectId=${encodeURIComponent(project.id)}`}
        className="flex min-w-0 flex-1 items-center gap-sm truncate px-sm py-2 font-body-sm text-body-sm no-underline"
        title={project.name}
      >
        <span className="material-symbols-outlined shrink-0 text-[18px]">folder</span>
        <span className="truncate">{project.name}</span>
      </Link>
      <button
        type="button"
        disabled={busy}
        onClick={() => setEditing(true)}
        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
        title="Rename"
      >
        <span className="material-symbols-outlined text-[16px]">edit</span>
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirmingDelete(true)}
        className="mr-sm shrink-0 rounded p-1 opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
        title="Delete"
      >
        <span className="material-symbols-outlined text-[16px]">delete</span>
      </button>
    </div>
  );
}

// The dashboard (and the whole shell around it) is visible to everyone -
// signed in or not. Signed-out visitors get a "Sign in with GitHub" button
// in the top bar instead of the username/sign-out control; there is no
// separate sign-in page to gate on.
export function AppShell({
  signedIn,
  userName,
  children,
}: {
  signedIn: boolean;
  userName: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProjectId = searchParams?.get("projectId") ?? null;

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => setProjects([]));
    // Re-fetch whenever we land back on the wizard - covers "just created a
    // new project" and "just started a run under an existing one" without
    // needing a global store for something this small.
  }, [pathname, activeProjectId]);

  function handleRenamed(id: string, name: string) {
    setProjects((prev) => prev?.map((p) => (p.id === id ? { ...p, name } : p)) ?? null);
  }

  function handleDeleted(id: string) {
    setProjects((prev) => prev?.filter((p) => p.id !== id) ?? null);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed inset-x-0 top-0 z-30 flex h-topbar_height items-center justify-between border-b border-outline-variant bg-surface-container-low px-md">
        <div className="flex items-center gap-md">
          <Link href="/repositories" className="flex items-center gap-sm no-underline">
            <span
              className="material-symbols-outlined text-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              hub
            </span>
            <span className="font-headline-sm text-headline-sm text-on-surface">TestPilot</span>
          </Link>
        </div>
        <div className="flex items-center gap-md">
          <ThemeToggle />
          {signedIn ? (
            <>
              <span className="font-body-sm text-body-sm text-on-surface-variant">{userName}</span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/repositories" })}
                className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                title="Sign out"
              >
                <span className="material-symbols-outlined text-[20px]">logout</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => signIn("github", { callbackUrl: pathname || "/repositories" })}
              className="flex h-8 items-center gap-sm rounded-lg bg-primary px-sm font-body-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              Sign in with GitHub
            </button>
          )}
        </div>
      </header>

      <aside className="fixed inset-y-0 left-0 z-20 mt-topbar_height flex w-sidebar_width flex-col overflow-y-auto border-r border-outline-variant bg-surface-container-low">
        <div className="flex flex-col gap-sm p-md">
          <Link
            href="/repositories"
            className="flex h-9 w-full items-center justify-center gap-sm rounded-lg bg-primary font-body-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed no-underline"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Project
          </Link>
        </div>

        <nav className="flex flex-col gap-xs px-sm">
          {NAV_ITEMS.map((item) => {
            const active = pathname?.startsWith(item.href.split("?")[0]);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "flex items-center gap-sm rounded-lg border-l-2 border-transparent px-sm py-2 font-body-sm text-body-sm no-underline transition-colors",
                  active
                    ? "border-primary bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                )}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="my-xs border-t border-outline-variant" />
        <div className="flex flex-1 flex-col gap-xs overflow-y-auto px-sm pb-sm">
          <div className="flex items-center justify-between px-sm">
            <p className="font-label-caps text-label-caps text-on-surface-variant">Projects</p>
            <Link
              href="/analysis/new"
              title="Add project"
              aria-label="Add project"
              className="flex h-5 w-5 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface no-underline"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
            </Link>
          </div>
          {!projects ? (
            <p className="px-sm font-body-sm text-body-sm text-on-surface-variant">Loading...</p>
          ) : projects.length === 0 ? (
            <p className="px-sm font-body-sm text-body-sm text-on-surface-variant">
              No projects yet - pick a repository to create one.
            </p>
          ) : (
            projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                active={p.id === activeProjectId}
                onRenamed={handleRenamed}
                onDeleted={handleDeleted}
              />
            ))
          )}
        </div>
      </aside>

      <main className="ml-sidebar_width mt-topbar_height min-h-[calc(100vh-56px)] p-lg">{children}</main>
    </div>
  );
}
