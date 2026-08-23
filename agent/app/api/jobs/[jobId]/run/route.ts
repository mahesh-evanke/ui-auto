import { NextRequest, NextResponse } from "next/server";
import { startRun } from "../../../../../lib/runRegistry.js";
import { getJob } from "../../../../../lib/jobRegistry.js";
import type { BrowserName } from "../../../../../src/types.js";

function isBrowserName(v: unknown): v is BrowserName {
  return v === "chromium" || v === "chrome" || v === "edge" || v === "firefox";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const body = (await req.json().catch(() => null)) as
    | { baseUrl?: string; headed?: boolean; browserName?: string; viewportDevice?: string }
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

  const runId = startRun({
    jobId: resolvedJobId,
    baseUrl: body.baseUrl,
    headed: Boolean(body.headed),
    browserName: isBrowserName(body.browserName) ? body.browserName : undefined,
    viewportDevice: body.viewportDevice || undefined,
  });
  return NextResponse.json({ runId });
}
