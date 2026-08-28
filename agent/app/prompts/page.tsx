"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Textarea } from "../../components/ui/textarea.js";

interface PromptItem {
  id: string;
  agent: string;
  label: string;
  description: string;
  content: string;
  isDefault: boolean;
}

function PromptsPageInner() {
  const searchParams = useSearchParams();
  // Coming from a "Prompt firing" badge in an Execution Log (?id=<promptId>)
  // takes priority over the plain first-item default, but only the first
  // time the list loads - once the user clicks around, their own selection
  // wins even if this component re-renders.
  const requestedId = searchParams?.get("id") ?? null;
  const [prompts, setPrompts] = useState<PromptItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function load() {
    fetch("/api/prompts")
      .then((res) => res.json())
      .then((data) => {
        setPrompts(data.prompts);
        setSelectedId((prev) => prev ?? requestedId ?? data.prompts[0]?.id ?? null);
      })
      .catch((err) => setError(err.message ?? String(err)));
  }

  useEffect(load, []);

  const selected = useMemo(() => prompts?.find((p) => p.id === selectedId) ?? null, [prompts, selectedId]);

  useEffect(() => {
    if (selected) setDraft(selected.content);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const byAgent = new Map<string, PromptItem[]>();
    for (const p of prompts ?? []) {
      if (!byAgent.has(p.agent)) byAgent.set(p.agent, []);
      byAgent.get(p.agent)!.push(p);
    }
    return Array.from(byAgent.entries());
  }, [prompts]);

  const dirty = selected ? draft !== selected.content : false;

  async function handleSave() {
    if (!selected) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Re-fetch rather than patching state locally - only the server knows
      // whether the saved content happens to equal the shipped default
      // (isDefault), so this is the simplest way to keep that badge correct.
      load();
      setStatus("Saved - takes effect on the next run.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!selected) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDraft(data.content);
      setPrompts((prev) => prev?.map((p) => (p.id === selected.id ? { ...p, content: data.content, isDefault: true } : p)) ?? null);
      setStatus("Reset to default.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-lg">
        <p className="font-body-md text-body-md text-on-surface">Could not load prompts: {error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-lg">
      <div>
        <h1 className="font-headline-md text-headline-md text-on-surface">Prompts</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Every system prompt the agents send to the model, editable here. Changes take effect on the next run - no
          restart needed.
        </p>
      </div>

      {!prompts ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">Loading prompts...</p>
      ) : (
        <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
          <div className="flex flex-col gap-lg lg:col-span-1">
            {grouped.map(([agent, items]) => (
              <div key={agent}>
                <p className="mb-xs font-label-caps text-label-caps text-on-surface-variant">{agent}</p>
                <div className="flex flex-col gap-xs">
                  {items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`flex items-center justify-between rounded-lg border px-sm py-2 text-left font-body-sm text-body-sm transition-colors ${
                        p.id === selectedId
                          ? "border-primary bg-secondary-container text-on-secondary-container"
                          : "border-outline-variant text-on-surface hover:bg-surface-container-high"
                      }`}
                    >
                      {p.label}
                      {!p.isDefault && (
                        <Badge variant="warning" className="ml-sm shrink-0">
                          edited
                        </Badge>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-2">
            {selected && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <span className="material-symbols-outlined">psychology</span>
                    {selected.agent} — {selected.label}
                  </CardTitle>
                  <CardDescription>{selected.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-md">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={busy}
                    className="min-h-[420px] font-code-sm text-code-sm"
                  />
                  <div className="flex flex-wrap items-center gap-sm">
                    <Button disabled={busy || !dirty} onClick={handleSave}>
                      {busy ? "Saving..." : "Save"}
                    </Button>
                    <Button variant="outline" disabled={busy || selected.isDefault} onClick={handleReset}>
                      Reset to default
                    </Button>
                    {status && <p className="font-body-sm text-body-sm text-on-surface-variant">{status}</p>}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PromptsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <PromptsPageInner />
    </Suspense>
  );
}
