import { NextRequest, NextResponse } from "next/server";
import { startRun } from "../../../../../lib/runRegistry.js";
import { getJob } from "../../../../../lib/jobRegistry.js";
import { getModelSettingsForJob } from "../../../../../lib/modelSettings.js";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_HOST } from "../../../../../src/config.js";
import type { BrowserName } from "../../../../../src/types.js";

function isBrowserName(v: unknown): v is BrowserName {
  return v === "chromium" || v === "chrome" || v === "edge" || v === "firefox";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const body = (await req.json().catch(() => null)) as
    | { baseUrl?: string; headed?: boolean; browserName?: string; viewportDevice?: string; autoFix?: boolean }
    | null;

  if (!body?.baseUrl) {
    return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
  }

  // The job page's URL keeps whatever id it was first given, which is the
  // "pending-..." placeholder assigned before generation finishes (see
  // lib/jobRegistry.ts) - the actual on-disk directory the Run step needs
  // is only known once generation completes, under job.result.jobId. The
  // in-memory registry maps both keys to the same record, so resolve
  // through it here rather than trusting the raw route param.
  const record = getJob(jobId);
  const resolvedJobId = record?.result?.jobId ?? jobId;

  // Auto-fix needs an LLM the same way generation does - reuse whichever
  // provider is currently connected in Settings.
  const modelSettings = getModelSettingsForJob();

  const runId = startRun({
    jobId: resolvedJobId,
    baseUrl: body.baseUrl,
    headed: Boolean(body.headed),
    browserName: isBrowserName(body.browserName) ? body.browserName : undefined,
    viewportDevice: body.viewportDevice || undefined,
    autoFix: body.autoFix !== false,
    provider: modelSettings.provider,
    model: process.env.TESTPILOT_MODEL ?? DEFAULT_MODEL,
    ollamaHost: process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST,
    openaiToken: modelSettings.openaiToken,
    openaiModel: modelSettings.openaiModel,
    openrouterToken: modelSettings.openrouterToken,
    openrouterModel: modelSettings.openrouterModel,
  });
  return NextResponse.json({ runId });
}
